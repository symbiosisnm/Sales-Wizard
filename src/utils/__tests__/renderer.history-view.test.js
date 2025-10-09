const { test, mock } = require('node:test');
const assert = require('node:assert');
const { setupRendererGlobals } = require('./rendererTestUtils.js');

test('HistoryView loads sessions and selects a session via IPC', async () => {
  const { cleanup } = setupRendererGlobals();

  const historyList = mock.fn(async () => ({
    success: true,
    data: [
      { id: 'session-1', timestamp: 1700000000000, preview: 'First conversation' },
    ],
  }));

  const historyGet = mock.fn(async () => ({
    success: true,
    data: {
      id: 'session-1',
      notes: 'Important notes',
      conversationHistory: [
        { transcription: 'Question?', ai_response: 'Answer.' },
      ],
    },
  }));

  window.electron.historyList = historyList;
  window.electron.historyGet = historyGet;

  const module = await import('../../components/views/HistoryView.js');
  const HistoryView = module.HistoryView || customElements.get('history-view');

  const element = new HistoryView();
  await element.loadSessions();

  assert.ok(historyList.mock.callCount() >= 1, 'historyList IPC invoked');
  assert.strictEqual(element.sessions.length, 1, 'one session returned');
  assert.strictEqual(element.loading, false, 'loading flag reset after list');

  await element.fetchSession('session-1');

  assert.strictEqual(historyGet.mock.callCount(), 1, 'historyGet IPC called once');
  assert.ok(element.selectedSession, 'session is selected');
  assert.strictEqual(element.selectedSession.id, 'session-1');
  assert.strictEqual(element.selectedSession.notes, 'Important notes');

  cleanup();
});
