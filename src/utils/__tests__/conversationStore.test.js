const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

function loadStore(dir) {
    const tmpDir = dir || fs.mkdtempSync(path.join(os.tmpdir(), 'cd-store-'));
    process.env.APP_DATA_DIR = tmpDir;
    delete require.cache[require.resolve('../conversationStore')];
    const store = require('../conversationStore');
    return { store, dir: tmpDir };
}

test('initializeNewSession creates new session with empty history', () => {
    const { store } = loadStore();
    store.initializeNewSession();
    const data = store.getCurrentSessionData();
    assert.ok(data.sessionId);
    assert.deepStrictEqual(data.history, []);
});

test('saveConversationTurn stores turns', () => {
    const { store } = loadStore();
    store.initializeNewSession();
    store.saveConversationTurn('hello', 'hi');
    const data = store.getCurrentSessionData();
    assert.strictEqual(data.history.length, 1);
    assert.strictEqual(data.history[0].transcription, 'hello');
});

test('trims history to max length', () => {
    const { store } = loadStore();
    store.initializeNewSession();
    store.setMaxHistoryLength(2);
    store.saveConversationTurn('one', '1');
    store.saveConversationTurn('two', '2');
    store.saveConversationTurn('three', '3');
    const data = store.getCurrentSessionData();
    assert.strictEqual(data.history.length, 2);
    assert.strictEqual(data.history[0].transcription, 'two');
    assert.strictEqual(data.history[1].transcription, 'three');
});

test('persists history to disk and reloads', () => {
    const { store, dir } = loadStore();
    store.initializeNewSession();
    store.saveConversationTurn('hello', 'hi');
    const sessionId = store.getCurrentSessionData().sessionId;
    delete require.cache[require.resolve('../conversationStore')];
    process.env.APP_DATA_DIR = dir;
    const reloadedStore = require('../conversationStore');
    const data = reloadedStore.getCurrentSessionData();
    assert.strictEqual(data.sessionId, sessionId);
    assert.strictEqual(data.history.length, 1);
    assert.strictEqual(data.history[0].transcription, 'hello');
});
