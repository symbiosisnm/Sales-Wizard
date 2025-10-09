jest.mock('electron', () => {
  const invoke = jest.fn();
  const send = jest.fn();
  const on = jest.fn();
  const removeListener = jest.fn();
  const removeAllListeners = jest.fn();

  return {
    contextBridge: {
      exposeInMainWorld: jest.fn(),
    },
    ipcRenderer: {
      invoke,
      send,
      on,
      removeListener,
      removeAllListeners,
    },
  };
});

const { contextBridge, ipcRenderer } = require('electron');

describe('preload IPC bridge', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  test('exposes renderer api on window', () => {
    require('../../src/preload');
    expect(contextBridge.exposeInMainWorld).toHaveBeenCalledWith('electron', expect.any(Object));
  });

  test('renderer api delegates to ipcRenderer', () => {
    require('../../src/preload');
    const api = contextBridge.exposeInMainWorld.mock.calls[0][1];

    api.updateSizes();
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('update-sizes');

    api.viewChanged('assistant');
    expect(ipcRenderer.send).toHaveBeenCalledWith('view-changed', 'assistant');

    const handler = jest.fn();
    api.onUpdateResponse(handler);
    expect(ipcRenderer.on).toHaveBeenCalledWith('update-response', handler);

    api.removeUpdateResponseListener(handler);
    expect(ipcRenderer.removeListener).toHaveBeenCalledWith('update-response', handler);

    api.removeSessionInitializingListeners();
    expect(ipcRenderer.removeAllListeners).toHaveBeenCalledWith('session-initializing');
  });
});
