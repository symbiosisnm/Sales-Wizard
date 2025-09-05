const { sendToRenderer } = require('./ipcUtils');
const conversationStore = require('./conversationStore');

let reconnectionAttempts = 0;
let maxReconnectionAttempts = 3;
let reconnectionDelay = 2000;
let lastSessionParams = null;

function storeSessionParams(params) {
    lastSessionParams = params;
    reconnectionAttempts = 0;
}

function clearSessionParams() {
    lastSessionParams = null;
}

function disableReconnection() {
    lastSessionParams = null;
    reconnectionAttempts = maxReconnectionAttempts;
}

function __setReconnectionDelay(ms) {
    reconnectionDelay = ms;
}

async function sendReconnectionContext(geminiSessionRef) {
    const history = conversationStore.getConversationHistory();
    if (!geminiSessionRef?.current || history.length === 0) {
        return;
    }

    try {
        const transcriptions = history.map(turn => turn.transcription).filter(t => t && t.trim().length > 0);
        if (transcriptions.length === 0) return;
        const contextMessage = `Till now all these questions were asked in the interview, answer the last one please:\n\n${transcriptions.join('\n')}`;
        await geminiSessionRef.current.sendRealtimeInput({ text: contextMessage });
    } catch (error) {
        logger.error('Error sending reconnection context:', error);
    }
}

async function attemptReconnection(geminiSessionRef, initializeSessionFn) {
    if (!lastSessionParams || reconnectionAttempts >= maxReconnectionAttempts) {
        sendToRenderer('update-status', 'Session closed');
        return false;
    }
    reconnectionAttempts++;
    await new Promise(resolve => setTimeout(resolve, reconnectionDelay));
    try {
        const session = await initializeSessionFn(
            geminiSessionRef,
            lastSessionParams.apiKey,
            lastSessionParams.customPrompt,
            lastSessionParams.profile,
            lastSessionParams.language,
            true
        );
        if (session) {
            geminiSessionRef.current = session;
            reconnectionAttempts = 0;
            await sendReconnectionContext(geminiSessionRef);
            return true;
        }
    } catch (error) {
        logger.error(`Reconnection attempt ${reconnectionAttempts} failed:`, error);
    }
    if (reconnectionAttempts < maxReconnectionAttempts) {
        return attemptReconnection(geminiSessionRef, initializeSessionFn);
    } else {
        sendToRenderer('update-status', 'Session closed');
        return false;
    }
}

module.exports = {
    storeSessionParams,
    clearSessionParams,
    disableReconnection,
    attemptReconnection,
    sendReconnectionContext,
    __setReconnectionDelay,
};
