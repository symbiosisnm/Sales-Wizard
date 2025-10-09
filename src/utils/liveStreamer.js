import { LLMClient } from '../services/llmClient.js';
import defaultLogger from './logger.js';
import { generateNotesFromResponse } from './summarizer.js';

// Fallback to console if the logger script fails to attach to globalThis
const getLogger = () => globalThis.logger || defaultLogger || console;

async function startElectronLiveStream({ onResponse, onStatus, onError }) {
  const electronApi = typeof window !== 'undefined' ? window?.electron : undefined;
  if (!electronApi || typeof electronApi.startLiveStream !== 'function') {
    throw new Error('Electron live stream API unavailable');
  }

  onStatus('Initializing live stream...');

  let cleanedUp = false;
  let responseListener = null;
  let statusListener = null;

  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    try {
      if (responseListener && typeof electronApi.removeUpdateResponseListener === 'function') {
        electronApi.removeUpdateResponseListener(responseListener);
      }
    } catch (err) {
      logger.warn('Failed to remove live response listener:', err);
    }
    try {
      if (statusListener && typeof electronApi.removeUpdateStatusListener === 'function') {
        electronApi.removeUpdateStatusListener(statusListener);
      }
    } catch (err) {
      logger.warn('Failed to remove live status listener:', err);
    }
    responseListener = null;
    statusListener = null;
  };

  if (typeof electronApi.onUpdateResponse === 'function') {
    responseListener = (_event, payload) => {
      try {
        if (typeof payload === 'string' && payload.length > 0) {
          onResponse(payload);
        }
      } catch (err) {
        logger.warn('Error in live response callback:', err);
      }
    };
    electronApi.onUpdateResponse(responseListener);
  }

  if (typeof electronApi.onUpdateStatus === 'function') {
    statusListener = (_event, status) => {
      try {
        onStatus(status);
        if (typeof status === 'string' && status.toLowerCase().includes('error')) {
          onError(status);
        }
      } catch (err) {
        logger.warn('Error in live status callback:', err);
      }
    };
    electronApi.onUpdateStatus(statusListener);
  }

  try {
    const result = await electronApi.startLiveStream();
    if (!result?.success) {
      throw new Error(result?.error || 'Failed to start live stream');
    }
  } catch (error) {
    const message = error?.message || String(error);
    onError(message);
    cleanup();
    throw error;
  }

  return () => {
    cleanup();
    if (typeof electronApi.stopLiveStream === 'function') {
      Promise.resolve(electronApi.stopLiveStream()).catch(err => {
        logger.warn('Error stopping live stream via IPC:', err);
      });
    }
  };
}

/**
 * Starts streaming microphone audio and screen captures to the backend
 * through {@link LLMClient}. Text responses from the model are forwarded to
 * the provided callbacks. Returns a cleanup function to stop streaming.
 *
 * @param {Object} opts
 * @param {(text:string)=>void} opts.onResponse Called when model emits text
 * @param {(status:object|string)=>void} [opts.onStatus] Status updates from client
 * @param {(err:string)=>void} [opts.onError] Error messages
 * @param {(level:number)=>void} [opts.onAudioLevel] Receives audio level 0-1
 * @returns {Promise<()=>void>} resolves to a stop function
 */
export async function startLiveStreaming({
  onResponse,
  onStatus = () => {},
  onError = () => {},
  onAudioLevel = () => {},
  onNote = () => {},
}) {
  const hasElectronIpc =
    typeof window !== 'undefined' &&
    window?.electron &&
    typeof window.electron.startLiveStream === 'function';

  if (hasElectronIpc) {
    return startElectronLiveStream({ onResponse, onStatus, onError });
  }

  const client = new LLMClient();
  const log = getLogger();
  let audioCleanup = () => {};
  let stopScreenCapture = () => { onStatus('Screen capture ended'); };
  let stopped = false;

  const safeCall = (label, fn) => {
    try {
      fn?.();
    } catch (err) {
      log.warn(`${label} failed:`, err);
    }
  };

  const stopAll = () => {
    if (stopped) return;
    stopped = true;
    const ws = client.ws;
    if (ws && ws.readyState === WebSocket.OPEN) {
      safeCall('Ending live session', () => client.end());
    } else {
      safeCall('Closing WebSocket session', () => {
        try {
          ws?.close?.();
        } catch (err) {
          log.warn('WebSocket close failed:', err);
        }
      });
    }
    safeCall('Cleaning audio stream', () => audioCleanup());
    safeCall('Cleaning screen capture', () => stopScreenCapture());
  };

  client.onText = msg => {
    try {
      if (typeof msg === 'string') {
        onResponse(msg);
      } else {
        if (msg?.text) onResponse(msg.text);
        if (msg?.final) {
          const note = generateNotesFromResponse(msg);
          if (note) onNote(note);
        }
      }
    } catch (err) {
      log.warn('Error handling text:', err);
    }
  };
  client.onStatus = onStatus;
  client.onError = err => {
    const message = typeof err === 'string' ? err : err?.message ? err.message : String(err);
    log.error('Live streaming client error:', err ?? message);
    onError(message);
    if (!stopped) {
      onStatus(`Error: ${message}`);
      stopAll();
    }
  };

  await client.connect();

  if (stopped) {
    return stopAll;
  }

  // Audio capture
  let audioStream;
  try {
    audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    onStatus({ audio: 'capturing', message: 'Microphone streaming' });
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
          onStatus({ audio: 'idle', message: 'Microphone idle' });
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
          onStatus({ audio: 'idle', message: 'Microphone idle' });
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
        onStatus({ audio: 'idle', message: 'Microphone idle' });
      };
    }
  } catch (err) {
    log.warn('Audio streaming failed to initialise:', err);
  }

  // Screen capture
  let screenStream; let frameInterval;
  const disposableNodes = new Set();

  const registerDisposableNode = node => {
    if (node) disposableNodes.add(node);
    return node;
  };

  const cleanupDomNodes = () => {
    disposableNodes.forEach(node => {
      try {
        if (typeof node.pause === 'function') node.pause();
      } catch { /* empty */ }
      try {
        if ('srcObject' in node) node.srcObject = null;
      } catch { /* empty */ }
      try {
        if (typeof node.remove === 'function') node.remove();
        else if (node?.parentNode) node.parentNode.removeChild(node);
      } catch { /* empty */ }
    });
    disposableNodes.clear();
  };

  stopScreenCapture = () => {
    if (frameInterval) {
      clearInterval(frameInterval);
      frameInterval = null;
    }
    if (screenStream) {
      screenStream.getTracks().forEach(t => t.stop());
      screenStream = null;
    }
    cleanupDomNodes();
    onStatus({ screen: 'idle', message: 'Screen capture ended' });
  };

  try {
    screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
    const track = screenStream.getVideoTracks()[0];
    track.onended = stopScreenCapture;
    onStatus({ screen: 'sharing', message: 'Screen capture active' });
    const imageCapture = typeof ImageCapture === 'function' ? new ImageCapture(track) : null;

    const encodeBlobAndSend = async blob => {
      const arrayBuffer = await blob.arrayBuffer();
      const binary = String.fromCharCode.apply(null, new Uint8Array(arrayBuffer));
      const base64 = btoa(binary);
      client.sendJpegBase64(base64, blob.type || 'image/jpeg');
    };

    let bitmapCanvasElement = null;

    const bitmapToBlob = async bitmap => {
      if (!bitmap) throw new Error('No bitmap captured');
      const mime = 'image/jpeg';
      if (typeof OffscreenCanvas !== 'undefined') {
        const canvas = new OffscreenCanvas(bitmap.width || 1, bitmap.height || 1);
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Unable to obtain OffscreenCanvas context');
        ctx.drawImage(bitmap, 0, 0);
        if (typeof canvas.convertToBlob === 'function') {
          return canvas.convertToBlob({ type: mime, quality: 0.9 }).then(blob => {
            bitmap.close?.();
            return blob;
          });
        }
        const blob = await new Promise((resolve, reject) => {
          try {
            const dataUrl = canvas.toDataURL?.(mime, 0.9);
            if (!dataUrl) {
              reject(new Error('OffscreenCanvas toDataURL failed'));
              return;
            }
            const base64 = dataUrl.split(',')[1];
            const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
            resolve(new Blob([bytes], { type: mime }));
          } catch (err) {
            reject(err);
          }
        });
        bitmap.close?.();
        return blob;
      }

      if (typeof document !== 'undefined') {
        if (!bitmapCanvasElement) {
          bitmapCanvasElement = registerDisposableNode(document.createElement('canvas'));
          bitmapCanvasElement.style.position = 'fixed';
          bitmapCanvasElement.style.opacity = '0';
          bitmapCanvasElement.style.pointerEvents = 'none';
          if (document.body) document.body.appendChild(bitmapCanvasElement);
        }
        const canvas = bitmapCanvasElement;
        canvas.width = bitmap.width || canvas.width || 1;
        canvas.height = bitmap.height || canvas.height || 1;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Unable to obtain canvas context');
        ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        const blob = await new Promise((resolve, reject) => {
          canvas.toBlob(b => {
            if (b) resolve(b);
            else reject(new Error('Canvas toBlob returned null'));
          }, mime, 0.9);
        });
        bitmap.close?.();
        return blob;
      }

      throw new Error('No canvas implementation available for bitmap conversion');
    };

    let useGrabFrame = false;
    let useCanvasFallback = false;
    let videoElement = null;
    let canvasElement = null;
    let isCapturing = false;

    const ensureVideoCanvas = () => {
      if (typeof document === 'undefined') {
        throw new Error('Canvas fallback requires document');
      }
      if (!videoElement) {
        videoElement = registerDisposableNode(document.createElement('video'));
        videoElement.muted = true;
        videoElement.autoplay = true;
        videoElement.playsInline = true;
        videoElement.style.position = 'fixed';
        videoElement.style.opacity = '0';
        videoElement.style.pointerEvents = 'none';
        if (document.body) document.body.appendChild(videoElement);
        try {
          videoElement.srcObject = screenStream;
        } catch (err) {
          log.warn('Unable to bind stream to video element:', err);
        }
        const settings = track.getSettings?.() || {};
        if (settings.width) videoElement.width = settings.width;
        if (settings.height) videoElement.height = settings.height;
        if (typeof videoElement.play === 'function') {
          videoElement.play().catch(() => {});
        }
      }
      if (!canvasElement) {
        canvasElement = registerDisposableNode(document.createElement('canvas'));
        canvasElement.style.position = 'fixed';
        canvasElement.style.opacity = '0';
        canvasElement.style.pointerEvents = 'none';
        if (document.body) document.body.appendChild(canvasElement);
      }
      return { videoElement, canvasElement };
    };

    const captureWithCanvas = async () => {
      const { videoElement: vid, canvasElement: canv } = ensureVideoCanvas();
      const width = vid.videoWidth || vid.width || track.getSettings?.().width || 1;
      const height = vid.videoHeight || vid.height || track.getSettings?.().height || 1;
      if ((vid.readyState ?? 0) < 2 && (!width || !height)) {
        return null;
      }
      canv.width = width;
      canv.height = height;
      const ctx = canv.getContext('2d');
      if (!ctx) throw new Error('Unable to obtain canvas context');
      ctx.drawImage(vid, 0, 0, width, height);
      const mime = 'image/jpeg';
      const blob = await new Promise((resolve, reject) => {
        canv.toBlob(b => {
          if (b) resolve(b);
          else reject(new Error('Canvas toBlob returned null'));
        }, mime, 0.9);
      });
      return blob;
    };

    const captureFrame = async () => {
      if (isCapturing) return;
      isCapturing = true;
      try {
        if (!useGrabFrame && !useCanvasFallback && imageCapture?.takePhoto) {
          try {
            const blob = await imageCapture.takePhoto();
            await encodeBlobAndSend(blob);
            return;
          } catch (err) {
            log.warn('ImageCapture.takePhoto failed, attempting grabFrame fallback:', err);
            useGrabFrame = true;
          }
        }

        if ((useGrabFrame || !imageCapture?.takePhoto) && imageCapture?.grabFrame && !useCanvasFallback) {
          try {
            const bitmap = await imageCapture.grabFrame();
            const blob = await bitmapToBlob(bitmap);
            await encodeBlobAndSend(blob);
            return;
          } catch (err) {
            log.warn('ImageCapture.grabFrame failed, attempting canvas fallback:', err);
            useCanvasFallback = true;
          }
        }

        const blob = await captureWithCanvas();
        if (blob) {
          await encodeBlobAndSend(blob);
        }
      } catch (err) {
        log.warn('Error capturing screen frame:', err);
      } finally {
        isCapturing = false;
      }
    };

    frameInterval = setInterval(captureFrame, 1000);
  } catch (err) {
    const msg = err?.name === 'NotAllowedError'
      ? 'Screen capture request was blocked or denied. Your browser may require a reload before prompting again.'
      : `Screen streaming failed to initialise: ${err?.message || err}`;
    log.warn(msg, err);
    onError(msg);
    onStatus(`Error: ${msg}`);
    stopScreenCapture();
    stopAll();
  }

  return stopAll;
}

