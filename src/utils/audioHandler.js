const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');
const { saveDebugAudio } = require('../audioUtils');
const ipcUtils = require('./ipcUtils');

const SAMPLE_RATE = 24000;
const OUTPUT_CHANNELS = 1;
const BYTES_PER_SAMPLE = 2;
const CHUNK_DURATION_SECONDS = 0.1;

let systemAudioProc = null;
let vadSpeaking = false;
let vadLastSendTs = 0;

const VAD_THRESHOLD = 900;
const VAD_HYSTERESIS = 200;
const VAD_SILENCE_SEND_MS = 2500;

function resetVadState() {
    vadSpeaking = false;
    vadLastSendTs = 0;
}

function killExistingSystemAudioDump() {
    if (process.platform !== 'darwin') {
        return Promise.resolve();
    }

    return new Promise(resolve => {
        const killProc = childProcess.spawn('pkill', ['-f', 'SystemAudioDump'], { stdio: 'ignore' });
        killProc.on('close', () => resolve());
        killProc.on('error', () => resolve());
        setTimeout(() => {
            killProc.kill();
            resolve();
        }, 2000);
    });
}

function resolveFfmpegPath() {
    const override = process.env.SW_FFMPEG_PATH;
    if (override && fs.existsSync(override)) {
        return override;
    }

    const binaryName = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';

    try {
        const { app } = require('electron');
        if (app?.isPackaged) {
            const packagedPath = path.join(process.resourcesPath, 'bin', process.platform, binaryName);
            if (fs.existsSync(packagedPath)) {
                return packagedPath;
            }
        }
    } catch (_err) {
        // Electron may not be available in tests; fall back to development paths below.
    }

    const devPath = path.join(__dirname, '../assets/bin', process.platform, binaryName);
    if (fs.existsSync(devPath)) {
        return devPath;
    }

    return process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
}

async function startMacOSAudioCapture(geminiSessionRef) {
    if (process.platform !== 'darwin') return false;

    const { app } = require('electron');

    let systemAudioPath;
    try {
        const { app } = require('electron');
        if (app?.isPackaged) {
            systemAudioPath = path.join(process.resourcesPath, 'SystemAudioDump');
        } else {
            systemAudioPath = path.join(__dirname, '../assets', 'SystemAudioDump');
        }
    } catch (_err) {
        systemAudioPath = path.join(__dirname, '../assets', 'SystemAudioDump');
    }

    try {
        await fs.promises.access(systemAudioPath, fs.constants.X_OK);
    } catch (err) {
        const message =
            err.code === 'ENOENT'
                ? 'Error: SystemAudioDump binary not found. Install it to enable system audio capture.'
                : 'Error: SystemAudioDump binary is not executable. Check permissions.';
        logger.error('SystemAudioDump binary validation failed:', err);
        ipcUtils.sendToRenderer('update-status', message);
        return false;
    }

    const spawnOptions = {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, PROCESS_NAME: 'AudioService', APP_NAME: 'System Audio Service' },
    };

async function startWindowsAudioCapture(geminiSessionRef) {
    const ffmpegPath = resolveFfmpegPath();
    const inputDevice = process.env.SW_WASAPI_DEVICE || 'default';
    const args = [
        '-f',
        'wasapi',
        '-i',
        inputDevice,
        '-ac',
        '1',
        '-ar',
        String(SAMPLE_RATE),
        '-f',
        's16le',
        'pipe:1',
    ];

    return spawnSystemAudioProcess(ffmpegPath, args, geminiSessionRef, {
        label: 'ffmpeg-wasapi',
        inputChannels: 1,
    });
}

async function startLinuxAudioCapture(geminiSessionRef, options = {}) {
    const ffmpegPath = resolveFfmpegPath();

    const preferred = (options.backend || process.env.SW_LINUX_AUDIO_BACKEND || '').toLowerCase();
    const defaultPulseSource = process.env.SW_PULSE_SOURCE || process.env.PULSE_SOURCE || 'default';
    const defaultPipewireSource = process.env.SW_PIPEWIRE_SOURCE || 'default';

    const order = [];
    if (preferred === 'pulse' || preferred === 'pulseaudio') {
        order.push('pulse', 'pipewire');
    } else if (preferred === 'pipewire') {
        order.push('pipewire', 'pulse');
    } else if (process.env.XDG_SESSION_TYPE === 'wayland') {
        order.push('pipewire', 'pulse');
    } else {
        order.push('pulse', 'pipewire');
    }

    try {
        systemAudioProc = childProcess.spawn(systemAudioPath, [], spawnOptions);
    } catch (err) {
        logger.error('Failed to start SystemAudioDump:', err);
        ipcUtils.sendToRenderer('update-status', `Error starting system audio capture: ${err.message}`);
        return false;
    }

    if (!systemAudioProc?.pid) {
        logger.error('Failed to start SystemAudioDump');
        ipcUtils.sendToRenderer('update-status', 'Error starting system audio capture: SystemAudioDump failed to launch.');
        return false;
    }

    if (process.platform === 'darwin') {
        return startMacOSAudioCapture(geminiSessionRef);
    }
    if (process.platform === 'win32') {
        return startWindowsAudioCapture(geminiSessionRef);
    }
    if (process.platform === 'linux') {
        return startLinuxAudioCapture(geminiSessionRef, options);
    }

    logger.warn(`System audio capture is not supported on platform: ${process.platform}`);
    return false;
}

function stopSystemAudioCapture() {
    if (systemAudioProc) {
        try {
            systemAudioProc.kill('SIGTERM');
        } catch (err) {
            logger.warn('Failed to terminate system audio process gracefully, forcing kill', err);
            try {
                systemAudioProc.kill();
            } catch (_killErr) {
                // Ignore - process may already be stopped
            }
        }
        systemAudioProc = null;
    }
    resetVadState();
}

function spawnSystemAudioProcess(executable, args, geminiSessionRef, { label, inputChannels = 1, env = {} }) {
    return new Promise(resolve => {
        try {
            const spawnOptions = {
                stdio: ['ignore', 'pipe', 'pipe'],
                env: { ...process.env, ...env },
            };

            if (process.platform === 'win32') {
                spawnOptions.windowsHide = true;
            }

            const proc = spawn(executable, args, spawnOptions);
            let resolved = false;
            let readinessTimer = setTimeout(() => {
                readinessTimer = null;
                finalizeSuccess();
            }, 800);

            const finalizeSuccess = firstChunk => {
                if (resolved) return;
                resolved = true;
                if (readinessTimer) {
                    clearTimeout(readinessTimer);
                    readinessTimer = null;
                }

                systemAudioProc = proc;
                const handleChunk = createChunkHandler(geminiSessionRef, inputChannels);
                if (firstChunk) {
                    handleChunk(firstChunk);
                }

                proc.stdout.on('data', handleChunk);
                proc.stderr.on('data', data => {
                    const message = data.toString();
                    if (message.trim().length) {
                        logger.error(`${label} stderr:`, message);
                    }
                });

                proc.on('close', code => {
                    logger.info(`${label} exited with code ${code}`);
                    if (systemAudioProc === proc) {
                        systemAudioProc = null;
                        resetVadState();
                    }
                });

                proc.on('error', err => {
                    logger.error(`${label} process error:`, err);
                    if (systemAudioProc === proc) {
                        systemAudioProc = null;
                        resetVadState();
                    }
                });

                resolve(true);
            };

            proc.stdout.once('data', data => {
                finalizeSuccess(data);
            });

            proc.once('error', err => {
                if (readinessTimer) {
                    clearTimeout(readinessTimer);
                    readinessTimer = null;
                }
                logger.error(`${label} spawn error:`, err);
                if (!resolved) {
                    resolve(false);
                }
            });

            proc.once('close', code => {
                if (readinessTimer) {
                    clearTimeout(readinessTimer);
                    readinessTimer = null;
                }
                if (!resolved) {
                    logger.error(`${label} exited before streaming audio (code ${code})`);
                    resolve(false);
                }
            });
        } catch (error) {
            logger.error(`Failed to spawn ${label}:`, error);
            resolve(false);
        }
    });
}

    systemAudioProc.stderr.on('data', data => {
        const stderrOutput = data.toString();
        logger.error('SystemAudioDump stderr:', stderrOutput);
        ipcUtils.sendToRenderer('update-status', `SystemAudioDump stderr: ${stderrOutput.trim()}`);
    });

    systemAudioProc.on('close', (code, signal) => {
        systemAudioProc = null;
        if (code !== 0) {
            const reason = signal ? ` (signal: ${signal})` : '';
            ipcUtils.sendToRenderer('update-status', `SystemAudioDump exited with code ${code}${reason}`);
        }
    });

    systemAudioProc.on('error', err => {
        logger.error('SystemAudioDump process error:', err);
        ipcUtils.sendToRenderer('update-status', `SystemAudioDump process error: ${err.message}`);
        systemAudioProc = null;
    });

        const maxBuffer = SAMPLE_RATE * inputChannels * BYTES_PER_SAMPLE;
        if (buffer.length > maxBuffer) {
            buffer = buffer.slice(-maxBuffer);
        }
    };
}

function downmixToMono(buffer, inputChannels = 2) {
    if (inputChannels <= 1) {
        return buffer;
    }

    const samples = buffer.length / (BYTES_PER_SAMPLE * inputChannels);
    const monoBuffer = Buffer.alloc(samples * BYTES_PER_SAMPLE);

    for (let i = 0; i < samples; i++) {
        const firstChannelSample = buffer.readInt16LE((i * inputChannels) * BYTES_PER_SAMPLE);
        monoBuffer.writeInt16LE(firstChannelSample, i * BYTES_PER_SAMPLE);
    }

    return monoBuffer;
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
    startMacOSAudioCapture,
    startWindowsAudioCapture,
    startLinuxAudioCapture,
    stopSystemAudioCapture,
    stopMacOSAudioCapture: stopSystemAudioCapture,
    sendAudioToGemini,
    computeEnergyFromBase64Pcm16,
    downmixToMono,
    convertStereoToMono: downmixToMono,
};
