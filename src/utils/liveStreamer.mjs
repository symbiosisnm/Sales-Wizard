import { LLMClient } from '../services/llmClient.mjs';
import defaultLogger from './logger.js';
import { generateNotesFromResponse } from './summarizer.mjs';

// Fallback to console if the logger script fails to attach to globalThis
const logger = globalThis.logger || defaultLogger || console;

const JPEG_MIME = 'image/jpeg';
const JPEG_QUALITY = 0.85;
const HAVE_CURRENT_DATA =
  typeof HTMLMediaElement !== 'undefined' && typeof HTMLMediaElement.HAVE_CURRENT_DATA === 'number'
    ? HTMLMediaElement.HAVE_CURRENT_DATA
    : 2;

async function convertCanvasToBlob(canvas) {
  if (!canvas) {
    throw new Error('Canvas not available for conversion');
  }
  if (typeof canvas.convertToBlob === 'function') {
    return canvas.convertToBlob({ type: JPEG_MIME, quality: JPEG_QUALITY });
  }
  return new Promise((resolve, reject) => {
    if (typeof canvas.toBlob !== 'function') {
      reject(new Error('Canvas toBlob is not supported'));
      return;
    }
    canvas.toBlob(blob => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error('Canvas toBlob produced an empty blob'));
      }
    }, JPEG_MIME, JPEG_QUALITY);
  });
}

function ensureCanvas(width, height) {
  if (typeof OffscreenCanvas !== 'undefined') {
    return new OffscreenCanvas(width, height);
  }
  if (typeof document === 'undefined' || !document.createElement) {
    return null;
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

async function bitmapToBlob(bitmap, reusableCanvas) {
  const width = bitmap.width || reusableCanvas?.width || 1;
  const height = bitmap.height || reusableCanvas?.height || 1;
  const canvas = reusableCanvas || ensureCanvas(width, height);
  if (!canvas) {
    throw new Error('No canvas available to convert ImageBitmap');
  }
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const ctx = canvas.getContext('2d', { alpha: false });
  ctx.drawImage(bitmap, 0, 0, width, height);
  return convertCanvasToBlob(canvas);
}

async function createCanvasFrameSource(stream, track) {
  if (typeof document === 'undefined' || !document.createElement) {
    return null;
  }

  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;
  video.style.position = 'fixed';
  video.style.left = '-9999px';
  video.style.top = '-9999px';
  video.style.opacity = '0';

  if (document.body && !video.parentElement) {
    document.body.appendChild(video);
  }

  const waitForReady = () => {
    if (video.readyState >= HAVE_CURRENT_DATA) {
      return Promise.resolve();
    }
    return new Promise(resolve => {
      const handler = () => {
        video.removeEventListener('loadeddata', handler);
        resolve();
      };
      video.addEventListener('loadeddata', handler, { once: true });
    });
  };

  try {
    await video.play();
  } catch (_err) {
    // Autoplay policies may block play(); we can still grab frames once data is ready.
  }

  const initialSettings = (track?.getSettings && track.getSettings()) || {};
  let canvas = ensureCanvas(initialSettings.width || 1280, initialSettings.height || 720);
  if (!canvas) {
    return null;
  }
  const ctx = canvas.getContext('2d', { alpha: false });

  const grabFrame = async () => {
    await waitForReady();
    const width = video.videoWidth || canvas.width;
    const height = video.videoHeight || canvas.height;
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return convertCanvasToBlob(canvas);
  };

  const cleanup = () => {
    try {
      video.pause();
    } catch (_err) {
      /* empty */
    }
    video.srcObject = null;
    if (video.parentElement) {
      video.parentElement.removeChild(video);
    }
  };

  return { grabFrame, cleanup, canvas };
}

async function createScreenFrameSource(track, stream) {
  let canvasSource = null;
  let bitmapCanvas = null;

  const getCanvasFallback = async () => {
    if (!canvasSource) {
      canvasSource = await createCanvasFrameSource(stream, track);
    }
    return canvasSource;
  };

  if (typeof ImageCapture === 'function') {
    try {
      const imageCapture = new ImageCapture(track);
      let preferGrabFrame = false;

      const grabFrame = async () => {
        if (!preferGrabFrame && typeof imageCapture.takePhoto === 'function') {
          try {
            const blob = await imageCapture.takePhoto();
            if (blob) {
              return blob;
            }
          } catch (err) {
            logger.warn('ImageCapture.takePhoto failed, attempting fallback:', err);
            if (typeof imageCapture.grabFrame === 'function') {
              preferGrabFrame = true;
            } else {
              const fallback = await getCanvasFallback();
              if (fallback) {
                return fallback.grabFrame();
              }
              throw err;
            }
          }
        }

        if (typeof imageCapture.grabFrame === 'function') {
          const bitmap = await imageCapture.grabFrame();
          try {
            bitmapCanvas = bitmapCanvas || ensureCanvas(bitmap.width || 1, bitmap.height || 1);
            return await bitmapToBlob(bitmap, bitmapCanvas);
          } finally {
            if (typeof bitmap.close === 'function') {
              bitmap.close();
            }
          }
        }

        const fallback = await getCanvasFallback();
        if (fallback) {
          return fallback.grabFrame();
        }

        throw new Error('No screen capture method available');
      };

      const cleanup = () => {
        if (canvasSource?.cleanup) {
          canvasSource.cleanup();
        }
      };

      return { grabFrame, cleanup };
    } catch (err) {
      logger.warn('ImageCapture initialisation failed, falling back to canvas:', err);
    }
  }

  const fallback = await getCanvasFallback();
  if (fallback) {
    return { grabFrame: fallback.grabFrame, cleanup: fallback.cleanup };
  }

  throw new Error('No supported screen capture API available');
}

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
export async function startLiveStreaming({
  onResponse,
  onStatus = () => {},
  onError = () => {},
  onAudioLevel = () => {},
  onNote = () => {},
}) {
  const client = new LLMClient();
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
      logger.warn('Error handling text:', err);
    }
  };
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
  let screenStream; let frameInterval; let frameCleanup = () => {};

  const stopScreenCapture = () => {
    if (frameInterval) {
      clearInterval(frameInterval);
      frameInterval = null;
    }
    try {
      frameCleanup();
    } catch (cleanupErr) {
      logger.warn('Error during screen capture cleanup:', cleanupErr);
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
    const frameSource = await createScreenFrameSource(track, screenStream);
    frameCleanup = frameSource.cleanup || (() => {});
    frameInterval = setInterval(async () => {
      try {
        const blob = await frameSource.grabFrame();
        if (!blob) {
          return;
        }
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
