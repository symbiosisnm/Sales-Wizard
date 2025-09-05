const { test, mock } = require('node:test');
const assert = require('node:assert');

// Mock Electron ipcMain
let handlers = {};
const ipcMain = {
    handle(channel, fn) {
        handlers[channel] = fn;
    },
};
require.cache[require.resolve('electron')] = { exports: { ipcMain } };

// Mock dependencies
const audioHandler = {
    stopSystemAudioCapture: mock.fn(),
    startSystemAudioCapture: mock.fn(),
};
require.cache[require.resolve('../audioHandler')] = { exports: audioHandler };

const reconnection = {
    clearSessionParams: mock.fn(),
    attemptReconnection: mock.fn(),
};
require.cache[require.resolve('../reconnection')] = { exports: reconnection };

const sessionManager = {
    initializeGeminiSession: mock.fn(),
    sendImage: mock.fn(),
    sendTextMessage: mock.fn(),
};
require.cache[require.resolve('../sessionManager')] = { exports: sessionManager };

const conversationStore = {
    getCurrentSessionData: mock.fn(() => ({})),
    initializeNewSession: mock.fn(),
    saveConversationTurn: mock.fn(),
};
require.cache[require.resolve('../conversationStore')] = { exports: conversationStore };

const gemini = require('../gemini');

test('initialize-gemini sets session reference on success', async () => {
    handlers = {};
    const geminiSessionRef = { current: null };
    sessionManager.initializeGeminiSession = mock.fn(async () => ({ close: async () => {} }));
    gemini.setupGeminiIpcHandlers(geminiSessionRef);

    const result = await handlers['initialize-gemini']('k', '', 'p', 'en');

    assert.strictEqual(result, true);
    assert.ok(geminiSessionRef.current);
});

test('initialize-gemini returns false on failure', async () => {
    handlers = {};
    const geminiSessionRef = { current: null };
    sessionManager.initializeGeminiSession = mock.fn(async () => null);
    gemini.setupGeminiIpcHandlers(geminiSessionRef);

    const result = await handlers['initialize-gemini']('k');

    assert.strictEqual(result, false);
    assert.strictEqual(geminiSessionRef.current, null);
});

test('close-session clears session and stops audio', async () => {
    handlers = {};
    audioHandler.stopSystemAudioCapture = mock.fn();
    reconnection.clearSessionParams = mock.fn();
    const geminiSessionRef = { current: { close: mock.fn(async () => {}) } };
    gemini.setupGeminiIpcHandlers(geminiSessionRef);

    const result = await handlers['close-session']();

    assert.strictEqual(result.success, true);
    assert.strictEqual(geminiSessionRef.current, null);
    assert.strictEqual(audioHandler.stopSystemAudioCapture.mock.callCount(), 1);
    assert.strictEqual(reconnection.clearSessionParams.mock.callCount(), 1);
});

test('close-session handles close errors', async () => {
    handlers = {};
    audioHandler.stopSystemAudioCapture = mock.fn();
    reconnection.clearSessionParams = mock.fn();
    const geminiSessionRef = { current: { close: mock.fn(async () => { throw new Error('boom'); }) } };
    gemini.setupGeminiIpcHandlers(geminiSessionRef);

    const result = await handlers['close-session']();

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.error, 'boom');
    assert.ok(geminiSessionRef.current);
});
