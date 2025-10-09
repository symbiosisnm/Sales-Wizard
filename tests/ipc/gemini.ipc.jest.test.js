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

jest.mock('../../src/utils/audioHandler', () => ({
  stopMacOSAudioCapture: jest.fn(),
  startMacOSAudioCapture: jest.fn().mockResolvedValue(true),
  killExistingSystemAudioDump: jest.fn(),
  convertStereoToMono: jest.fn(),
  sendAudioToGemini: jest.fn(),
}));

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

const { setupGeminiIpcHandlers } = require('../../src/utils/gemini');

describe('Gemini IPC handlers', () => {
  let geminiSessionRef;

  beforeEach(() => {
    jest.clearAllMocks();
    ipcMain.__handlers.clear();
    geminiSessionRef = { current: null };
    global.logger = { error: jest.fn(), info: jest.fn(), warn: jest.fn() };
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
    expect(audioHandler.startMacOSAudioCapture).toHaveBeenCalled();

    platformSpy.mockRestore();
  });

  test('close-session stops audio, clears reconnection and closes session', async () => {
    const close = jest.fn();
    geminiSessionRef.current = { close };
    setupGeminiIpcHandlers(geminiSessionRef);

    const result = await getHandler('close-session')();
    expect(result).toEqual({ success: true });
    expect(audioHandler.stopMacOSAudioCapture).toHaveBeenCalled();
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
});
