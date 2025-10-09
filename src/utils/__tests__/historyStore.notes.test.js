const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const mockFs = require('mock-fs');
const path = require('path');

const historyStore = require('../../../backend/historyStore');
const historyFile = path.join(__dirname, '../../../backend/history.json');

beforeEach(() => {
    mockFs({ [historyFile]: JSON.stringify({ sessions: {} }) });
});

afterEach(() => {
    mockFs.restore();
});

test('Starting a session with sessionStart: true', () => {
    const sessionId = 'session-start';
    historyStore.appendTurn(sessionId, { sessionStart: true });
    const session = historyStore.getSession(sessionId);
    assert.ok(session);
    assert.deepStrictEqual(session.conversationHistory, []);
    assert.deepStrictEqual(session.notes, []);
    assert.strictEqual(session.manualNotes, '');
});

test('Updating structured notes independently', () => {
    const sessionId = 'notes-update';
    historyStore.appendTurn(sessionId, { sessionStart: true });
    historyStore.appendTurn(sessionId, {
        notes: [
            { text: 'Auto summary', type: 'auto', timestamp: 123 },
            { text: 'Manual insight', type: 'manual', timestamp: 456 },
        ],
    });
    let session = historyStore.getSession(sessionId);
    assert.strictEqual(session.notes.length, 2);
    assert.strictEqual(session.notes[0].text, 'Auto summary');
    assert.strictEqual(session.manualNotes, '');
    historyStore.appendTurn(sessionId, { notes: [] });
    session = historyStore.getSession(sessionId);
    assert.deepStrictEqual(session.notes, []);
    assert.strictEqual(session.conversationHistory.length, 0);
});

test('Legacy string notes update manual notes field', () => {
    const sessionId = 'legacy-notes';
    historyStore.appendTurn(sessionId, { sessionStart: true });
    historyStore.appendTurn(sessionId, { notes: 'Old note' });
    let session = historyStore.getSession(sessionId);
    assert.strictEqual(session.manualNotes, 'Old note');
    assert.deepStrictEqual(session.notes, []);
    historyStore.appendTurn(sessionId, { manualNotes: 'New note' });
    session = historyStore.getSession(sessionId);
    assert.strictEqual(session.manualNotes, 'New note');
});

test('clearTranscripts removes existing conversation history', () => {
    const sessionId = 'clear-transcripts';
    historyStore.appendTurn(sessionId, { sessionStart: true });
    historyStore.appendTurn(sessionId, { transcription: 'Hi', ai_response: 'Hello', timestamp: 1 });
    historyStore.appendTurn(sessionId, { transcription: 'How are you?', ai_response: 'Great!', timestamp: 2 });
    let session = historyStore.getSession(sessionId);
    assert.strictEqual(session.conversationHistory.length, 2);

    historyStore.appendTurn(sessionId, { clearTranscripts: true, notes: '', timestamp: 3 });
    session = historyStore.getSession(sessionId);
    assert.strictEqual(session.conversationHistory.length, 0);
    assert.strictEqual(session.timestamp, 3);
});
