const { sendToRenderer } = require('./ipcUtils');

let currentSessionId = null;
let conversationHistory = [];
let pendingTurns = [];

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

    // Attempt to send to backend, queue on failure
    sendTurnToBackend(currentSessionId, conversationTurn);
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

async function sendTurnToBackend(sessionId, turn) {
    try {
        await fetch(`http://localhost:3001/sessions/${sessionId}/turns`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(turn),
        });
    } catch (error) {
        logger.error('Failed to send conversation turn:', error);
        pendingTurns.push({ sessionId, turn });
    }
}

async function retryPendingTurns() {
    const queue = [...pendingTurns];
    pendingTurns = [];
    for (const { sessionId, turn } of queue) {
        try {
            await fetch(`http://localhost:3001/sessions/${sessionId}/turns`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(turn),
            });
        } catch (error) {
            logger.error('Retry failed for conversation turn:', error);
            pendingTurns.push({ sessionId, turn });
        }
    }
}

function __getPendingTurns() {
    return pendingTurns;
}

function __clearPendingTurns() {
    pendingTurns = [];
}

module.exports = {
    initializeNewSession,
    saveConversationTurn,
    getCurrentSessionData,
    getConversationHistory,
    retryPendingTurns,
    __getPendingTurns,
    __clearPendingTurns,
};
