const { sendToRenderer } = require('./ipcUtils');
const fs = require('fs');
const path = require('path');
const os = require('os');

let currentSessionId = null;
let conversationHistory = [];
let maxHistoryLength = 100;

function setMaxHistoryLength(length) {
    const parsed = parseInt(length, 10);
    if (!Number.isNaN(parsed) && parsed > 0) {
        maxHistoryLength = parsed;
    }
}

let historyFilePath = null;

function getHistoryFilePath() {
    if (!historyFilePath) {
        let dir;
        if (process.env.APP_DATA_DIR) {
            dir = process.env.APP_DATA_DIR;
        } else {
            try {
                const { app } = require('electron');
                dir = app.getPath('userData');
            } catch {
                dir = path.join(os.tmpdir(), 'cheating-daddy');
            }
        }
        fs.mkdirSync(dir, { recursive: true });
        historyFilePath = path.join(dir, 'conversation-history.json');
    }
    return historyFilePath;
}

function persistHistory() {
    try {
        const data = { sessionId: currentSessionId, history: conversationHistory };
        fs.writeFileSync(getHistoryFilePath(), JSON.stringify(data, null, 2));
    } catch (err) {
        console.error('Failed to persist conversation history:', err);
    }
}

function loadHistory() {
    try {
        const file = getHistoryFilePath();
        if (fs.existsSync(file)) {
            const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
            currentSessionId = data.sessionId || null;
            conversationHistory = Array.isArray(data.history) ? data.history : [];
        }
    } catch (err) {
        console.error('Failed to load conversation history:', err);
        currentSessionId = null;
        conversationHistory = [];
    }
}

function initializeNewSession() {
    currentSessionId = Date.now().toString();
    conversationHistory = [];
    persistHistory();
    console.log('New conversation session started:', currentSessionId);
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
    if (conversationHistory.length > maxHistoryLength) {
        conversationHistory = conversationHistory.slice(-maxHistoryLength);
    }
    persistHistory();
    console.log('Saved conversation turn:', conversationTurn);

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

function exportConversationHistory() {
    return { sessionId: currentSessionId, history: conversationHistory };
}

function clearConversationHistory() {
    currentSessionId = null;
    conversationHistory = [];
    try {
        fs.rmSync(getHistoryFilePath(), { force: true });
    } catch {}
    sendToRenderer('history-cleared');
}

loadHistory();

module.exports = {
    initializeNewSession,
    saveConversationTurn,
    getCurrentSessionData,
    getConversationHistory,
    setMaxHistoryLength,
    exportConversationHistory,
    clearConversationHistory,
};
