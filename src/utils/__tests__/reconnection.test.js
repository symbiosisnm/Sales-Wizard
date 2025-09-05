const { test, mock } = require('node:test');
const assert = require('node:assert');

// Mock ipcUtils to capture status messages
const sendToRenderer = mock.fn();
require.cache[require.resolve('../ipcUtils')] = { exports: { sendToRenderer } };

const reconnection = require('../reconnection');
const conversationStore = require('../conversationStore');

test('attemptReconnection restores session and sends context', async () => {
    reconnection.clearSessionParams();
    conversationStore.initializeNewSession();
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

test('attemptReconnection stops after errors and updates status', async () => {
    reconnection.clearSessionParams();
    conversationStore.initializeNewSession();
    reconnection.storeSessionParams({ apiKey: 'k', customPrompt: '', profile: 'p', language: 'en' });
    const geminiSessionRef = { current: null };
    const initializeSessionFn = mock.fn(async () => {
        throw new Error('fail');
    });
    reconnection.__setReconnectionDelay(0);
    const result = await reconnection.attemptReconnection(geminiSessionRef, initializeSessionFn);
    assert.strictEqual(result, false);
    assert.strictEqual(initializeSessionFn.mock.callCount(), 3);
    const lastStatus = sendToRenderer.mock.calls.at(-1).arguments;
    assert.deepStrictEqual(lastStatus, ['update-status', 'Session closed']);
});
