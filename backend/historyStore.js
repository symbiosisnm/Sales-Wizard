const fs = require('fs');
const path = require('path');

const HISTORY_FILE = path.join(__dirname, 'history.json');

// Default maximum number of sessions to keep. Can be overridden at runtime via
// the exported setMaxSessions function or by setting the
// HISTORY_SESSION_LIMIT environment variable before the server starts.
let maxSessions = Number(process.env.HISTORY_SESSION_LIMIT) || 50;

function setMaxSessions(limit) {
    const parsed = Number(limit);
    if (!Number.isNaN(parsed) && parsed > 0) {
        maxSessions = parsed;
    }
}

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

function normalizeStructuredNotes(notes) {
    if (!Array.isArray(notes)) return null;
    const now = Date.now();
    return notes
        .map(note => {
            if (!note) return null;
            if (typeof note === 'string') {
                const trimmed = note.trim();
                if (!trimmed) return null;
                return { text: trimmed, type: 'manual', timestamp: now };
            }
            if (typeof note !== 'object') return null;
            const text = typeof note.text === 'string' ? note.text.trim() : '';
            if (!text) return null;
            const timestamp = typeof note.timestamp === 'number' ? note.timestamp : now;
            const type = typeof note.type === 'string' && note.type ? note.type : 'auto';
            return { ...note, text, type, timestamp };
        })
        .filter(Boolean);
}

function appendTurn(sessionId, data) {
    const history = loadHistory();
    let session = history.sessions[sessionId];
    const eventTimestamp = typeof data.timestamp === 'number' ? data.timestamp : Date.now();

    if (!session) {
        session = {
            id: sessionId,
            timestamp: eventTimestamp,
            conversationHistory: [],
            notes: normalizeStructuredNotes(data.notes) || [],
            manualNotes:
                typeof data.manualNotes === 'string'
                    ? data.manualNotes
                    : typeof data.notes === 'string'
                    ? data.notes
                    : '',
        };
        history.sessions[sessionId] = session;
    } else {
        if (!Array.isArray(session.notes)) {
            session.notes = normalizeStructuredNotes(session.notes) || [];
        }
        if (typeof session.manualNotes !== 'string') {
            session.manualNotes = '';
        }
        if (typeof session.notes === 'string') {
            session.manualNotes = session.notes;
            session.notes = [];
        }
    }

    if (Array.isArray(data.notes)) {
        session.notes = normalizeStructuredNotes(data.notes) || [];
    } else if (typeof data.notes === 'string' && typeof data.manualNotes !== 'string') {
        session.manualNotes = data.notes;
    }

    session.timestamp = eventTimestamp;

    if (typeof data.notes === 'string') {
        session.notes = data.notes;
    }

    if (data.clearTranscripts) {
        session.conversationHistory = [];
    }

    if (!data.sessionStart && (data.transcription || data.ai_response)) {
        session.conversationHistory.push({
            timestamp: eventTimestamp,
            transcription: data.transcription || '',
            ai_response: data.ai_response || '',
        });
    }

    // Prune oldest sessions if over the configured limit
    const sessions = Object.values(history.sessions).sort(
        (a, b) => b.timestamp - a.timestamp
    );
    if (sessions.length > maxSessions) {
        const toRemove = sessions.slice(maxSessions);
        for (const old of toRemove) {
            delete history.sessions[old.id];
        }
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

function clearHistory() {
    saveHistory({ sessions: {} });
}

module.exports = {
    appendTurn,
    listSessions,
    getSession,
    clearHistory,
    setMaxSessions,
};
