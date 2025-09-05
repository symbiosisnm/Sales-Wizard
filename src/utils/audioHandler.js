const { spawn } = require('child_process');
const { saveDebugAudio } = require('../audioUtils');

let systemAudioProc = null;
let vadSpeaking = false;
let vadLastSendTs = 0;
const VAD_THRESHOLD = 900;
const VAD_HYSTERESIS = 200;
const VAD_SILENCE_SEND_MS = 2500;

const CHUNK_DURATION = 0.1;
const SAMPLE_RATE = 24000;
const BYTES_PER_SAMPLE = 2;
const CHANNELS = 2;
const CHUNK_SIZE = SAMPLE_RATE * BYTES_PER_SAMPLE * CHANNELS * CHUNK_DURATION;

function killExistingSystemAudioDump() {
    return new Promise(resolve => {
        const killProc = spawn('pkill', ['-f', 'SystemAudioDump'], { stdio: 'ignore' });
        killProc.on('close', () => resolve());
        killProc.on('error', () => resolve());
        setTimeout(() => {
            killProc.kill();
            resolve();
        }, 2000);
    });
}

async function startMacOSAudioCapture(geminiSessionRef) {
    if (process.platform !== 'darwin') return false;
    await killExistingSystemAudioDump();

    const { app } = require('electron');
    const path = require('path');

    let systemAudioPath;
    if (app.isPackaged) {
        systemAudioPath = path.join(process.resourcesPath, 'SystemAudioDump');
    } else {
        systemAudioPath = path.join(__dirname, '../assets', 'SystemAudioDump');
    }

    const spawnOptions = {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, PROCESS_NAME: 'AudioService', APP_NAME: 'System Audio Service' },
        detached: false,
        windowsHide: false,
    };

    systemAudioProc = spawn(systemAudioPath, [], spawnOptions);
    if (!systemAudioProc.pid) {
        logger.error('Failed to start SystemAudioDump');
        return false;
    }

    setupPcmPipeline(geminiSessionRef, 'SystemAudioDump');
    return true;
}

function startWindowsAudioCapture(geminiSessionRef) {
    const args = ['-f', 'wasapi', '-i', 'default', '-ac', String(CHANNELS), '-ar', String(SAMPLE_RATE), '-f', 's16le', '-'];
    systemAudioProc = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    if (!systemAudioProc.pid) {
        logger.error('Failed to start ffmpeg for WASAPI');
        return false;
    }
    setupPcmPipeline(geminiSessionRef, 'ffmpeg (WASAPI)');
    return true;
}

function startLinuxAudioCapture(geminiSessionRef) {
    const backend = process.env.LINUX_AUDIO_BACKEND === 'pipewire' ? 'pipewire' : 'pulse';
    const args = ['-f', backend, '-i', 'default', '-ac', String(CHANNELS), '-ar', String(SAMPLE_RATE), '-f', 's16le', '-'];
    systemAudioProc = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    if (!systemAudioProc.pid) {
        logger.error('Failed to start ffmpeg for Linux audio');
        return false;
    }
    setupPcmPipeline(geminiSessionRef, `ffmpeg (${backend})`);
    return true;
}

function setupPcmPipeline(geminiSessionRef, label) {
    let audioBuffer = Buffer.alloc(0);

    systemAudioProc.stdout.on('data', data => {
        audioBuffer = Buffer.concat([audioBuffer, data]);
        while (audioBuffer.length >= CHUNK_SIZE) {
            const chunk = audioBuffer.slice(0, CHUNK_SIZE);
            audioBuffer = audioBuffer.slice(CHUNK_SIZE);
            const monoChunk = CHANNELS === 2 ? convertStereoToMono(chunk) : chunk;
            const base64Data = monoChunk.toString('base64');
            sendAudioToGemini(base64Data, geminiSessionRef);
            if (process.env.DEBUG_AUDIO) {
                saveDebugAudio(monoChunk, 'system_audio');
            }
        }
        const maxBufferSize = SAMPLE_RATE * BYTES_PER_SAMPLE * 1;
        if (audioBuffer.length > maxBufferSize) {
            audioBuffer = audioBuffer.slice(-maxBufferSize);
        }
    });

    systemAudioProc.stderr.on('data', data => {
        logger.error(`${label} stderr:`, data.toString());
    });

    systemAudioProc.on('close', () => {
        systemAudioProc = null;
    });

    systemAudioProc.on('error', err => {
        logger.error(`${label} process error:`, err);
        systemAudioProc = null;
    });
}

async function startSystemAudioCapture(geminiSessionRef) {
    await stopSystemAudioCapture();
    if (process.platform === 'darwin') {
        return startMacOSAudioCapture(geminiSessionRef);
    }
    if (process.platform === 'win32') {
        return startWindowsAudioCapture(geminiSessionRef);
    }
    if (process.platform === 'linux') {
        return startLinuxAudioCapture(geminiSessionRef);
    }
    logger.warn(`System audio capture not supported on ${process.platform}`);
    return false;
}

function convertStereoToMono(stereoBuffer) {
    const samples = stereoBuffer.length / 4;
    const monoBuffer = Buffer.alloc(samples * 2);
    for (let i = 0; i < samples; i++) {
        const leftSample = stereoBuffer.readInt16LE(i * 4);
        monoBuffer.writeInt16LE(leftSample, i * 2);
    }
    return monoBuffer;
}

function stopSystemAudioCapture() {
    if (systemAudioProc) {
        systemAudioProc.kill('SIGTERM');
        systemAudioProc = null;
    }
}

async function sendAudioToGemini(base64Data, geminiSessionRef) {
    if (!geminiSessionRef.current) return;
    try {
        const now = Date.now();
        const energy = computeEnergyFromBase64Pcm16(base64Data);
        const enteringSpeech = !vadSpeaking && energy > VAD_THRESHOLD;
        const stayingSpeech = vadSpeaking && energy > VAD_THRESHOLD - VAD_HYSTERESIS;
        const keepAlive = !vadSpeaking && now - vadLastSendTs > VAD_SILENCE_SEND_MS;
        if (enteringSpeech || stayingSpeech || keepAlive) {
            vadSpeaking = enteringSpeech || stayingSpeech;
            vadLastSendTs = now;
            await geminiSessionRef.current.sendRealtimeInput({
                audio: { data: base64Data, mimeType: 'audio/pcm;rate=24000' },
            });
        }
    } catch (error) {
        logger.error('Error sending audio to Gemini:', error);
    }
}

function computeEnergyFromBase64Pcm16(base64Data) {
    try {
        const buf = Buffer.from(base64Data, 'base64');
        const samples = buf.length / 2;
        if (!samples) return 0;
        let sum = 0;
        for (let i = 0; i < samples; i++) {
            const s = buf.readInt16LE(i * 2);
            sum += Math.abs(s);
        }
        return sum / samples;
    } catch {
        return 0;
    }
}

module.exports = {
    killExistingSystemAudioDump,
    startSystemAudioCapture,
    convertStereoToMono,
    stopSystemAudioCapture,
    sendAudioToGemini,
    computeEnergyFromBase64Pcm16,
};
