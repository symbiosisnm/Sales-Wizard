import { LLMClient } from '../services/llmClient.js';

/**
 * Starts streaming microphone audio and screen captures to the backend
 * through {@link LLMClient}. Text responses from the model are forwarded to
 * the provided callbacks. Returns a cleanup function to stop streaming.
 *
 * @param {Object} opts
 * @param {(text:string)=>void} opts.onResponse Called when model emits text
 * @param {(status:string)=>void} [opts.onStatus] Status updates from client
 * @param {(s:string)=>void} [opts.onConnectionStatus] WebSocket connection state
 * @param {(s:string)=>void} [opts.onAudioStatus] Microphone streaming state
 * @param {(s:string)=>void} [opts.onScreenStatus] Screen capture streaming state
 * @param {(err:string)=>void} [opts.onError] Error messages
 * @returns {Promise<()=>void>} resolves to a stop function
 */
export async function startLiveStreaming({ onResponse, onStatus = () => {}, onConnectionStatus = () => {}, onAudioStatus = () => {}, onScreenStatus = () => {}, onError = () => {} }) {
  const client = new LLMClient();
  client.onText = onResponse;
  client.onStatus = onStatus;
  client.onError = onError;
  client.onConnectionStatus = onConnectionStatus;

  await client.connect();

  // Audio capture
  let audioStream; let audioCleanup = () => {};
  onAudioStatus('starting');
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
          const base64 = btoa(String.fromCharCode(...e.data));
          client.sendPcm16Base64(base64);
        };
        source.connect(node);
        node.connect(audioCtx.destination);
        onAudioStatus('active');
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
          for (let i = 0; i < input.length; i++) {
            const s = Math.max(-1, Math.min(1, input[i]));
            pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
          }
          const binary = String.fromCharCode.apply(null, new Uint8Array(pcm.buffer));
          const base64 = btoa(binary);
          client.sendPcm16Base64(base64);
        };
        onAudioStatus('active');
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
        for (let i = 0; i < input.length; i++) {
          const s = Math.max(-1, Math.min(1, input[i]));
          pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }
        const binary = String.fromCharCode.apply(null, new Uint8Array(pcm.buffer));
        const base64 = btoa(binary);
        client.sendPcm16Base64(base64);
      };
      onAudioStatus('active');
      audioCleanup = () => {
        processor.disconnect();
        cleanup();
      };
    }
  } catch (err) {
    logger.warn('Audio streaming failed to initialise:', err);
    onAudioStatus('error');
  }

  // Screen capture
  let screenStream; let frameInterval;
  onScreenStatus('starting');
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
    onScreenStatus('active');
  } catch (err) {
    logger.warn('Screen streaming failed to initialise:', err);
    onScreenStatus('error');
  }

  return () => {
    client.end();
    audioCleanup();
    onAudioStatus('inactive');
    if (frameInterval) clearInterval(frameInterval);
    if (screenStream) screenStream.getTracks().forEach(t => t.stop());
    onScreenStatus('inactive');
  };
}

