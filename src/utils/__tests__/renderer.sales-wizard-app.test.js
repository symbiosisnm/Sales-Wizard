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
  assert.strictEqual(element.currentView, 'assistant');

  cleanup();
});

test('handleNotesChange saves notes through IPC bridge', async () => {
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

  await element.handleNotesChange({ detail: { value: 'Updated notes' } });

  assert.strictEqual(historyAddTurn.mock.callCount(), 1);
  assert.deepStrictEqual(historyAddTurn.mock.calls[0].arguments[0], {
    sessionId: 'session-123',
    turn: { notes: 'Updated notes' },
  });

  cleanup();
});
