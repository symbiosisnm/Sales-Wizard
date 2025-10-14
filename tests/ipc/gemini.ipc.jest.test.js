jest.mock('electron', () => {
  const handlers = new Map();
  return {
    ipcMain: {
      handle: jest.fn((channel, handler) => {
        handlers.set(channel, handler);
      }),
      __handlers: handlers,
    },
  };
});

jest.mock('../../src/utils/audioHandler', () => {
  const stopSystemAudioCapture = jest.fn();
  const startSystemAudioCapture = jest.fn().mockResolvedValue(true);
  return {
    stopSystemAudioCapture,
    startSystemAudioCapture,
    stopMacOSAudioCapture: stopSystemAudioCapture,
    startMacOSAudioCapture: startSystemAudioCapture,
    killExistingSystemAudioDump: jest.fn(),
    convertStereoToMono: jest.fn(),
    sendAudioToGemini: jest.fn(),
  };
});

jest.mock('../../src/utils/reconnection', () => ({
  clearSessionParams: jest.fn(),
  sendReconnectionContext: jest.fn(),
  attemptReconnection: jest.fn(),
}));

jest.mock('../../src/utils/sessionManager', () => ({
  initializeGeminiSession: jest.fn(),
  sendImage: jest.fn(),
  sendTextMessage: jest.fn(),
  exportSession: jest.fn(() => ({
    blob: {
      type: 'text/plain',
      async arrayBuffer() {
        return new TextEncoder().encode('data').buffer;
      },
    },
    filename: 'notes.txt',
  })),
  getEnabledTools: jest.fn(),
  getStoredSetting: jest.fn(),
}));

jest.mock('../../src/utils/conversationStore', () => ({
  initializeNewSession: jest.fn(() => 'session-123'),
  saveConversationTurn: jest.fn(),
  getCurrentSessionData: jest.fn(() => ({ id: 'session-123' })),
}));

const { ipcMain } = require('electron');
const audioHandler = require('../../src/utils/audioHandler');
const reconnection = require('../../src/utils/reconnection');
const sessionManager = require('../../src/utils/sessionManager');
const conversationStore = require('../../src/utils/conversationStore');

process.env.AUTH_TOKEN = 'test-token';

const { setupGeminiIpcHandlers } = require('../../src/utils/gemini');

const originalFetch = global.fetch;

describe('Gemini IPC handlers', () => {
  let geminiSessionRef;

  beforeEach(() => {
    jest.clearAllMocks();
    ipcMain.__handlers.clear();
    geminiSessionRef = { current: null };
    global.logger = { error: jest.fn(), info: jest.fn(), warn: jest.fn() };
    process.env.AUTH_TOKEN = 'test-token';
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  function getHandler(channel) {
    expect(ipcMain.__handlers.has(channel)).toBe(true);
    return ipcMain.__handlers.get(channel);
  }

  test('initializes gemini session and caches reference', async () => {
    const fakeSession = { close: jest.fn() };
    sessionManager.initializeGeminiSession.mockResolvedValue(fakeSession);
    setupGeminiIpcHandlers(geminiSessionRef);

    const result = await getHandler('initialize-gemini')('key', 'prompt', 'profile', 'en');
    expect(result).toBe(true);
    expect(geminiSessionRef.current).toBe(fakeSession);
  });

  test('send-audio-content requires active session', async () => {
    setupGeminiIpcHandlers(geminiSessionRef);
    const result = await getHandler('send-audio-content')({ data: Buffer.from('a'), mimeType: 'audio' });
    expect(result).toEqual({ success: false, error: 'No active Gemini session' });
  });

  test('start-macos-audio guards non-mac platforms', async () => {
    setupGeminiIpcHandlers(geminiSessionRef);
    const handler = getHandler('start-macos-audio');
    const response = await handler();
    expect(response).toEqual({
      success: false,
      error: 'macOS audio capture only available on macOS',
    });
  });

  test('start-macos-audio delegates when running on macOS', async () => {
    setupGeminiIpcHandlers(geminiSessionRef);
    const handler = getHandler('start-macos-audio');
    const platformSpy = jest.spyOn(process, 'platform', 'get').mockReturnValue('darwin');

    const result = await handler();
    expect(result).toEqual({ success: true });
    expect(audioHandler.startSystemAudioCapture).toHaveBeenCalled();

    platformSpy.mockRestore();
  });

  test('close-session stops audio, clears reconnection and closes session', async () => {
    const close = jest.fn();
    geminiSessionRef.current = { close };
    setupGeminiIpcHandlers(geminiSessionRef);

    const result = await getHandler('close-session')();
    expect(result).toEqual({ success: true });
    expect(audioHandler.stopSystemAudioCapture).toHaveBeenCalled();
    expect(reconnection.clearSessionParams).toHaveBeenCalled();
    expect(close).toHaveBeenCalled();
    expect(geminiSessionRef.current).toBeNull();
  });

  test('export-session returns serialized blob data', async () => {
    setupGeminiIpcHandlers(geminiSessionRef);
    const handler = getHandler('export-session');
    const result = await handler({});
    expect(result.success).toBe(true);
    expect(result.filename).toBe('notes.txt');
    expect(typeof result.data).toBe('string');
  });

  test('start-new-session returns new session id', async () => {
    setupGeminiIpcHandlers(geminiSessionRef);
    const handler = getHandler('start-new-session');
    const result = await handler();
    expect(result).toEqual({ success: true, sessionId: 'session-123' });
    expect(conversationStore.initializeNewSession).toHaveBeenCalled();
  });

  test('history:list fetches sessions via authenticated helper', async () => {
    const mockResponse = {
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: async () => [{ id: 'session-a' }],
    };
    global.fetch = jest.fn().mockResolvedValue(mockResponse);

    setupGeminiIpcHandlers(geminiSessionRef);
    const handler = getHandler('history:list');

    const result = await handler();

    expect(result).toEqual({ success: true, data: [{ id: 'session-a' }] });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, options] = global.fetch.mock.calls[0];
    expect(url.endsWith('/history')).toBe(true);
    const headerEntries = Object.fromEntries(options.headers.entries());
    expect(headerEntries.AUTH_TOKEN).toBe('test-token');
  });

  test('history:set-limit sends JSON payload with auth header', async () => {
    const mockResponse = {
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: async () => ({ ok: true }),
    };
    global.fetch = jest.fn().mockResolvedValue(mockResponse);

    setupGeminiIpcHandlers(geminiSessionRef);
    const handler = getHandler('history:set-limit');

    const result = await handler(null, 5);

    expect(result).toEqual({ success: true });
    const [, options] = global.fetch.mock.calls[0];
    expect(options.method).toBe('PUT');
    expect(options.body).toBe(JSON.stringify({ limit: 5 }));
    const headerEntries = Object.fromEntries(options.headers.entries());
    expect(headerEntries.AUTH_TOKEN).toBe('test-token');
    expect(headerEntries['Content-Type']).toBe('application/json');
  });

  test('assistant:ask propagates backend replies', async () => {
    const mockResponse = {
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: async () => ({ reply: 'Hello there' }),
    };
    global.fetch = jest.fn().mockResolvedValue(mockResponse);

    setupGeminiIpcHandlers(geminiSessionRef);
    const handler = getHandler('assistant:ask');

    const result = await handler(null, 'Hi!');

    expect(result).toEqual({ success: true, data: { reply: 'Hello there' } });
    const [, options] = global.fetch.mock.calls[0];
    expect(options.method).toBe('POST');
    expect(options.body).toBe(JSON.stringify({ prompt: 'Hi!' }));
    const headerEntries = Object.fromEntries(options.headers.entries());
    expect(headerEntries.AUTH_TOKEN).toBe('test-token');
    expect(headerEntries['Content-Type']).toBe('application/json');
  });

  test('assistant:ask surfaces backend errors', async () => {
    const mockResponse = {
      ok: false,
      status: 500,
      headers: { get: () => 'application/json' },
      json: async () => ({ error: 'Generation failed' }),
      text: async () => 'Generation failed',
    };
    global.fetch = jest.fn().mockResolvedValue(mockResponse);

    setupGeminiIpcHandlers(geminiSessionRef);
    const handler = getHandler('assistant:ask');

    const result = await handler(null, 'Hello');

    expect(result).toEqual({ success: false, error: 'Generation failed' });
    expect(global.logger.error).toHaveBeenCalledWith(
      'Error requesting assistant reply:',
      expect.any(Error)
    );
    const [, options] = global.fetch.mock.calls[0];
    const headerEntries = Object.fromEntries(options.headers.entries());
    expect(headerEntries.AUTH_TOKEN).toBe('test-token');
  });
});
