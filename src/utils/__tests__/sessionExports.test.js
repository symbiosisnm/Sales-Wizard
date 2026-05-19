const { test } = require('node:test');
const assert = require('node:assert');

const { exportSession } = require('../sessionExports');

test('exportSession generates JSON blob with metadata', async () => {
    const { blob, filename } = exportSession({
        format: 'json',
        notes: 'note',
        profile: 'interview',
        session: {
            sessionId: '123',
            history: [{ timestamp: 1, transcription: 'q', ai_response: 'a' }],
        },
    });

    assert.strictEqual(filename, 'session-123.json');
    const text = await blob.text();
    const data = JSON.parse(text);
    assert.strictEqual(data.metadata.sessionId, '123');
    assert.strictEqual(data.notes, 'note');
    assert.strictEqual(data.conversation.length, 1);
});

test('exportSession generates Markdown blob', async () => {
    const { blob, filename } = exportSession({
        format: 'markdown',
        notes: 'memo',
        profile: 'sales',
        session: {
            sessionId: 'abc',
            history: [{ timestamp: 2, transcription: 'hello', ai_response: 'world' }],
        },
    });

    assert.strictEqual(filename, 'session-abc.md');
    const text = await blob.text();
    assert.match(text, /# Session abc/);
    assert.match(text, /\*\*User/);
    assert.match(text, /\*\*AI/);
});
