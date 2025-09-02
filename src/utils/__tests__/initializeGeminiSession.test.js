const { test, mock } = require('node:test');
const assert = require('node:assert');

// Mock ipcUtils to capture status updates
const sendToRenderer = mock.fn();
require.cache[require.resolve('../ipcUtils')] = { exports: { sendToRenderer } };

// Mock reconnection module
const reconnection = {
    storeSessionParams: mock.fn(),
    disableReconnection: mock.fn(),
    attemptReconnection: mock.fn(),
};
require.cache[require.resolve('../reconnection')] = { exports: reconnection };

// Mock conversationStore
const conversationStore = {
    initializeNewSession: mock.fn(),
    saveConversationTurn: mock.fn(),
    getConversationHistory: () => [],
};
require.cache[require.resolve('../conversationStore')] = { exports: conversationStore };

// Mock GoogleGenAI client
let callbacks;
class FakeClient {
    constructor() {}
    get live() {
        return {
            connect: async ({ callbacks: cb }) => {
                callbacks = cb;
                return {
                    close: async () => {},
                    sendRealtimeInput: async () => {},
                };
            },
        };
    }
}
require.cache[require.resolve('@google/genai')] = { exports: { GoogleGenAI: FakeClient } };

// Load sessionManager with mocks
const sessionManager = require('../sessionManager');

test('WebSocket onerror for invalid API key disables reconnection', async () => {
    reconnection.disableReconnection = mock.fn();
    const ref = { current: null };
    await sessionManager.initializeGeminiSession(ref, 'key');

    callbacks.onerror(new Error('API key not valid'));

    assert.strictEqual(reconnection.disableReconnection.mock.callCount(), 1);
    const lastStatus = sendToRenderer.mock.calls.at(-1).arguments;
    assert.deepStrictEqual(lastStatus, ['update-status', 'Error: Invalid API key']);
});

test('WebSocket onclose triggers reconnection attempt', async () => {
    reconnection.attemptReconnection = mock.fn();
    const ref = { current: null };
    await sessionManager.initializeGeminiSession(ref, 'key');

    callbacks.onclose({ reason: 'network error' });

    assert.strictEqual(reconnection.attemptReconnection.mock.callCount(), 1);
});
