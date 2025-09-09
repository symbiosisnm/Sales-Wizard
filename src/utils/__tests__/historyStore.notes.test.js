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
});

test('Updating notes independently', () => {
    const sessionId = 'notes-update';
    const note1 = { text: 'First note', type: 'manual', timestamp: 1 };
    const note2 = { text: 'Updated note', type: 'manual', timestamp: 2 };
    historyStore.appendTurn(sessionId, { sessionStart: true });
    historyStore.appendTurn(sessionId, { notes: [note1] });
    let session = historyStore.getSession(sessionId);
    assert.deepStrictEqual(session.notes, [note1]);
    historyStore.appendTurn(sessionId, { notes: [note2] });
    session = historyStore.getSession(sessionId);
    assert.deepStrictEqual(session.notes, [note2]);
    assert.strictEqual(session.conversationHistory.length, 0);
});

test('getSession returns the latest notes', () => {
    const sessionId = 'latest-notes';
    const oldNote = { text: 'Old note', type: 'manual', timestamp: 1 };
    const newNote = { text: 'New note', type: 'manual', timestamp: 2 };
    historyStore.appendTurn(sessionId, { sessionStart: true });
    historyStore.appendTurn(sessionId, { notes: [oldNote] });
    historyStore.appendTurn(sessionId, { notes: [newNote] });
    const session = historyStore.getSession(sessionId);
    assert.deepStrictEqual(session.notes, [newNote]);
});
