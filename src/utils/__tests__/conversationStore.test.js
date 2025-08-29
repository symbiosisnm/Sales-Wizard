const { test, beforeEach } = require('node:test');
const assert = require('node:assert');
const conversationStore = require('../conversationStore');

beforeEach(() => {
    conversationStore.initializeNewSession();
});

test('initializeNewSession creates new session with empty history', () => {
    const data = conversationStore.getCurrentSessionData();
    assert.ok(data.sessionId);
    assert.deepStrictEqual(data.history, []);
});

test('saveConversationTurn stores turns', () => {
    conversationStore.saveConversationTurn('hello', 'hi');
    const data = conversationStore.getCurrentSessionData();
    assert.strictEqual(data.history.length, 1);
    assert.strictEqual(data.history[0].transcription, 'hello');
});
