const { sendToRenderer } = require('./ipcUtils');

let currentSessionId = null;
let conversationHistory = [];

function initializeNewSession() {
    currentSessionId = Date.now().toString();
    conversationHistory = [];
    logger.info('New conversation session started:', currentSessionId);
    return currentSessionId;
}

function saveConversationTurn(transcription, aiResponse) {
    if (!currentSessionId) {
        initializeNewSession();
    }

    const conversationTurn = {
        timestamp: Date.now(),
        transcription: transcription.trim(),
        ai_response: aiResponse.trim(),
    };

    conversationHistory.push(conversationTurn);
    logger.info('Saved conversation turn:', conversationTurn);

    sendToRenderer('save-conversation-turn', {
        sessionId: currentSessionId,
        turn: conversationTurn,
        fullHistory: conversationHistory,
    });
}

function getCurrentSessionData() {
    return {
        sessionId: currentSessionId,
        history: conversationHistory,
    };
}

function getConversationHistory() {
    return conversationHistory;
}

module.exports = {
    initializeNewSession,
    saveConversationTurn,
    getCurrentSessionData,
    getConversationHistory,
};
