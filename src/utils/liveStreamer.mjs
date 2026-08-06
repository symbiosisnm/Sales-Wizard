import { LLMClient } from '../services/llmClient.mjs';
import { generateNotesFromResponse } from './summarizer.mjs';

function getLogger() {
  return globalThis.logger || console;
}

const JPEG_MIME = 'image/jpeg';
const HAVE_CURRENT_DATA =
  typeof HTMLMediaElement !== 'undefined' && typeof HTMLMediaElement.HAVE_CURRENT_DATA === 'number'
    ? HTMLMediaElement.HAVE_CURRENT_DATA
    : 2;

function resolveJpegQuality(imageQuality = 'medium') {
  switch (String(imageQuality || '').toLowerCase()) {
    case 'low':
      return 0.55;
    case 'high':
      return 0.85;
    default:
      return 0.72;
  }
}

function resolveMaxFrameEdge(imageQuality = 'medium') {
  switch (String(imageQuality || '').toLowerCase()) {
    case 'high':
      return 1280;
    case 'low':
      return 720;
    default:
      return 960;
  }
}

function fitWithinMaxEdge(width, height, maxEdge) {
  const safeWidth = Math.max(1, Number(width) || 1);
  const safeHeight = Math.max(1, Number(height) || 1);
  const edge = Math.max(safeWidth, safeHeight);
  if (!maxEdge || edge <= maxEdge) {
    return { width: safeWidth, height: safeHeight };
  }
  const scale = maxEdge / edge;
  return {
    width: Math.max(1, Math.round(safeWidth * scale)),
    height: Math.max(1, Math.round(safeHeight * scale)),
  };
}

function sampleEvenly(items, maxItems) {
  if (!Array.isArray(items) || items.length <= maxItems) {
    return Array.isArray(items) ? items : [];
  }
  const result = [];
  const lastIndex = items.length - 1;
  for (let index = 0; index < maxItems; index += 1) {
    result.push(items[Math.round((index * lastIndex) / (maxItems - 1))]);
  }
  return result;
}

function getMediaDevices() {
  return (
    globalThis.navigator?.mediaDevices ||
    globalThis.window?.navigator?.mediaDevices ||
    globalThis.mediaDevices ||
    null
  );
}

function normalizeSessionOptions(sessionOptions = {}) {
  const videoAssistMode = String(sessionOptions.videoAssistMode || '').trim().toLowerCase();
  return {
    captureSystemAudio: Boolean(sessionOptions.captureSystemAudio),
    rememberImports: Boolean(sessionOptions.rememberImports),
    videoAssistMode:
      videoAssistMode === 'off' || videoAssistMode === 'imported' || videoAssistMode === 'rolling-clip'
        ? videoAssistMode
        : 'rolling-clip',
    clipWindowSeconds: Math.max(
      4,
      Math.min(12, Number.parseInt(sessionOptions.clipWindowSeconds, 10) || 8)
    ),
  };
}

async function convertCanvasToBlob(canvas, imageQuality) {
  if (!canvas) {
    throw new Error('Canvas not available for conversion');
  }
  const quality = resolveJpegQuality(imageQuality);
  if (typeof canvas.convertToBlob === 'function') {
    return canvas.convertToBlob({ type: JPEG_MIME, quality });
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
    }, JPEG_MIME, quality);
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

async function bitmapToBlob(bitmap, reusableCanvas, imageQuality) {
  const sourceWidth = bitmap.width || reusableCanvas?.width || 1;
  const sourceHeight = bitmap.height || reusableCanvas?.height || 1;
  const { width, height } = fitWithinMaxEdge(
    sourceWidth,
    sourceHeight,
    resolveMaxFrameEdge(imageQuality)
  );
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
  return convertCanvasToBlob(canvas, imageQuality);
}

async function createCanvasFrameSource(stream, track, imageQuality) {
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
  const initialSize = fitWithinMaxEdge(
    initialSettings.width || 1280,
    initialSettings.height || 720,
    resolveMaxFrameEdge(imageQuality)
  );
  let canvas = ensureCanvas(initialSize.width, initialSize.height);
  if (!canvas) {
    return null;
  }
  const ctx = canvas.getContext('2d', { alpha: false });

  const grabFrame = async () => {
    await waitForReady();
    const { width, height } = fitWithinMaxEdge(
      video.videoWidth || canvas.width,
      video.videoHeight || canvas.height,
      resolveMaxFrameEdge(imageQuality)
    );
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return convertCanvasToBlob(canvas, imageQuality);
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

async function createScreenFrameSource(track, stream, imageQuality) {
  let canvasSource = null;
  let bitmapCanvas = null;

  const getCanvasFallback = async () => {
    if (!canvasSource) {
      canvasSource = await createCanvasFrameSource(stream, track, imageQuality);
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
            getLogger().warn('ImageCapture.takePhoto failed, attempting fallback:', err);
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
            return await bitmapToBlob(bitmap, bitmapCanvas, imageQuality);
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
      getLogger().warn('ImageCapture initialisation failed, falling back to canvas:', err);
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
 * @param {string} [opts.screenshotIntervalSeconds] Automatic frame cadence
 * @param {string} [opts.imageQuality] JPEG quality preference
 * @returns {Promise<()=>void>} resolves to a stop function
 */
export async function startLiveStreaming({
  onResponse,
  onStatus = () => {},
  onError = () => {},
  onAudioLevel = () => {},
  onNote = () => {},
  onTranscript = () => {},
  onHelpCards = () => {},
  onScreenPreview = () => {},
  onVisualContext = () => {},
  onFocusContext = () => {},
  apiKey,
  focusConfig = {},
  profile,
  language,
  sessionId = '',
  sessionOptions = {},
  customPrompt = '',
  contextParams = {},
  imageQuality = 'medium',
  screenshotIntervalSeconds = '5',
}) {
  const client = new LLMClient();
  let normalizedSessionOptions = normalizeSessionOptions(sessionOptions);
  let stopped = false;
  let audioPaused = false;
  let captureCurrentScreenFrame = async () => {};
  let audioCleanup = () => {};
  let stopScreenCapture = () => {};
  let lastErrorMessage = '';
  const recentScreenFrames = [];
  let lastRollingClipHash = '';

  const stopLocalCapture = () => {
    if (stopped) {
      return;
    }
    stopped = true;
    audioCleanup();
    stopScreenCapture();
    onAudioLevel(0);
  };

  const pushRecentFrame = dataUrl => {
    if (!dataUrl) {
      return;
    }
    const cutoff = Date.now() - normalizedSessionOptions.clipWindowSeconds * 1000;
    recentScreenFrames.push({
      capturedAt: Date.now(),
      dataUrl,
    });
    while (recentScreenFrames.length > 16 || recentScreenFrames[0]?.capturedAt < cutoff) {
      recentScreenFrames.shift();
    }
  };

  const maybeSendRollingClip = title => {
    if (normalizedSessionOptions.videoAssistMode !== 'rolling-clip') {
      return;
    }
    const clipFrames = sampleEvenly(
      recentScreenFrames.map(frame => frame.dataUrl).filter(Boolean),
      4
    );
    if (clipFrames.length < 2) {
      return;
    }
    const clipHash = `${clipFrames.length}:${clipFrames[0].slice(-96)}:${clipFrames.at(-1).slice(-96)}`;
    if (clipHash === lastRollingClipHash) {
      return;
    }
    lastRollingClipHash = clipHash;
    client.sendClipFrames({
      title: title || 'Rolling live clip',
      frames: clipFrames,
      windowSeconds: normalizedSessionOptions.clipWindowSeconds,
    });
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
      getLogger().warn('Error handling text:', err);
    }
  };
  client.onStatus = status => {
    if (lastErrorMessage && status === 'WS closed') {
      return;
    }
    onStatus(status);
  };
  client.onError = error => {
    lastErrorMessage = String(error || '').trim();
    onError(error);
  };
  client.onTranscript = transcript => {
    if (transcript) {
      maybeSendRollingClip(transcript);
    }
    onTranscript(transcript);
  };
  client.onHelpCards = payload => onHelpCards(payload);
  client.onVisualContext = payload => onVisualContext(payload.context || null);
  client.onFocusContext = payload => onFocusContext(payload.focus || null);
  client.onClose = ({ intentional } = {}) => {
    if (!intentional) {
      stopLocalCapture();
      if (!lastErrorMessage) {
        onStatus('Live session stopped');
      }
    }
  };

  await client.connect({
    apiKey,
    contextParams,
    customPrompt,
    focusConfig,
    language,
    profile,
    sessionId,
    sessionOptions: normalizedSessionOptions,
  });
  const mediaDevices = getMediaDevices();

  // Audio capture
  let audioStream;
  let audioCtx = null;
  let audioNode = null;
  let audioNodeCleanup = () => {};
  const attachedAudioSources = [];
  const attachedAudioStreams = [];

  const detachAudioSources = () => {
    while (attachedAudioSources.length) {
      try {
        attachedAudioSources.pop().disconnect();
      } catch (_err) {
        /* empty */
      }
    }
  };

  const createAudioNodeHelpers = () => ({
    handleChunk(bytes) {
      if (audioPaused) {
        onAudioLevel(0);
        return;
      }
      const base64 = btoa(String.fromCharCode(...bytes));
      client.sendPcm16Base64(base64, 'audio/pcm;rate=24000');
      try {
        const view = new Int16Array(bytes.buffer, bytes.byteOffset, bytes.length / 2);
        let sum = 0;
        for (let index = 0; index < view.length; index += 1) {
          sum += view[index] * view[index];
        }
        const rms = Math.sqrt(sum / view.length) / 32768;
        onAudioLevel(rms);
      } catch {
        /* empty */
      }
    },
    handleFloatInput(input) {
      if (audioPaused) {
        onAudioLevel(0);
        return;
      }
      const pcm = new Int16Array(input.length);
      let sum = 0;
      for (let index = 0; index < input.length; index += 1) {
        const sample = Math.max(-1, Math.min(1, input[index]));
        pcm[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
        sum += sample * sample;
      }
      const base64 = btoa(String.fromCharCode.apply(null, new Uint8Array(pcm.buffer)));
      client.sendPcm16Base64(base64, 'audio/pcm;rate=24000');
      onAudioLevel(Math.sqrt(sum / input.length));
    },
  });

  const ensureAudioPipeline = async () => {
    if (audioCtx && audioNode) {
      return;
    }

    const AudioContextCtor =
      globalThis.AudioContext ||
      globalThis.webkitAudioContext ||
      globalThis.window?.AudioContext ||
      globalThis.window?.webkitAudioContext;
    if (!AudioContextCtor) {
      throw new Error('AudioContext is not available');
    }

    audioCtx = new AudioContextCtor({ sampleRate: 24000 });
    const helpers = createAudioNodeHelpers();

    if (audioCtx.audioWorklet) {
      try {
        await audioCtx.audioWorklet.addModule(new URL('./pcm16-worklet.js', import.meta.url));
        if (stopped) {
          return;
        }
        const node = new AudioWorkletNode(audioCtx, 'pcm16-worklet', {
          processorOptions: { targetSampleRate: 24000, samplesPerChunk: 2400 },
        });
        node.port.onmessage = event => {
          helpers.handleChunk(event.data);
        };
        node.connect(audioCtx.destination);
        audioNode = node;
        audioNodeCleanup = () => {
          try {
            node.disconnect();
          } catch (_err) {
            /* empty */
          }
        };
        return;
      } catch (err) {
        getLogger().warn('AudioWorklet init failed, falling back to ScriptProcessor:', err);
      }
    }

    const processor = audioCtx.createScriptProcessor(4096, 1, 1);
    processor.connect(audioCtx.destination);
    processor.onaudioprocess = event => {
      helpers.handleFloatInput(event.inputBuffer.getChannelData(0));
    };
    audioNode = processor;
    audioNodeCleanup = () => {
      try {
        processor.disconnect();
      } catch (_err) {
        /* empty */
      }
    };
  };

  const attachAudioStream = async stream => {
    const audioTracks = stream?.getAudioTracks?.() || [];
    if (!audioTracks.length) {
      return false;
    }
    await ensureAudioPipeline();
    const sourceStream = new MediaStream(audioTracks);
    const source = audioCtx.createMediaStreamSource(sourceStream);
    source.connect(audioNode);
    attachedAudioSources.push(source);
    attachedAudioStreams.push(stream);
    return true;
  };

  const cleanupAudioGraph = () => {
    detachAudioSources();
    attachedAudioStreams.forEach(stream => {
      stream?.getTracks?.().forEach(track => track.stop());
    });
    attachedAudioStreams.length = 0;
    audioNodeCleanup();
    if (audioCtx) {
      void audioCtx.close();
      audioCtx = null;
    }
    audioNode = null;
  };
  audioCleanup = cleanupAudioGraph;
  const startAudioCapture = async () => {
    try {
      if (!mediaDevices?.getUserMedia) {
        throw new Error('MediaDevices.getUserMedia is not available');
      }
      audioStream = await mediaDevices.getUserMedia({ audio: true });
      if (stopped) {
        audioStream.getTracks().forEach(t => t.stop());
        return;
      }
      await attachAudioStream(audioStream);
      audioCleanup = cleanupAudioGraph;
    } catch (err) {
      getLogger().warn('Audio streaming failed to initialise:', err);
    }
  };

  // Screen capture
  let screenStream; let frameInterval; let frameCleanup = () => {};
  let screenCaptureStopped = false;
  const frameIntervalMs = Math.max(1000, Number.parseInt(screenshotIntervalSeconds, 10) * 1000 || 5000);
  const manualOnlyScreenshots = String(screenshotIntervalSeconds).toLowerCase() === 'manual';

  stopScreenCapture = () => {
    if (screenCaptureStopped) {
      return;
    }
    screenCaptureStopped = true;
    if (frameInterval) {
      clearInterval(frameInterval);
      frameInterval = null;
    }
    try {
      frameCleanup();
    } catch (cleanupErr) {
      getLogger().warn('Error during screen capture cleanup:', cleanupErr);
    }
    if (screenStream) {
      screenStream.getTracks().forEach(t => t.stop());
      screenStream = null;
    }
    onStatus('Screen capture ended');
  };

  const startScreenCapture = async () => {
    try {
      if (!mediaDevices?.getDisplayMedia) {
        throw new Error('MediaDevices.getDisplayMedia is not available');
      }
      screenStream = await mediaDevices.getDisplayMedia({
        video: true,
        audio: normalizedSessionOptions.captureSystemAudio,
      });
      if (stopped) {
        screenStream.getTracks().forEach(t => t.stop());
        return;
      }
      if (normalizedSessionOptions.captureSystemAudio) {
        const attached = await attachAudioStream(screenStream).catch(() => false);
        if (!attached) {
          onStatus('System audio unavailable for this shared screen');
        } else {
          onStatus('System audio mixed into live capture');
        }
      }
      const track = screenStream.getVideoTracks()[0];
      track.onended = stopScreenCapture;
      const frameSource = await createScreenFrameSource(track, screenStream, imageQuality);
      frameCleanup = frameSource.cleanup || (() => {});
      const captureAndSendFrame = async () => {
        try {
          const blob = await frameSource.grabFrame();
          if (!blob) {
            return;
          }
          const arrayBuffer = await blob.arrayBuffer();
          const binary = String.fromCharCode.apply(null, new Uint8Array(arrayBuffer));
          const base64 = btoa(binary);
          client.sendJpegBase64(base64, blob.type || 'image/jpeg');
          const dataUrl = `data:${blob.type || 'image/jpeg'};base64,${base64}`;
          pushRecentFrame(dataUrl);
          onScreenPreview({
            capturedAt: Date.now(),
            dataUrl,
          });
        } catch (err) {
          getLogger().warn('Error capturing screen frame:', err);
        }
      };
      captureCurrentScreenFrame = captureAndSendFrame;
      await captureAndSendFrame();
      if (!manualOnlyScreenshots) {
        frameInterval = setInterval(() => {
          void captureAndSendFrame();
        }, frameIntervalMs);
      }
    } catch (err) {
      const msg = err?.name === 'NotAllowedError'
        ? 'Screen capture request was blocked or denied. Your browser may require a reload before prompting again.'
        : `Screen streaming failed to initialise: ${err?.message || err}`;
      getLogger().warn(msg, err);
      onError(msg);
      stopScreenCapture();
    }
  };

  void startAudioCapture();
  void startScreenCapture();

  const stop = () => {
    client.end();
    stopLocalCapture();
  };
  const captureLatestFrameInBackground = () => {
    Promise.resolve()
      .then(() => captureCurrentScreenFrame())
      .catch(() => {
        /* empty */
      });
  };
  stop.sendText = text => {
    client.sendText(text);
    maybeSendRollingClip(text);
  };
  stop.refreshHelp = text => {
    captureLatestFrameInBackground();
    maybeSendRollingClip(text);
    client.refreshHelp(text);
  };
  stop.refreshResponse = (text, refreshHelp = false) => {
    captureLatestFrameInBackground();
    maybeSendRollingClip(text);
    client.refreshResponse(text, refreshHelp);
  };
  stop.toggleMicrophone = () => {
    audioPaused = !audioPaused;
    if (audioPaused) {
      onAudioLevel(0);
    }
    onStatus(audioPaused ? 'Microphone muted' : 'Microphone live');
    return audioPaused;
  };
  stop.setVisualContext = context => {
    client.sendVisualContext(context);
  };
  stop.clearVisualContext = () => {
    client.clearVisualContext();
  };
  stop.updateFocusConfig = (config, profile) => {
    client.updateFocusConfig(config, profile);
  };
  stop.updateSessionOptions = options => {
    const previous = normalizedSessionOptions;
    normalizedSessionOptions = normalizeSessionOptions({
      ...normalizedSessionOptions,
      ...(options || {}),
    });
    client.updateSessionOptions(normalizedSessionOptions);
    if (previous.captureSystemAudio !== normalizedSessionOptions.captureSystemAudio) {
      onStatus('Restart the session to apply the system-audio capture change');
    }
  };
  return stop;
}
