import { LLMClient } from '../services/llmClient.js';

/**
 * Starts streaming microphone audio and screen captures to the backend
 * through {@link LLMClient}. Text responses from the model are forwarded to
 * the provided callbacks. Returns a cleanup function to stop streaming.
 *
 * @param {Object} opts
 * @param {(text:string)=>void} opts.onResponse Called when model emits text
 * @param {(status:string)=>void} [opts.onStatus] Status updates from client
 * @param {(err:string)=>void} [opts.onError] Error messages
 * @param {(level:number)=>void} [opts.onAudioLevel] Receives audio level 0-1
 * @returns {Promise<()=>void>} resolves to a stop function
 */
export async function startLiveStreaming({ onResponse, onStatus = () => {}, onError = () => {}, onAudioLevel = () => {} }) {
  const client = new LLMClient();
  client.onText = onResponse;
  client.onStatus = onStatus;
  client.onError = onError;

  await client.connect();

  // Audio capture
  let audioStream; let audioCleanup = () => {};
  try {
    audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
    const source = audioCtx.createMediaStreamSource(audioStream);

    const cleanup = () => {
      source.disconnect();
      audioStream.getTracks().forEach(t => t.stop());
      audioCtx.close();
    };

    if (audioCtx.audioWorklet) {
      try {
        await audioCtx.audioWorklet.addModule(new URL('./pcm16-worklet.js', import.meta.url));
        const node = new AudioWorkletNode(audioCtx, 'pcm16-worklet', {
          processorOptions: { targetSampleRate: 16000, samplesPerChunk: 1600 }
        });
        node.port.onmessage = e => {
          const bytes = e.data;
          const base64 = btoa(String.fromCharCode(...bytes));
          client.sendPcm16Base64(base64);
          try {
            const view = new Int16Array(bytes.buffer, bytes.byteOffset, bytes.length / 2);
            let sum = 0;
            for (let i = 0; i < view.length; i++) sum += view[i] * view[i];
            const rms = Math.sqrt(sum / view.length) / 32768;
            onAudioLevel(rms);
          } catch {
            /* empty */
          }
        };
        source.connect(node);
        node.connect(audioCtx.destination);
        audioCleanup = () => {
          node.disconnect();
          cleanup();
        };
      } catch (err) {
        console.warn('AudioWorklet init failed, falling back to ScriptProcessor:', err);
        const processor = audioCtx.createScriptProcessor(4096, 1, 1);
        source.connect(processor);
        processor.connect(audioCtx.destination);
        processor.onaudioprocess = e => {
          const input = e.inputBuffer.getChannelData(0);
          const pcm = new Int16Array(input.length);
          let sum = 0;
          for (let i = 0; i < input.length; i++) {
            const s = Math.max(-1, Math.min(1, input[i]));
            pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
            sum += s * s;
          }
          const binary = String.fromCharCode.apply(null, new Uint8Array(pcm.buffer));
          const base64 = btoa(binary);
          client.sendPcm16Base64(base64);
          onAudioLevel(Math.sqrt(sum / input.length));
        };
        audioCleanup = () => {
          processor.disconnect();
          cleanup();
        };
      }
    } else {
      console.warn('AudioWorklet not supported, using ScriptProcessor');
      const processor = audioCtx.createScriptProcessor(4096, 1, 1);
      source.connect(processor);
      processor.connect(audioCtx.destination);
      processor.onaudioprocess = e => {
        const input = e.inputBuffer.getChannelData(0);
        const pcm = new Int16Array(input.length);
        let sum = 0;
        for (let i = 0; i < input.length; i++) {
          const s = Math.max(-1, Math.min(1, input[i]));
          pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
          sum += s * s;
        }
        const binary = String.fromCharCode.apply(null, new Uint8Array(pcm.buffer));
        const base64 = btoa(binary);
        client.sendPcm16Base64(base64);
        onAudioLevel(Math.sqrt(sum / input.length));
      };
      audioCleanup = () => {
        processor.disconnect();
        cleanup();
      };
    }
  } catch (err) {
    logger.warn('Audio streaming failed to initialise:', err);
  }

  // Screen capture
  let screenStream; let frameInterval;

  const stopScreenCapture = () => {
    if (frameInterval) {
      clearInterval(frameInterval);
      frameInterval = null;
    }
    if (screenStream) {
      screenStream.getTracks().forEach(t => t.stop());
      screenStream = null;
    }
    onStatus('Screen capture ended');
  };

  try {
    screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
    const track = screenStream.getVideoTracks()[0];
    track.onended = stopScreenCapture;
    const imageCapture = new ImageCapture(track);
    frameInterval = setInterval(async () => {
      try {
        const blob = await imageCapture.takePhoto();
        const arrayBuffer = await blob.arrayBuffer();
        const binary = String.fromCharCode.apply(null, new Uint8Array(arrayBuffer));
        const base64 = btoa(binary);
        client.sendJpegBase64(base64, blob.type || 'image/jpeg');
      } catch (err) {
        logger.warn('Error capturing screen frame:', err);
      }
    }, 1000);
  } catch (err) {
    const msg = err?.name === 'NotAllowedError'
      ? 'Screen capture request was blocked or denied. Your browser may require a reload before prompting again.'
      : `Screen streaming failed to initialise: ${err?.message || err}`;
    logger.warn(msg, err);
    onError(msg);
    stopScreenCapture();
  }

  return () => {
    client.end();
    audioCleanup();
    stopScreenCapture();
  };
}

