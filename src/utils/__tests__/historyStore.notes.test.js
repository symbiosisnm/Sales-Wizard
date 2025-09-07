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
});

test('Updating notes independently', () => {
    const sessionId = 'notes-update';
    historyStore.appendTurn(sessionId, { sessionStart: true });
    historyStore.appendTurn(sessionId, { notes: 'First note' });
    let session = historyStore.getSession(sessionId);
    assert.strictEqual(session.notes, 'First note');
    historyStore.appendTurn(sessionId, { notes: 'Updated note' });
    session = historyStore.getSession(sessionId);
    assert.strictEqual(session.notes, 'Updated note');
    assert.strictEqual(session.conversationHistory.length, 0);
});

test('getSession returns the latest notes', () => {
    const sessionId = 'latest-notes';
    historyStore.appendTurn(sessionId, { sessionStart: true });
    historyStore.appendTurn(sessionId, { notes: 'Old note' });
    historyStore.appendTurn(sessionId, { notes: 'New note' });
    const session = historyStore.getSession(sessionId);
    assert.strictEqual(session.notes, 'New note');
});
