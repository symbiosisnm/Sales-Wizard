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

test('exportSession generates JSON blob with metadata', async () => {
    const notes = [{ text: 'some notes', type: 'manual', timestamp: 0 }];
    const { blob, filename } = sessionManager.exportSession({
        format: 'json',
        session: {
            sessionId: 'abc',
            history: [
                {
                    timestamp: 0,
                    transcription: 'hello',
                    ai_response: 'hi',
                },
            ],
        },
        notes,
        profile: 'interview',
    });
    assert.strictEqual(filename, 'session-abc.json');
    const text = await blob.text();
    const data = JSON.parse(text);
    assert.deepStrictEqual(data.notes, notes);
    assert.strictEqual(data.metadata.profile, 'interview');
    assert.strictEqual(data.conversation.length, 1);
});

test('exportSession generates Markdown blob', async () => {
    const notes = [{ text: 'note', type: 'manual', timestamp: 0 }];
    const { blob } = sessionManager.exportSession({
        format: 'markdown',
        session: {
            sessionId: 'abc',
            history: [
                {
                    timestamp: 0,
                    transcription: 'hello',
                    ai_response: 'hi',
                },
            ],
        },
        notes,
        profile: 'interview',
    });
    const text = await blob.text();
    assert.ok(text.includes('# Session abc'));
    assert.ok(text.includes('note'));
    assert.ok(text.includes('hello'));
});
