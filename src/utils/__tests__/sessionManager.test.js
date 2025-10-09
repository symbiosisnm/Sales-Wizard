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
                {
                    timestamp: 60000,
                    transcription: 'bye',
                    ai_response: 'see ya',
                },
            ],
        },
        structuredNotes: [
            { text: 'auto note', type: 'auto', timestamp: 1 },
            { text: 'manual note', type: 'manual', timestamp: 2 },
        ],
        manualNotes: 'some manual notes',
        profile: 'interview',
    });
    assert.strictEqual(filename, 'session-abc.json');
    const text = await blob.text();
    const data = JSON.parse(text);
    assert.strictEqual(data.notes.length, 2);
    assert.strictEqual(data.notes[0].text, 'auto note');
    assert.strictEqual(data.manualNotes, 'some manual notes');
    assert.strictEqual(data.metadata.profile, 'interview');
    assert.strictEqual(data.conversation.length, 2);
    assert.strictEqual(data.metadata.turnCount, 2);
    assert.strictEqual(data.metadata.startedAt, new Date(0).toISOString());
    assert.strictEqual(data.metadata.endedAt, new Date(60000).toISOString());
    assert.ok(data.metadata.exportedAt);
});

test('exportSession generates Markdown blob', async () => {
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
        structuredNotes: [{ text: 'structured', type: 'auto', timestamp: 0 }],
        manualNotes: 'manual note',
        profile: 'interview',
    });
    const text = await blob.text();
    assert.ok(text.includes('# Session abc'));
    assert.ok(text.includes('structured'));
    assert.ok(text.includes('manual note'));
    assert.ok(text.includes('hello'));
    assert.ok(text.includes('Turns: 1'));
});
