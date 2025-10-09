const { ipcMain } = require('electron');
const { sendToRenderer } = require('./ipcUtils');
const conversationStore = require('./conversationStore');
const audioHandler = require('./audioHandler');
const reconnection = require('./reconnection');
const sessionManager = require('./sessionManager');
const { resolveBackendOrigin } = require('../services/backendConfig.js');

const API_BASE = resolveBackendOrigin();

async function fetchJson(url, options = {}) {
    const response = await fetch(url, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            ...(options.headers || {}),
        },
    });

    if (!response.ok) {
        const message = `Request failed with status ${response.status}`;
        throw new Error(message);
    }

    if (response.status === 204) {
        return null;
    }

    try {
        return await response.json();
    } catch (error) {
        logger.warn('Failed to parse JSON response:', error);
        return null;
    }
}

function setupGeminiIpcHandlers(geminiSessionRef) {
    global.geminiSessionRef = geminiSessionRef;

    ipcMain.handle('initialize-gemini', async (apiKey, customPrompt, profile = 'interview', language = 'en-US') => {
        const session = await sessionManager.initializeGeminiSession(geminiSessionRef, apiKey, customPrompt, profile, language);
        if (session) {
            geminiSessionRef.current = session;
            return true;
        }
        return false;
    });

    ipcMain.handle('send-audio-content', async ({ data, mimeType }) => {
        if (!geminiSessionRef.current) return { success: false, error: 'No active Gemini session' };
        try {
            await geminiSessionRef.current.sendRealtimeInput({
                audio: { data: data, mimeType: mimeType },
            });
            return { success: true };
        } catch (error) {
            logger.error('Error sending audio:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('send-image', async data => {
        return sessionManager.sendImage(geminiSessionRef, data);
    });

    ipcMain.handle('send-text-message', async text => {
        return sessionManager.sendTextMessage(geminiSessionRef, text);
    });

    ipcMain.handle('start-macos-audio', async () => {
        if (process.platform !== 'darwin') {
            return {
                success: false,
                error: 'macOS audio capture only available on macOS',
            };
        }
        try {
            const success = await audioHandler.startSystemAudioCapture(geminiSessionRef);
            return { success };
        } catch (error) {
            logger.error('Error starting macOS audio capture:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('stop-macos-audio', async () => {
        try {
            audioHandler.stopSystemAudioCapture();
            return { success: true };
        } catch (error) {
            logger.error('Error stopping macOS audio capture:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('start-system-audio', async (_, options = {}) => {
        try {
            const success = await audioHandler.startSystemAudioCapture(geminiSessionRef, options);
            return { success };
        } catch (error) {
            logger.error('Error starting system audio capture:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('stop-system-audio', async () => {
        try {
            audioHandler.stopSystemAudioCapture();
            return { success: true };
        } catch (error) {
            logger.error('Error stopping system audio capture:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('close-session', async () => {
        try {
            audioHandler.stopSystemAudioCapture();
            reconnection.clearSessionParams();
            if (geminiSessionRef.current) {
                await geminiSessionRef.current.close();
                geminiSessionRef.current = null;
            }
            return { success: true };
        } catch (error) {
            logger.error('Error closing session:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('get-current-session', async () => {
        try {
            return { success: true, data: conversationStore.getCurrentSessionData() };
        } catch (error) {
            logger.error('Error getting current session:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('start-new-session', async () => {
        try {
            const sessionId = conversationStore.initializeNewSession();
            return { success: true, sessionId };
        } catch (error) {
            logger.error('Error starting new session:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('export-session', async options => {
        try {
            const { blob, filename } = sessionManager.exportSession(options);
            const buffer = Buffer.from(await blob.arrayBuffer());
            return {
                success: true,
                data: buffer.toString('base64'),
                mimeType: blob.type,
                filename,
            };
        } catch (error) {
            logger.error('Error exporting session:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('update-google-search-setting', async enabled => {
        try {
            logger.info('Google Search setting updated to:', enabled);
            return { success: true };
        } catch (error) {
            logger.error('Error updating Google Search setting:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('history:list', async () => {
        try {
            const data = await fetchJson(`${API_BASE}/history`);
            return { success: true, data: Array.isArray(data) ? data : [] };
        } catch (error) {
            logger.error('Error listing history sessions:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('history:get', async (_event, sessionId) => {
        if (!sessionId) {
            return { success: false, error: 'Session ID is required' };
        }

        try {
            const data = await fetchJson(`${API_BASE}/history/${sessionId}`);
            return { success: true, data };
        } catch (error) {
            logger.error('Error retrieving history session:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('history:clear', async () => {
        try {
            await fetchJson(`${API_BASE}/history`, { method: 'DELETE' });
            return { success: true };
        } catch (error) {
            logger.error('Error clearing history:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('history:set-limit', async (_event, limit) => {
        try {
            await fetchJson(`${API_BASE}/history/limit`, {
                method: 'PUT',
                body: JSON.stringify({ limit }),
            });
            return { success: true };
        } catch (error) {
            logger.error('Error setting history limit:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('history:add-turn', async (_event, { sessionId, turn }) => {
        if (!sessionId || !turn) {
            return { success: false, error: 'sessionId and turn payload are required' };
        }

        try {
            await fetchJson(`${API_BASE}/history/${sessionId}/turn`, {
                method: 'POST',
                body: JSON.stringify(turn),
            });
            return { success: true };
        } catch (error) {
            logger.error('Error appending history turn:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('assistant:ask', async (_event, prompt) => {
        if (!prompt) {
            return { success: false, error: 'Prompt is required' };
        }

        try {
            const data = await fetchJson(`${API_BASE}/ask`, {
                method: 'POST',
                body: JSON.stringify({ prompt }),
            });
            return { success: true, data };
        } catch (error) {
            logger.error('Error requesting assistant reply:', error);
            return { success: false, error: error.message };
        }
    });
}

module.exports = {
    setupGeminiIpcHandlers,
    stopSystemAudioCapture: audioHandler.stopSystemAudioCapture,
    startSystemAudioCapture: audioHandler.startSystemAudioCapture,
    sendToRenderer,
    initializeGeminiSession: sessionManager.initializeGeminiSession,
    getEnabledTools: sessionManager.getEnabledTools,
    getStoredSetting: sessionManager.getStoredSetting,
    initializeNewSession: conversationStore.initializeNewSession,
    saveConversationTurn: conversationStore.saveConversationTurn,
    getCurrentSessionData: conversationStore.getCurrentSessionData,
    sendReconnectionContext: reconnection.sendReconnectionContext,
    killExistingSystemAudioDump: audioHandler.killExistingSystemAudioDump,
    sendAudioToGemini: audioHandler.sendAudioToGemini,
    attemptReconnection: reconnection.attemptReconnection,
};
