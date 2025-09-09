const { test } = require('node:test');
const assert = require('node:assert');
const { LiveNotesRecorder } = require('../../services/liveNotes');

// Simple helper that yields control for the specified number of milliseconds.
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test('LiveNotesRecorder transcribes queued audio chunks', async () => {
  // Fake transcriber that returns a string indicating the size of the chunk.
  const fakeTranscriber = async (buf) => {
    await delay(5); // simulate asynchronous work
    return `len-${buf.length}`;
  };

  const recorder = new LiveNotesRecorder(fakeTranscriber);
  const emitted = [];
  recorder.on('note', (note) => emitted.push(typeof note === 'string' ? note : note.text));

  recorder.start();
  recorder.addAudioChunk(Buffer.from([0, 0, 0, 0]));
  recorder.addAudioChunk(Buffer.from([1, 1, 1, 1]));
  await recorder.flush();

  assert.deepStrictEqual(emitted, ['len-4', 'len-4']);
  assert.strictEqual(recorder.getNotes(), 'len-4 len-4');
});

