const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const conversationStore = require('../conversationStore');

let originalFetch;

beforeEach(() => {
    conversationStore.initializeNewSession();
    conversationStore.__clearPendingTurns();
    originalFetch = global.fetch;
});

afterEach(() => {
    global.fetch = originalFetch;
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

test('sends turns to backend', async () => {
    const calls = [];
    global.fetch = async (url, opts) => {
        calls.push({ url, opts });
        return { ok: true };
    };
    conversationStore.saveConversationTurn('question', 'answer');
    await new Promise(resolve => setImmediate(resolve));
    assert.strictEqual(calls.length, 1);
    const body = JSON.parse(calls[0].opts.body);
    assert.strictEqual(body.transcription, 'question');
    assert.strictEqual(body.ai_response, 'answer');
});

test('retries pending turns when offline', async () => {
    let fail = true;
    const calls = [];
    global.fetch = async (url, opts) => {
        calls.push({ url, opts });
        if (fail) throw new Error('offline');
        return { ok: true };
    };

    conversationStore.saveConversationTurn('q1', 'a1');
    await new Promise(resolve => setImmediate(resolve));
    assert.strictEqual(conversationStore.__getPendingTurns().length, 1);

    fail = false;
    await conversationStore.retryPendingTurns();
    assert.strictEqual(conversationStore.__getPendingTurns().length, 0);
    assert.strictEqual(calls.length, 2);
});
