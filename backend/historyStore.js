const fs = require('fs');
const path = require('path');

const HISTORY_FILE = path.join(__dirname, 'history.json');

function loadHistory() {
    try {
        const raw = fs.readFileSync(HISTORY_FILE, 'utf8');
        return JSON.parse(raw);
    } catch {
        return { sessions: {} };
    }
}

function saveHistory(history) {
    try {
        fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
    } catch (err) {
        // eslint-disable-next-line no-console
        console.error('Failed to save history', err);
    }
}

function appendTurn(sessionId, data) {
    const history = loadHistory();
    let session = history.sessions[sessionId];
    if (!session) {
        session = {
            id: sessionId,
            timestamp: data.timestamp || Date.now(),
            conversationHistory: [],
        };
        history.sessions[sessionId] = session;
    }

    if (!data.sessionStart) {
        session.conversationHistory.push({
            timestamp: data.timestamp || Date.now(),
            transcription: data.transcription || '',
            ai_response: data.ai_response || '',
        });
    }

    saveHistory(history);
    return session;
}

function getPreview(session) {
    const firstTurn = session.conversationHistory[0];
    if (!firstTurn) return '';
    const preview = firstTurn.transcription || firstTurn.ai_response || '';
    return preview.length > 100 ? `${preview.slice(0, 100)}...` : preview;
}

function listSessions() {
    const history = loadHistory();
    return Object.values(history.sessions)
        .map(session => ({
            id: session.id,
            timestamp: session.timestamp,
            preview: getPreview(session),
        }))
        .sort((a, b) => b.timestamp - a.timestamp);
}

function getSession(sessionId) {
    const history = loadHistory();
    return history.sessions[sessionId] || null;
}

module.exports = {
    appendTurn,
    listSessions,
    getSession,
};
