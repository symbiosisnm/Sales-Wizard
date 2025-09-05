const { PassThrough } = require('stream');
const path = require('path');
const audioHandler = require('./audioHandler');

const VAD_THRESHOLD = 900;
const VAD_HYSTERESIS = 200;
const VAD_SILENCE_SEND_MS = 2500;
let vadSpeaking = false;
let vadLastSendTs = 0;

function computeEnergyFromPcm16(buf) {
    const samples = buf.length / 2;
    if (!samples) return 0;
    let sum = 0;
    for (let i = 0; i < samples; i++) {
        sum += Math.abs(buf.readInt16LE(i * 2));
    }
    return sum / samples;
}

function shouldSend(chunk) {
    const now = Date.now();
    const energy = computeEnergyFromPcm16(chunk);
    const enteringSpeech = !vadSpeaking && energy > VAD_THRESHOLD;
    const stayingSpeech = vadSpeaking && energy > VAD_THRESHOLD - VAD_HYSTERESIS;
    const keepAlive = !vadSpeaking && now - vadLastSendTs > VAD_SILENCE_SEND_MS;
    if (enteringSpeech || stayingSpeech || keepAlive) {
        vadSpeaking = enteringSpeech || stayingSpeech;
        vadLastSendTs = now;
        return true;
    }
    return false;
}

async function startMicrophoneCapture({ deviceId, sampleRate, channels }) {
    const nav = globalThis.navigator;
    if (!nav?.mediaDevices?.getUserMedia) {
        throw new Error('getUserMedia is not supported in this environment');
    }
    const mediaStream = await nav.mediaDevices.getUserMedia({
        audio: {
            deviceId: deviceId || undefined,
            channelCount: channels,
            sampleRate,
        },
    });

    const AudioCtx = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AudioCtx) {
        throw new Error('Web Audio API not supported');
    }
    const ctx = new AudioCtx({ sampleRate });
    if (!ctx.audioWorklet) {
        throw new Error('AudioWorklet is not supported');
    }
    const workletUrl = typeof window !== 'undefined'
        ? new URL('./pcm16-worklet.js', window.location.href).toString()
        : path.join(__dirname, 'pcm16-worklet.js');
    await ctx.audioWorklet.addModule(workletUrl);

    const srcNode = ctx.createMediaStreamSource(mediaStream);
    const workletNode = new globalThis.AudioWorkletNode(ctx, 'pcm16-worklet', {
        processorOptions: {
            targetSampleRate: sampleRate,
            samplesPerChunk: Math.floor(sampleRate / 10),
        },
    });

    const pcmStream = new PassThrough();
    workletNode.port.onmessage = e => {
        const chunk = Buffer.from(e.data);
        if (shouldSend(chunk)) {
            pcmStream.write(chunk);
        }
    };

    const gain = ctx.createGain();
    gain.gain.value = 0;
    srcNode.connect(workletNode);
    workletNode.connect(gain);
    gain.connect(ctx.destination);

    const stop = () => {
        try {
            workletNode.disconnect();
            srcNode.disconnect();
        } catch {
            /* noop */
        }
        mediaStream.getTracks().forEach(t => t.stop());
        ctx.close();
        pcmStream.end();
    };

    return { stop, stream: pcmStream };
}

async function startSystemCapture(pcmStream) {
    const geminiSessionRef = {
        current: {
            sendRealtimeInput: async ({ audio }) => {
                const buf = Buffer.from(audio.data, 'base64');
                pcmStream.write(buf);
            },
        },
    };
    const ok = await audioHandler.startSystemAudioCapture(geminiSessionRef);
    if (!ok) {
        throw new Error('Failed to start system audio capture');
    }
    return () => {
        audioHandler.stopSystemAudioCapture();
        pcmStream.end();
    };
}

async function startAudioCapture({ source = 'microphone', deviceId = null, sampleRate = 24000, channels = 1 } = {}) {
    if (source === 'microphone') {
        return startMicrophoneCapture({ deviceId, sampleRate, channels });
    }

    const pcmStream = new PassThrough();
    const stop = await startSystemCapture(pcmStream);
    return { stop, stream: pcmStream };
}

module.exports = { startAudioCapture };
