// renderer.js
const { ipcRenderer } = window.electron || {};

// Initialize random display name for UI components
window.randomDisplayName = null;

// Request random display name from main process
ipcRenderer
    .invoke('get-random-display-name')
    .then(name => {
        window.randomDisplayName = name;
        logger.info('Set random display name:', name);
    })
    .catch(err => {
        logger.warn('Could not get random display name:', err);
        window.randomDisplayName = 'System Monitor';
    });

let mediaStream = null;
let screenCapturer = null;
let audioContext = null;
let audioProcessor = null;
let micAudioProcessor = null;
const SAMPLE_RATE = 24000;
const AUDIO_CHUNK_DURATION = 0.1; // seconds
const BUFFER_SIZE = 4096; // Increased buffer size for smoother audio
const PCM_WORKLET_URL = 'utils/pcm16-worklet.js';

let hiddenVideo = null;
let offscreenCanvas = null;
let offscreenContext = null;
let currentImageQuality = 'medium'; // Store current image quality for manual screenshots
let lastCursorPoint = null;
let lastActiveWindow = null;
let screenshotRegionMode = 'full';

let pttMicContext = null;
let pttMicStream = null;
let micEnabled = false;

const isLinux = process.platform === 'linux';
const isMacOS = process.platform === 'darwin';

// Periodically fetch cursor location from main process
function startCursorTracking() {
    if (!window.electron?.ipcRenderer) return;
    const poll = async () => {
        try {
            const res = await window.electron.ipcRenderer.invoke('get-cursor-point');
            if (res?.success) lastCursorPoint = res;
        } catch (_e) {
            /* empty */
        }
    };
    setInterval(poll, 300);
    poll();
}
startCursorTracking();

// Periodically fetch active window bounds from main process
function startActiveWindowTracking() {
    if (!window.electron?.ipcRenderer) return;
    const poll = async () => {
        try {
            const res = await window.electron.ipcRenderer.invoke('get-active-window');
            if (res?.success) lastActiveWindow = res;
        } catch (_e) {
            /* empty */
        }
    };
    setInterval(poll, 500);
    poll();
}
startActiveWindowTracking();

// Token tracking system for rate limiting
let tokenTracker = {
    tokens: [], // Array of {timestamp, count, type} objects
    audioStartTime: null,

    // Add tokens to the tracker
    addTokens(count, type = 'image') {
        const now = Date.now();
        this.tokens.push({
            timestamp: now,
            count: count,
            type: type,
        });

        // Clean old tokens (older than 1 minute)
        this.cleanOldTokens();
    },

    // Calculate image tokens based on Gemini 2.0 rules
    calculateImageTokens(width, height) {
        // Images ≤384px in both dimensions = 258 tokens
        if (width <= 384 && height <= 384) {
            return 258;
        }

        // Larger images are tiled into 768x768 chunks, each = 258 tokens
        const tilesX = Math.ceil(width / 768);
        const tilesY = Math.ceil(height / 768);
        const totalTiles = tilesX * tilesY;

        return totalTiles * 258;
    },

    // Track audio tokens continuously
    trackAudioTokens() {
        if (!this.audioStartTime) {
            this.audioStartTime = Date.now();
            return;
        }

        const now = Date.now();
        const elapsedSeconds = (now - this.audioStartTime) / 1000;

        // Audio = 32 tokens per second
        const audioTokens = Math.floor(elapsedSeconds * 32);

        if (audioTokens > 0) {
            this.addTokens(audioTokens, 'audio');
            this.audioStartTime = now;
        }
    },

    // Clean tokens older than 1 minute
    cleanOldTokens() {
        const oneMinuteAgo = Date.now() - 60 * 1000;
        this.tokens = this.tokens.filter(token => token.timestamp > oneMinuteAgo);
    },

    // Get total tokens in the last minute
    getTokensInLastMinute() {
        this.cleanOldTokens();
        return this.tokens.reduce((total, token) => total + token.count, 0);
    },

    // Check if we should throttle based on settings
    shouldThrottle() {
        // Get rate limiting settings from localStorage
        const throttleEnabled = localStorage.getItem('throttleTokens') === 'true';
        if (!throttleEnabled) {
            return false;
        }

        const maxTokensPerMin = parseInt(localStorage.getItem('maxTokensPerMin') || '1000000', 10);
        const throttleAtPercent = parseInt(localStorage.getItem('throttleAtPercent') || '75', 10);

        const currentTokens = this.getTokensInLastMinute();
        const throttleThreshold = Math.floor((maxTokensPerMin * throttleAtPercent) / 100);

        logger.info(`Token check: ${currentTokens}/${maxTokensPerMin} (throttle at ${throttleThreshold})`);

        return currentTokens >= throttleThreshold;
    },

    // Reset the tracker
    reset() {
        this.tokens = [];
        this.audioStartTime = null;
    },
};

// Track audio tokens every few seconds
setInterval(() => {
    tokenTracker.trackAudioTokens();
}, 2000);

function convertFloat32ToInt16(float32Array) {
    const int16Array = new Int16Array(float32Array.length);
    for (let i = 0; i < float32Array.length; i++) {
        // Improved scaling to prevent clipping
        const s = Math.max(-1, Math.min(1, float32Array[i]));
        int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return int16Array;
}

function arrayBufferToBase64(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

async function createPcmWorkletNode(ctx, onChunk) {
    if (!ctx.audioWorklet) {
        console.warn('AudioWorklet not supported, falling back to ScriptProcessor');
        return null;
    }
    try {
        await ctx.audioWorklet.addModule(PCM_WORKLET_URL);
        const node = new AudioWorkletNode(ctx, 'pcm16-worklet', {
            processorOptions: {
                targetSampleRate: SAMPLE_RATE,
                samplesPerChunk: SAMPLE_RATE * AUDIO_CHUNK_DURATION,
            },
        });
        node.port.onmessage = e => onChunk(e.data);
        return node;
    } catch (err) {
        console.warn('Failed to initialise AudioWorklet:', err);
        return null;
    }
}

async function initializeGemini(profile = 'interview', language = 'en-US') {
    let apiKey = null;
    try {
        const res = await ipcRenderer.invoke('secure-get-api-key');
        if (res?.success && res.value) apiKey = res.value.trim();
    } catch (_e) {
        /* empty */
    }
    if (!apiKey) {
        apiKey = localStorage.getItem('apiKey')?.trim();
    }
    if (apiKey) {
        const success = await ipcRenderer.invoke('initialize-gemini', apiKey, localStorage.getItem('customPrompt') || '', profile, language);
        if (success) {
            cheddar.setStatus('Live');
        } else {
            cheddar.setStatus('error');
        }
    }
}

// Listen for status updates
ipcRenderer.on('update-status', (event, status) => {
    logger.info('Status update:', status);
    cheddar.setStatus(status);
});

// Listen for responses - REMOVED: This is handled in CheatingDaddyApp.js to avoid duplicates
// ipcRenderer.on('update-response', (event, response) => {
//     logger.info('Gemini response:', response);
//     cheddar.e().setResponse(response);
//     // You can add UI elements to display the response if needed
// });

async function startCapture(screenshotIntervalSeconds = 5, imageQuality = 'medium') {
    // Store the image quality for manual screenshots
    currentImageQuality = imageQuality;

    // Reset token tracker when starting new capture session
    tokenTracker.reset();
    logger.info('🎯 Token tracker reset for new capture session');

    // Load screenshot region preference
    try {
        screenshotRegionMode = localStorage.getItem('screenshotRegionMode') || 'full';
    } catch (_e) {
        screenshotRegionMode = 'full';
    }

    try {
        if (isMacOS) {
            // On macOS, use SystemAudioDump for audio and getDisplayMedia for screen
            logger.info('Starting macOS capture with SystemAudioDump...');

            // Start macOS audio capture
            const audioResult = await ipcRenderer.invoke('start-macos-audio');
            if (!audioResult.success) {
                throw new Error('Failed to start macOS audio capture: ' + audioResult.error);
            }

            // Get screen capture for screenshots
            mediaStream = await navigator.mediaDevices.getDisplayMedia({
                video: {
                    frameRate: 1,
                    width: { ideal: 1920 },
                    height: { ideal: 1080 },
                },
                audio: false, // Don't use browser audio on macOS
            });

            logger.info('macOS screen capture started - audio handled by SystemAudioDump');
        } else if (isLinux) {
            // Linux - use display media for screen capture and try to get system audio
            try {
                // First try to get system audio via getDisplayMedia (works on newer browsers)
                mediaStream = await navigator.mediaDevices.getDisplayMedia({
                    video: {
                        frameRate: 1,
                        width: { ideal: 1920 },
                        height: { ideal: 1080 },
                    },
                    audio: {
                        sampleRate: SAMPLE_RATE,
                        channelCount: 1,
                        echoCancellation: false, // Don't cancel system audio
                        noiseSuppression: false,
                        autoGainControl: false,
                    },
                });

                logger.info('Linux system audio capture via getDisplayMedia succeeded');

                // Setup audio processing for Linux system audio
                await setupLinuxSystemAudioProcessing();
            } catch (systemAudioError) {
                logger.warn('System audio via getDisplayMedia failed, trying screen-only capture:', systemAudioError);

                // Fallback to screen-only capture
                mediaStream = await navigator.mediaDevices.getDisplayMedia({
                    video: {
                        frameRate: 1,
                        width: { ideal: 1920 },
                        height: { ideal: 1080 },
                    },
                    audio: false,
                });
            }

            // Additionally get microphone input for Linux
            let micStream = null;
            try {
                micStream = await navigator.mediaDevices.getUserMedia({
                    audio: {
                        sampleRate: SAMPLE_RATE,
                        channelCount: 1,
                        echoCancellation: true,
                        noiseSuppression: true,
                        autoGainControl: true,
                    },
                    video: false,
                });

                logger.info('Linux microphone capture started');

                // Setup audio processing for microphone on Linux
                await setupLinuxMicProcessing(micStream);
            } catch (micError) {
                logger.warn('Failed to get microphone access on Linux:', micError);
                // Continue without microphone if permission denied
            }

            logger.info('Linux capture started - system audio:', mediaStream.getAudioTracks().length > 0, 'microphone:', micStream !== null);
        } else {
            // Windows - use display media with loopback for system audio
            mediaStream = await navigator.mediaDevices.getDisplayMedia({
                video: {
                    frameRate: 1,
                    width: { ideal: 1920 },
                    height: { ideal: 1080 },
                },
                audio: {
                    sampleRate: SAMPLE_RATE,
                    channelCount: 1,
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                },
            });

            logger.info('Windows capture started with loopback audio');

            // Setup audio processing for Windows loopback audio only
            await setupWindowsLoopbackProcessing();
        }

        logger.info('MediaStream obtained:', {
            hasVideo: mediaStream.getVideoTracks().length > 0,
            hasAudio: mediaStream.getAudioTracks().length > 0,
            videoTrack: mediaStream.getVideoTracks()[0]?.getSettings(),
        });

        // Start capturing screenshots - check if manual mode
        if (screenshotIntervalSeconds === 'manual' || screenshotIntervalSeconds === 'Manual') {
            logger.info('Manual mode enabled - screenshots will be captured on demand only');
            // Don't start automatic capture in manual mode
        } else {
            const { startScreenCapture } = await import('./screenCapture.js');
            screenCapturer = await startScreenCapture({
                quality: imageQuality,
                cropRegion: screenshotRegionMode,
            });
            screenCapturer.onFrame(async ({ data, width, height }) => {
                try {
                    const result = await ipcRenderer.invoke('send-image-content', { data });
                    if (result.success) {
                        const imageTokens = tokenTracker.calculateImageTokens(width, height);
                        tokenTracker.addTokens(imageTokens, 'image');
                        logger.info(`📊 Image sent successfully - ${imageTokens} tokens used (${width}x${height})`);
                    } else {
                        logger.error('Failed to send image:', result.error);
                    }
                } catch (err) {
                    logger.error('Failed to send image:', err);
                }
            });
        }
    } catch (err) {
        logger.error('Error starting capture:', err);
        cheddar.setStatus('error');
    }
}

async function setupLinuxMicProcessing(micStream) {
    // Setup microphone audio processing for Linux
    const micAudioContext = new AudioContext({ sampleRate: SAMPLE_RATE });
    const micSource = micAudioContext.createMediaStreamSource(micStream);

    const workletNode = await createPcmWorkletNode(micAudioContext, async bytes => {
        const base64Data = arrayBufferToBase64(bytes.buffer);
        await ipcRenderer.invoke('send-audio-content', {
            data: base64Data,
            mimeType: 'audio/pcm;rate=24000',
        });
    });

    if (workletNode) {
        micSource.connect(workletNode);
        workletNode.connect(micAudioContext.destination);
        micAudioProcessor = workletNode;
        return;
    }

    // Fallback to ScriptProcessor when AudioWorklet unavailable
    const micProcessor = micAudioContext.createScriptProcessor(BUFFER_SIZE, 1, 1);
    let audioBuffer = [];
    const samplesPerChunk = SAMPLE_RATE * AUDIO_CHUNK_DURATION;

    micProcessor.onaudioprocess = async e => {
        const inputData = e.inputBuffer.getChannelData(0);
        audioBuffer.push(...inputData);

        while (audioBuffer.length >= samplesPerChunk) {
            const chunk = audioBuffer.splice(0, samplesPerChunk);
            const pcmData16 = convertFloat32ToInt16(chunk);
            const base64Data = arrayBufferToBase64(pcmData16.buffer);

            await ipcRenderer.invoke('send-audio-content', {
                data: base64Data,
                mimeType: 'audio/pcm;rate=24000',
            });
        }
    };

    micSource.connect(micProcessor);
    micProcessor.connect(micAudioContext.destination);
    micAudioProcessor = micProcessor;
}

async function setupLinuxSystemAudioProcessing() {
    // Setup system audio processing for Linux (from getDisplayMedia)
    audioContext = new AudioContext({ sampleRate: SAMPLE_RATE });
    const source = audioContext.createMediaStreamSource(mediaStream);

    const node = await createPcmWorkletNode(audioContext, async bytes => {
        const base64Data = arrayBufferToBase64(bytes.buffer);
        await ipcRenderer.invoke('send-audio-content', {
            data: base64Data,
            mimeType: 'audio/pcm;rate=24000',
        });
    });

    if (node) {
        source.connect(node);
        node.connect(audioContext.destination);
        audioProcessor = node;
        return;
    }

    // Fallback to ScriptProcessor
    audioProcessor = audioContext.createScriptProcessor(BUFFER_SIZE, 1, 1);
    let audioBuffer = [];
    const samplesPerChunk = SAMPLE_RATE * AUDIO_CHUNK_DURATION;

    audioProcessor.onaudioprocess = async e => {
        const inputData = e.inputBuffer.getChannelData(0);
        audioBuffer.push(...inputData);

        while (audioBuffer.length >= samplesPerChunk) {
            const chunk = audioBuffer.splice(0, samplesPerChunk);
            const pcmData16 = convertFloat32ToInt16(chunk);
            const base64Data = arrayBufferToBase64(pcmData16.buffer);

            await ipcRenderer.invoke('send-audio-content', {
                data: base64Data,
                mimeType: 'audio/pcm;rate=24000',
            });
        }
    };

    source.connect(audioProcessor);
    audioProcessor.connect(audioContext.destination);
}

async function setupWindowsLoopbackProcessing() {
    // Setup audio processing for Windows loopback audio only
    audioContext = new AudioContext({ sampleRate: SAMPLE_RATE });
    const source = audioContext.createMediaStreamSource(mediaStream);

    const node = await createPcmWorkletNode(audioContext, async bytes => {
        const base64Data = arrayBufferToBase64(bytes.buffer);
        await ipcRenderer.invoke('send-audio-content', {
            data: base64Data,
            mimeType: 'audio/pcm;rate=24000',
        });
    });

    if (node) {
        source.connect(node);
        node.connect(audioContext.destination);
        audioProcessor = node;
        return;
    }

    // Fallback to ScriptProcessor
    audioProcessor = audioContext.createScriptProcessor(BUFFER_SIZE, 1, 1);
    let audioBuffer = [];
    const samplesPerChunk = SAMPLE_RATE * AUDIO_CHUNK_DURATION;

    audioProcessor.onaudioprocess = async e => {
        const inputData = e.inputBuffer.getChannelData(0);
        audioBuffer.push(...inputData);

        while (audioBuffer.length >= samplesPerChunk) {
            const chunk = audioBuffer.splice(0, samplesPerChunk);
            const pcmData16 = convertFloat32ToInt16(chunk);
            const base64Data = arrayBufferToBase64(pcmData16.buffer);

            await ipcRenderer.invoke('send-audio-content', {
                data: base64Data,
                mimeType: 'audio/pcm;rate=24000',
            });
        }
    };

    source.connect(audioProcessor);
    audioProcessor.connect(audioContext.destination);
}

// Optional microphone streaming controlled by shortcut
async function enableMicStreaming() {
    if (micEnabled) return;
    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            audio: {
                sampleRate: SAMPLE_RATE,
                channelCount: 1,
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
            },
            video: false,
        });
        pttMicContext = new AudioContext({ sampleRate: SAMPLE_RATE });
        const src = pttMicContext.createMediaStreamSource(stream);

        const node = await createPcmWorkletNode(pttMicContext, async bytes => {
            const base64Data = arrayBufferToBase64(bytes.buffer);
            await ipcRenderer.invoke('send-audio-content', {
                data: base64Data,
                mimeType: 'audio/pcm;rate=24000',
            });
        });

        if (node) {
            src.connect(node);
            node.connect(pttMicContext.destination);
        } else {
            const proc = pttMicContext.createScriptProcessor(BUFFER_SIZE, 1, 1);
            let micBuf = [];
            const samplesPerChunk = SAMPLE_RATE * AUDIO_CHUNK_DURATION;
            proc.onaudioprocess = async e => {
                const inputData = e.inputBuffer.getChannelData(0);
                micBuf.push(...inputData);
                while (micBuf.length >= samplesPerChunk) {
                    const chunk = micBuf.splice(0, samplesPerChunk);
                    const pcm16 = convertFloat32ToInt16(chunk);
                    const base64Data = arrayBufferToBase64(pcm16.buffer);
                    await ipcRenderer.invoke('send-audio-content', {
                        data: base64Data,
                        mimeType: 'audio/pcm;rate=24000',
                    });
                }
            };
            src.connect(proc);
            proc.connect(pttMicContext.destination);
        }
        pttMicStream = stream;
        micEnabled = true;
        logger.info('Microphone streaming enabled');
    } catch (e) {
        logger.error('Failed to enable microphone streaming:', e);
    }
}

function disableMicStreaming() {
    micEnabled = false;
    try {
        if (pttMicStream) {
            pttMicStream.getTracks().forEach(t => t.stop());
            pttMicStream = null;
        }
        if (pttMicContext) {
            pttMicContext.close();
            pttMicContext = null;
        }
        logger.info('Microphone streaming disabled');
    } catch (e) {
        logger.error('Error disabling mic:', e);
    }
}

window.addEventListener('cheddar-toggle-mic', async () => {
    if (micEnabled) {
        disableMicStreaming();
    } else {
        await enableMicStreaming();
    }
});

async function captureScreenshot(imageQuality = 'medium', isManual = false) {
    logger.info(`Capturing ${isManual ? 'manual' : 'automated'} screenshot...`);
    if (!mediaStream) return { success: false, error: 'No media stream' };

    // Check rate limiting for automated screenshots only
    if (!isManual && tokenTracker.shouldThrottle()) {
        logger.info('⚠️ Automated screenshot skipped due to rate limiting');
        return { success: false, error: 'Rate limited' };
    }

    // Lazy init of video element
    if (!hiddenVideo) {
        hiddenVideo = document.createElement('video');
        hiddenVideo.srcObject = mediaStream;
        hiddenVideo.muted = true;
        hiddenVideo.playsInline = true;
        await hiddenVideo.play();

        await new Promise(resolve => {
            if (hiddenVideo.readyState >= 2) return resolve();
            hiddenVideo.onloadedmetadata = () => resolve();
        });

        // Lazy init of canvas based on video dimensions
        offscreenCanvas = document.createElement('canvas');
        offscreenCanvas.width = hiddenVideo.videoWidth;
        offscreenCanvas.height = hiddenVideo.videoHeight;
        offscreenContext = offscreenCanvas.getContext('2d');
    }

    // Check if video is ready
    if (hiddenVideo.readyState < 2) {
        logger.warn('Video not ready yet, skipping screenshot');
        return { success: false, error: 'Video not ready' };
    }

    offscreenContext.drawImage(hiddenVideo, 0, 0, offscreenCanvas.width, offscreenCanvas.height);

    // Optionally crop around cursor to reduce tokens
    let drawCanvas = offscreenCanvas;
    if (screenshotRegionMode === 'cursor' && lastCursorPoint?.success) {
        try {
            const { point, bounds } = lastCursorPoint;
            const screenW = bounds.width;
            const screenH = bounds.height;
            const vx = Math.max(0, Math.min(point.x - bounds.x, screenW));
            const vy = Math.max(0, Math.min(point.y - bounds.y, screenH));
            const sx = Math.floor((vx / screenW) * offscreenCanvas.width);
            const sy = Math.floor((vy / screenH) * offscreenCanvas.height);
            const cropW = Math.min(768, offscreenCanvas.width);
            const cropH = Math.min(432, offscreenCanvas.height);
            const halfW = Math.floor(cropW / 2);
            const halfH = Math.floor(cropH / 2);
            const srcX = Math.max(0, Math.min(offscreenCanvas.width - cropW, sx - halfW));
            const srcY = Math.max(0, Math.min(offscreenCanvas.height - cropH, sy - halfH));
            const cropped = document.createElement('canvas');
            cropped.width = cropW;
            cropped.height = cropH;
            const ctx = cropped.getContext('2d');
            ctx.drawImage(offscreenCanvas, srcX, srcY, cropW, cropH, 0, 0, cropW, cropH);
            drawCanvas = cropped;
        } catch (_e) {
            // ignore and fallback to full frame
        }
    } else if (screenshotRegionMode === 'window' && lastActiveWindow?.success) {
        try {
            const { bounds, displayBounds } = lastActiveWindow;
            const screenW = displayBounds.width;
            const screenH = displayBounds.height;
            const vx = Math.max(0, bounds.x - displayBounds.x);
            const vy = Math.max(0, bounds.y - displayBounds.y);
            const sx = Math.floor((vx / screenW) * offscreenCanvas.width);
            const sy = Math.floor((vy / screenH) * offscreenCanvas.height);
            const cropW = Math.floor((bounds.width / screenW) * offscreenCanvas.width);
            const cropH = Math.floor((bounds.height / screenH) * offscreenCanvas.height);
            const cropped = document.createElement('canvas');
            cropped.width = cropW;
            cropped.height = cropH;
            const ctx = cropped.getContext('2d');
            ctx.drawImage(offscreenCanvas, sx, sy, cropW, cropH, 0, 0, cropW, cropH);
            drawCanvas = cropped;
        } catch (_e) {
            // ignore and fallback to full frame
        }
    }

    // Check if image was drawn properly by sampling a pixel
    const imageData = drawCanvas.getContext('2d').getImageData(0, 0, 1, 1);
    const isBlank = imageData.data.every((value, index) => {
        // Check if all pixels are black (0,0,0) or transparent
        return index === 3 ? true : value === 0;
    });

    if (isBlank) {
        logger.warn('Screenshot appears to be blank/black');
    }

    let qualityValue;
    switch (imageQuality) {
        case 'high':
            qualityValue = 0.9;
            break;
        case 'medium':
            qualityValue = 0.7;
            break;
        case 'low':
            qualityValue = 0.5;
            break;
        default:
            qualityValue = 0.7; // Default to medium
    }

    return new Promise(resolve => {
        drawCanvas.toBlob(
            async blob => {
                if (!blob) {
                    logger.error('Failed to create blob from canvas');
                    return resolve({ success: false, error: 'Blob creation failed' });
                }

                const reader = new FileReader();
                reader.onloadend = async () => {
                    const base64data = reader.result.split(',')[1];

                    // Validate base64 data
                    if (!base64data || base64data.length < 100) {
                        logger.error('Invalid base64 data generated');
                        return resolve({ success: false, error: 'Invalid base64 data' });
                    }

                    try {
                        const result = await ipcRenderer.invoke('send-image-content', {
                            data: base64data,
                        });

                        if (result.success) {
                            // Track image tokens after successful send
                            const imageTokens = tokenTracker.calculateImageTokens(drawCanvas.width, drawCanvas.height);
                            tokenTracker.addTokens(imageTokens, 'image');
                            logger.info(`📊 Image sent successfully - ${imageTokens} tokens used (${drawCanvas.width}x${drawCanvas.height})`);
                        } else {
                            logger.error('Failed to send image:', result.error);
                        }

                        resolve(result);
                    } catch (err) {
                        logger.error('Failed to send image:', err);
                        resolve({ success: false, error: err.message });
                    }
                };
                reader.readAsDataURL(blob);
            },
            'image/jpeg',
            qualityValue
        );
    });
}

async function captureManualScreenshot(imageQuality = null) {
    logger.info('Manual screenshot triggered');
    const quality = imageQuality || currentImageQuality;
    const result = await captureScreenshot(quality, true); // Pass true for isManual
    if (result?.success) {
        await sendTextMessage(`Help me on this page, give me the answer no bs, complete answer.
        So if its a code question, give me the approach in few bullet points, then the entire code. Also if theres anything else i need to know, tell me.
        If its a question about the website, give me the answer no bs, complete answer.
        If its a mcq question, give me the answer no bs, complete answer.
        `);
    } else {
        logger.warn('Skipping text message due to failed screenshot');
    }
}

// Expose functions to global scope for external access
window.captureManualScreenshot = captureManualScreenshot;

function stopCapture() {
    if (screenCapturer) {
        screenCapturer.stop();
        screenCapturer = null;
    }

    if (audioProcessor) {
        audioProcessor.disconnect();
        audioProcessor = null;
    }

    // Clean up microphone audio processor (Linux only)
    if (micAudioProcessor) {
        micAudioProcessor.disconnect();
        micAudioProcessor = null;
    }

    // Stop optional mic streaming
    disableMicStreaming();

    if (audioContext) {
        audioContext.close();
        audioContext = null;
    }

    if (mediaStream) {
        mediaStream.getTracks().forEach(track => track.stop());
        mediaStream = null;
    }

    // Stop macOS audio capture if running
    if (isMacOS) {
        ipcRenderer.invoke('stop-macos-audio').catch(err => {
            logger.error('Error stopping macOS audio:', err);
        });
    }

    // Clean up hidden elements
    if (hiddenVideo) {
        hiddenVideo.pause();
        hiddenVideo.srcObject = null;
        hiddenVideo = null;
    }
    offscreenCanvas = null;
    offscreenContext = null;
}

// Send text message to Gemini
async function sendTextMessage(text) {
    if (!text || text.trim().length === 0) {
        logger.warn('Cannot send empty text message');
        return { success: false, error: 'Empty message' };
    }

    try {
        const result = await ipcRenderer.invoke('send-text-message', text);
        if (result.success) {
            logger.info('Text message sent successfully');
        } else {
            logger.error('Failed to send text message:', result.error);
        }
        return result;
    } catch (error) {
        logger.error('Error sending text message:', error);
        return { success: false, error: error.message };
    }
}

// Conversation storage functions using IndexedDB
let conversationDB = null;

async function initConversationStorage() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('ConversationHistory', 1);

        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
            conversationDB = request.result;
            resolve(conversationDB);
        };

        request.onupgradeneeded = event => {
            const db = event.target.result;

            // Create sessions store
            if (!db.objectStoreNames.contains('sessions')) {
                const sessionStore = db.createObjectStore('sessions', { keyPath: 'sessionId' });
                sessionStore.createIndex('timestamp', 'timestamp', { unique: false });
            }
        };
    });
}

async function saveConversationSession(sessionId, conversationHistory) {
    if (!conversationDB) {
        await initConversationStorage();
    }

    const transaction = conversationDB.transaction(['sessions'], 'readwrite');
    const store = transaction.objectStore('sessions');

    const sessionData = {
        sessionId: sessionId,
        timestamp: parseInt(sessionId),
        conversationHistory: conversationHistory,
        lastUpdated: Date.now(),
    };

    return new Promise((resolve, reject) => {
        const request = store.put(sessionData);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
    });
}

async function getConversationSession(sessionId) {
    if (!conversationDB) {
        await initConversationStorage();
    }

    const transaction = conversationDB.transaction(['sessions'], 'readonly');
    const store = transaction.objectStore('sessions');

    return new Promise((resolve, reject) => {
        const request = store.get(sessionId);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
    });
}

async function getAllConversationSessions() {
    if (!conversationDB) {
        await initConversationStorage();
    }

    const transaction = conversationDB.transaction(['sessions'], 'readonly');
    const store = transaction.objectStore('sessions');
    const index = store.index('timestamp');

    return new Promise((resolve, reject) => {
        const request = index.getAll();
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
            // Sort by timestamp descending (newest first)
            const sessions = request.result.sort((a, b) => b.timestamp - a.timestamp);
            resolve(sessions);
        };
    });
}

// Listen for conversation data from main process
ipcRenderer.on('save-conversation-turn', async (event, data) => {
    try {
        await saveConversationSession(data.sessionId, data.fullHistory);
        logger.info('Conversation session saved:', data.sessionId);
    } catch (error) {
        logger.error('Error saving conversation session:', error);
    }
});

// Initialize conversation storage when renderer loads
initConversationStorage().catch(logger.error);

// Handle shortcuts based on current view
function handleShortcut(shortcutKey) {
    const currentView = cheddar.getCurrentView();

    if (shortcutKey === 'ctrl+enter' || shortcutKey === 'cmd+enter') {
        if (currentView === 'main') {
            cheddar.element().handleStart();
        } else {
            captureManualScreenshot();
        }
    }
}

// Create reference to the main app element
const cheatingDaddyApp = document.querySelector('cheating-daddy-app');

// Consolidated cheddar object - all functions in one place
const cheddar = {
    // Element access
    element: () => cheatingDaddyApp,
    e: () => cheatingDaddyApp,

    // App state functions - access properties directly from the app element
    getCurrentView: () => cheatingDaddyApp.currentView,
    getLayoutMode: () => cheatingDaddyApp.layoutMode,

    // Status and response functions
    setStatus: text => cheatingDaddyApp.setStatus(text),
    setResponse: response => cheatingDaddyApp.setResponse(response),

    // Core functionality
    initializeGemini,
    startCapture,
    stopCapture,
    sendTextMessage,
    handleShortcut,

    // Conversation history functions
    getAllConversationSessions,
    getConversationSession,
    initConversationStorage,

    // Content protection function
    getContentProtection: () => {
        const contentProtection = localStorage.getItem('contentProtection');
        return contentProtection !== null ? contentProtection === 'true' : true;
    },

    // Platform detection
    isLinux: isLinux,
    isMacOS: isMacOS,

    // Expose region mode
    getScreenshotRegionMode: () => screenshotRegionMode,
};

// Make it globally available
window.cheddar = cheddar;
