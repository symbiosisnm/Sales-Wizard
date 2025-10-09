const audioHandler = require('./audioHandler');
const { sendToRenderer } = require('./ipcUtils');

let isActive = false;

function ensureSession(geminiSessionRef) {
    if (!geminiSessionRef?.current) {
        throw new Error('No active Gemini session');
    }
}

function startLiveStream(geminiSessionRef, options = {}) {
    ensureSession(geminiSessionRef);
    isActive = true;

    if (options.notify !== false) {
        const status = options.startStatus || 'Live stream started';
        sendToRenderer('update-status', status);
    }

    return { success: true };
}

function stopLiveStream(options = {}) {
    if (isActive && options.notify !== false) {
        const status = options.stopStatus || 'Live stream stopped';
        sendToRenderer('update-status', status);
    }
    isActive = false;
    return { success: true };
}

async function sendLiveAudio(geminiSessionRef, { data, mimeType = 'audio/pcm;rate=24000', skipVad = false } = {}) {
    try {
        ensureSession(geminiSessionRef);
        if (!isActive) {
            return { success: false, error: 'Live stream is not active' };
        }
        if (!data) {
            return { success: false, error: 'Missing audio payload' };
        }

        if (skipVad) {
            await geminiSessionRef.current.sendRealtimeInput({
                audio: { data, mimeType },
            });
        } else {
            await audioHandler.sendAudioToGemini(data, geminiSessionRef);
        }
        return { success: true };
    } catch (error) {
        logger.error('Error forwarding live audio:', error);
        return { success: false, error: error.message };
    }
}

async function sendLiveScreen(geminiSessionRef, { data, mimeType = 'image/jpeg' } = {}) {
    try {
        ensureSession(geminiSessionRef);
        if (!isActive) {
            return { success: false, error: 'Live stream is not active' };
        }
        if (!data) {
            return { success: false, error: 'Missing screen payload' };
        }

        await geminiSessionRef.current.sendRealtimeInput({
            media: { data, mimeType },
        });
        return { success: true };
    } catch (error) {
        logger.error('Error forwarding live screen frame:', error);
        return { success: false, error: error.message };
    }
}

function isLiveStreamActive() {
    return isActive;
}

module.exports = {
    startLiveStream,
    stopLiveStream,
    sendLiveAudio,
    sendLiveScreen,
    isLiveStreamActive,
};
