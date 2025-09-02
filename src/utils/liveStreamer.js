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
 * @returns {Promise<()=>void>} resolves to a stop function
 */
export async function startLiveStreaming({ onResponse, onStatus = () => {}, onError = () => {} }) {
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
    const processor = audioCtx.createScriptProcessor(4096, 1, 1);
    source.connect(processor);
    processor.connect(audioCtx.destination);
    processor.onaudioprocess = e => {
      const input = e.inputBuffer.getChannelData(0);
      const pcm = new Int16Array(input.length);
      for (let i = 0; i < input.length; i++) {
        const s = Math.max(-1, Math.min(1, input[i]));
        pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }
      const binary = String.fromCharCode.apply(null, new Uint8Array(pcm.buffer));
      const base64 = btoa(binary);
      client.sendPcm16Base64(base64);
    };
    audioCleanup = () => {
      processor.disconnect();
      source.disconnect();
      audioStream.getTracks().forEach(t => t.stop());
      audioCtx.close();
    };
  } catch (err) {
    logger.warn('Audio streaming failed to initialise:', err);
  }

  // Screen capture
  let screenStream; let frameInterval;
  try {
    screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
    const track = screenStream.getVideoTracks()[0];
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
    logger.warn('Screen streaming failed to initialise:', err);
  }

  return () => {
    client.end();
    audioCleanup();
    if (frameInterval) clearInterval(frameInterval);
    if (screenStream) screenStream.getTracks().forEach(t => t.stop());
  };
}

