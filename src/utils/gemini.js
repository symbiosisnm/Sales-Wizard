const { ipcMain } = require('electron');
const { sendToRenderer } = require('./ipcUtils');
const conversationStore = require('./conversationStore');
const audioHandler = require('./audioHandler');
const reconnection = require('./reconnection');
const sessionManager = require('./sessionManager');

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
            const success = await audioHandler.startMacOSAudioCapture(geminiSessionRef);
            return { success };
        } catch (error) {
            logger.error('Error starting macOS audio capture:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('stop-macos-audio', async () => {
        try {
            audioHandler.stopMacOSAudioCapture();
            return { success: true };
        } catch (error) {
            logger.error('Error stopping macOS audio capture:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('close-session', async () => {
        try {
            audioHandler.stopMacOSAudioCapture();
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

    ipcMain.handle('update-google-search-setting', async enabled => {
        try {
            logger.info('Google Search setting updated to:', enabled);
            return { success: true };
        } catch (error) {
            logger.error('Error updating Google Search setting:', error);
            return { success: false, error: error.message };
        }
    });
}

module.exports = {
    setupGeminiIpcHandlers,
    stopMacOSAudioCapture: audioHandler.stopMacOSAudioCapture,
    sendToRenderer,
    initializeGeminiSession: sessionManager.initializeGeminiSession,
    getEnabledTools: sessionManager.getEnabledTools,
    getStoredSetting: sessionManager.getStoredSetting,
    initializeNewSession: conversationStore.initializeNewSession,
    saveConversationTurn: conversationStore.saveConversationTurn,
    getCurrentSessionData: conversationStore.getCurrentSessionData,
    sendReconnectionContext: reconnection.sendReconnectionContext,
    killExistingSystemAudioDump: audioHandler.killExistingSystemAudioDump,
    startMacOSAudioCapture: audioHandler.startMacOSAudioCapture,
    convertStereoToMono: audioHandler.convertStereoToMono,
    sendAudioToGemini: audioHandler.sendAudioToGemini,
    attemptReconnection: reconnection.attemptReconnection,
};
