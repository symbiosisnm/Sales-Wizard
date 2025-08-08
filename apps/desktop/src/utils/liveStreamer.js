/*
 * liveStreamer.js
 *
 * Helper module to stream microphone and screen capture to the Cheating Daddy
 * backend via a WebSocket. This module is intended to integrate with the
 * Gemini Live API by sending raw PCM audio and periodic screen snapshots to
 * the backend, which proxies them to Gemini. The backend in turn streams
 * responses back, which are delivered via the `onResponse` callback.
 *
 * Because audio and video streaming can be CPU intensive, the capture
 * intervals and buffer sizes are kept conservative. The function returns
 * a cleanup callback that stops capture and closes the WebSocket.
 */

export async function startLiveStreaming(onResponse) {
  // Open a WebSocket to the backend. The backend should expose a `/live`
  // endpoint that proxies to the Gemini Live API. Note: this assumes the
  // backend is running locally on port 3001.
  const socket = new WebSocket('ws://localhost:3001/live');
  socket.addEventListener('message', event => {
    try {
      const data = JSON.parse(event.data);
      if (data.text) {
        onResponse(data.text);
      }
    } catch (err) {
      console.error('Error parsing live response:', err);
    }
  });

  // Wait for the socket to open before starting capture. If the socket
  // closes prematurely, abort capture.
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve);
    socket.addEventListener('error', () => reject(new Error('WebSocket error')));
  });

  // Capture audio using getUserMedia and stream PCM frames. Audio is
  // resampled to 16 kHz mono for compatibility with Gemini Live. Each
  // ScriptProcessorNode frame is converted to a base64-encoded string and
  // sent as JSON. If the Web Audio API is unavailable, audio capture will
  // silently fail.
  let audioStream;
  let audioCleanup = () => {};
  try {
    audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
    const source = audioCtx.createMediaStreamSource(audioStream);
    const processor = audioCtx.createScriptProcessor(4096, 1, 1);
    source.connect(processor);
    processor.connect(audioCtx.destination);
    processor.onaudioprocess = event => {
      const input = event.inputBuffer.getChannelData(0);
      const pcm = new Int16Array(input.length);
      for (let i = 0; i < input.length; i++) {
        const s = Math.max(-1, Math.min(1, input[i]));
        pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }
      // Convert PCM buffer to base64. Use btoa on a binary string for
      // compatibility in browsers. Note: constructing large strings can
      // impact performance; consider sending ArrayBuffer directly if your
      // backend supports it.
      const binary = String.fromCharCode.apply(null, new Uint8Array(pcm.buffer));
      const base64 = btoa(binary);
      socket.send(
        JSON.stringify({
          audio: base64,
          mimeType: 'audio/pcm;rate=16000'
        })
      );
    };
    audioCleanup = () => {
      processor.disconnect();
      source.disconnect();
      audioStream.getTracks().forEach(t => t.stop());
      audioCtx.close();
    };
  } catch (err) {
    console.warn('Audio streaming failed to initialise:', err);
  }

  // Capture screen using getDisplayMedia and send snapshots every second. The
  // snapshots are sent as base64-encoded images. If getDisplayMedia is not
  // available (e.g., permission denied), screen capture is skipped.
  let screenStream;
  let frameInterval;
  try {
    screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
    const track = screenStream.getVideoTracks()[0];
    const imageCapture = new ImageCapture(track);
    frameInterval = setInterval(async () => {
      try {
        const blob = await imageCapture.takePhoto();
        const arrayBuffer = await blob.arrayBuffer();
        // Convert to base64 using btoa on a binary string.
        const binary = String.fromCharCode.apply(null, new Uint8Array(arrayBuffer));
        const base64 = btoa(binary);
        socket.send(
          JSON.stringify({
            image: base64,
            mimeType: blob.type || 'image/jpeg'
          })
        );
      } catch (err) {
        console.warn('Error capturing screen frame:', err);
      }
    }, 1000);
  } catch (err) {
    console.warn('Screen streaming failed to initialise:', err);
  }

  // Return cleanup function to close WebSocket and stop captures.
  return () => {
    try {
      socket.close();
    } catch (err) {
      console.error('Error closing live socket:', err);
    }
    audioCleanup();
    if (frameInterval) clearInterval(frameInterval);
    if (screenStream) screenStream.getTracks().forEach(t => t.stop());
  };
}