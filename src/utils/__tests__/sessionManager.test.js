const { test } = require('node:test');
const assert = require('node:assert');
const sessionManager = require('../sessionManager');

test('getStoredSetting returns default without Electron', async () => {
    const value = await sessionManager.getStoredSetting('missing', 'default');
    assert.strictEqual(value, 'default');
});

test('getStoredSetting uses IPC when available', async () => {
    global.window = {
        electron: {
            ipcRenderer: {
                invoke: async () => 'ipc-value',
            },
        },
    };
    const value = await sessionManager.getStoredSetting('key', 'fallback');
    assert.strictEqual(value, 'ipc-value');
    delete global.window;
});

test('getStoredSetting falls back on IPC error', async () => {
    global.window = {
        electron: {
            ipcRenderer: {
                invoke: async () => {
                    throw new Error('fail');
                },
            },
        },
    };
    const value = await sessionManager.getStoredSetting('key', 'fallback');
    assert.strictEqual(value, 'fallback');
    delete global.window;
});

test('getEnabledTools respects googleSearch setting', async () => {
    const original = sessionManager.getStoredSetting;
    sessionManager.getStoredSetting = async () => 'false';
    const tools = await sessionManager.getEnabledTools();
    assert.deepStrictEqual(tools, []);
    sessionManager.getStoredSetting = original;
});
