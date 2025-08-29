const { test } = require('node:test');
const assert = require('node:assert');
const sessionManager = require('../sessionManager');

test('getStoredSetting returns default without Electron', async () => {
    const value = await sessionManager.getStoredSetting('missing', 'default');
    assert.strictEqual(value, 'default');
});

test('getEnabledTools respects googleSearch setting', async () => {
    const original = sessionManager.getStoredSetting;
    sessionManager.getStoredSetting = async () => 'false';
    const tools = await sessionManager.getEnabledTools();
    assert.deepStrictEqual(tools, []);
    sessionManager.getStoredSetting = original;
});
