const { test, mock } = require('node:test');
const assert = require('node:assert');
const { setupRendererGlobals } = require('./rendererTestUtils.js');

test('handleStart uses IPC bridge to persist session and switches view', async () => {
  const { cleanup, localStorage } = setupRendererGlobals();

  localStorage.setItem('onboardingCompleted', '1');
  localStorage.setItem('apiKey', 'secret');

  const historyAddTurn = mock.fn(async () => ({ success: true }));
  window.electron.historyAddTurn = historyAddTurn;
  window.electron.assistantAsk = mock.fn(async () => ({ success: true, data: { reply: 'ok' } }));

  window.salesWizard.initializeGemini = mock.fn(async () => ({}));
  window.salesWizard.startCapture = mock.fn();
  window.salesWizard.sendTextMessage = mock.fn(async () => ({ success: true }));

  const module = await import('../../components/app/SalesWizardApp.js');
  const SalesWizardApp = module.SalesWizardApp || customElements.get('sales-wizard-app');

  const element = new SalesWizardApp();
  await element.handleStart();

  assert.strictEqual(window.salesWizard.initializeGemini.mock.callCount(), 1);
  assert.strictEqual(window.salesWizard.startCapture.mock.callCount(), 1);
  assert.strictEqual(historyAddTurn.mock.callCount(), 1);
  const persistedTurn = historyAddTurn.mock.calls[0].arguments[0];
  assert.strictEqual(persistedTurn.sessionId, element.sessionId);
  assert.deepStrictEqual(persistedTurn.turn, {
    sessionStart: true,
    notes: [],
    manualNotes: '',
  });
  assert.strictEqual(element.currentView, 'assistant');

  cleanup();
});

test('handleManualNotesChange saves notes through IPC bridge', async () => {
  const { cleanup, localStorage } = setupRendererGlobals();

  localStorage.setItem('onboardingCompleted', '1');
  localStorage.setItem('apiKey', 'secret');

  const historyAddTurn = mock.fn(async () => ({ success: true }));
  window.electron.historyAddTurn = historyAddTurn;

  window.salesWizard.initializeGemini = mock.fn(async () => ({}));
  window.salesWizard.startCapture = mock.fn();

  const module = await import('../../components/app/SalesWizardApp.js');
  const SalesWizardApp = module.SalesWizardApp || customElements.get('sales-wizard-app');

  const element = new SalesWizardApp();
  element.sessionId = 'session-123';
  element.notes = [
    { text: 'Structured insight', type: 'auto', timestamp: 111 },
    { text: 'Follow up question', type: 'manual', timestamp: 222 },
  ];

  await element.handleManualNotesChange({ detail: { value: 'Updated notes' } });

  assert.strictEqual(historyAddTurn.mock.callCount(), 1);
  assert.deepStrictEqual(historyAddTurn.mock.calls[0].arguments[0], {
    sessionId: 'session-123',
    turn: {
      notes: [
        { text: 'Structured insight', type: 'auto', timestamp: 111 },
        { text: 'Follow up question', type: 'manual', timestamp: 222 },
      ],
      manualNotes: 'Updated notes',
    },
  });

  cleanup();
});

test('handleStructuredNotesChange normalizes notes payload before persisting', async () => {
  const { cleanup, localStorage } = setupRendererGlobals();

  localStorage.setItem('onboardingCompleted', '1');
  localStorage.setItem('apiKey', 'secret');

  const historyAddTurn = mock.fn(async () => ({ success: true }));
  window.electron.historyAddTurn = historyAddTurn;

  window.salesWizard.initializeGemini = mock.fn(async () => ({}));
  window.salesWizard.startCapture = mock.fn();

  const module = await import('../../components/app/SalesWizardApp.js');
  const SalesWizardApp = module.SalesWizardApp || customElements.get('sales-wizard-app');

  const element = new SalesWizardApp();
  element.sessionId = 'session-789';

  const now = Date.now();
  await element.handleStructuredNotesChange({
    detail: {
      notes: [
        { text: '  Auto summary  ', type: '', timestamp: now },
        { text: 'Follow up idea', timestamp: undefined },
        null,
        { text: '   ' },
      ],
    },
  });

  assert.strictEqual(historyAddTurn.mock.callCount(), 1);
  const turnPayload = historyAddTurn.mock.calls[0].arguments[0];
  assert.strictEqual(turnPayload.sessionId, 'session-789');
  assert.strictEqual(turnPayload.turn.manualNotes, '');
  assert.strictEqual(turnPayload.turn.notes.length, 2);
  assert.deepStrictEqual(turnPayload.turn.notes[0], {
    text: 'Auto summary',
    type: 'auto',
    timestamp: now,
  });
  assert.strictEqual(turnPayload.turn.notes[1].text, 'Follow up idea');
  assert.strictEqual(turnPayload.turn.notes[1].type, 'auto');
  assert.ok(typeof turnPayload.turn.notes[1].timestamp === 'number');

  cleanup();
});
