const { test, beforeEach, mock } = require('node:test');
const assert = require('node:assert');
const reconnection = require('../reconnection');
const conversationStore = require('../conversationStore');

beforeEach(() => {
    reconnection.clearSessionParams();
    conversationStore.initializeNewSession();
});

test('attemptReconnection restores session and sends context', async () => {
    reconnection.storeSessionParams({ apiKey: 'k', customPrompt: '', profile: 'p', language: 'en' });
    conversationStore.saveConversationTurn('question', 'answer');
    const sendRealtimeInput = mock.fn(async () => {});
    const geminiSessionRef = { current: null };
    const initializeSessionFn = mock.fn(async () => ({ sendRealtimeInput }));
    reconnection.__setReconnectionDelay(0);
    const result = await reconnection.attemptReconnection(geminiSessionRef, initializeSessionFn);
    assert.strictEqual(result, true);
    assert.ok(geminiSessionRef.current);
    assert.strictEqual(sendRealtimeInput.mock.callCount(), 1);
    assert.strictEqual(initializeSessionFn.mock.callCount(), 1);
});
