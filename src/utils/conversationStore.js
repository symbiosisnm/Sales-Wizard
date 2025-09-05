const { sendToRenderer } = require('./ipcUtils');
const fs = require('fs');
const path = require('path');

const API_BASE = process.env.BACKEND_URL || 'http://localhost:3001';
const PENDING_FILE = path.join(__dirname, '../../pendingTurns.json');

let pendingTurns = [];

function loadPendingTurns() {
    try {
        pendingTurns = JSON.parse(fs.readFileSync(PENDING_FILE, 'utf8'));
    } catch {
        pendingTurns = [];
    }
}

function savePendingTurns() {
    try {
        fs.writeFileSync(PENDING_FILE, JSON.stringify(pendingTurns, null, 2));
    } catch (err) {
        logger.error('Failed to persist pending turns:', err);
    }
}

async function postToBackend(sessionId, payload) {
    try {
        await fetch(`${API_BASE}/history/${sessionId}/turn`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
    } catch (err) {
        logger.error('Backend unreachable, caching turn:', err);
        pendingTurns.push({ sessionId, payload });
        savePendingTurns();
    }
}

async function flushPendingTurns() {
    if (pendingTurns.length === 0) return;
    const queue = pendingTurns;
    pendingTurns = [];
    savePendingTurns();

    for (const item of queue) {
        try {
            await fetch(`${API_BASE}/history/${item.sessionId}/turn`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(item.payload),
            });
        } catch (err) {
            pendingTurns.push(item);
        }
    }

    if (pendingTurns.length > 0) {
        savePendingTurns();
    }
}

loadPendingTurns();
setInterval(flushPendingTurns, 10000).unref();

let currentSessionId = null;
let conversationHistory = [];

function initializeNewSession() {
    currentSessionId = Date.now().toString();
    conversationHistory = [];
    logger.info('New conversation session started:', currentSessionId);
    const startPayload = { sessionStart: true, timestamp: Date.now() };
    postToBackend(currentSessionId, startPayload);
    flushPendingTurns();
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

    postToBackend(currentSessionId, conversationTurn);
    flushPendingTurns();
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
