const request = require('supertest');
const WebSocket = require('ws');
const { createBackend } = require('../server');
const { createMockGenai } = require('../../tests/fixtures/mockGenai');

function createHistoryStore() {
  return {
    appendTurn: jest.fn(),
    clearHistory: jest.fn(),
    listSessions: jest.fn().mockReturnValue([{ id: 'session-1' }]),
    getSession: jest.fn(id => (id === 'session-1' ? { id, turns: [] } : null)),
    setMaxSessions: jest.fn(),
  };
}

describe('backend/server', () => {
  let logger;

  beforeEach(() => {
    logger = { info: jest.fn(), error: jest.fn() };
  });

  test('updates context params and builds system instruction', async () => {
    const historyStore = createHistoryStore();
    const { genai } = createMockGenai();
    const backend = createBackend({ logger, historyStoreImpl: historyStore, genaiClient: genai });
    const agent = request(backend.app);

    await agent.put('/context-params').send({ allowedSources: 'Docs', toneLength: 'Short' }).expect(200);
    const response = await agent.get('/context-params').expect(200);
    expect(response.body).toEqual({
      allowedSources: 'Docs',
      toneLength: 'Short',
      disallowedTopics: '',
    });

    const instruction = backend.buildSystemInstruction();
    expect(instruction).toContain('Docs');
    expect(instruction).toContain('Short');
  });

  test('answers ask endpoint and records history', async () => {
    const historyStore = createHistoryStore();
    const { genai } = createMockGenai({ replyText: 'Hello there' });
    const backend = createBackend({ logger, historyStoreImpl: historyStore, genaiClient: genai });
    const agent = request(backend.app);

    const res = await agent.post('/ask').send({ prompt: 'Hi' }).expect(200);
    expect(res.body).toEqual({ reply: 'Hello there' });
    expect(backend.state.history).toEqual([{ prompt: 'Hi', reply: 'Hello there' }]);
  });

  test('handles generation errors gracefully', async () => {
    const historyStore = createHistoryStore();
    const { genai } = createMockGenai();
    const error = new Error('boom');
    genai.getGenerativeModel().generateContent.mockRejectedValueOnce(error);
    const backend = createBackend({ logger, historyStoreImpl: historyStore, genaiClient: genai });
    const agent = request(backend.app);

    const res = await agent.post('/ask').send({ prompt: 'Hi' }).expect(500);
    expect(res.body).toEqual({ error: 'Generation failed' });
    expect(logger.error).toHaveBeenCalledWith('Error:', error);
  });

  test('delegates to history store implementations', async () => {
    const historyStore = createHistoryStore();
    const backend = createBackend({ logger, historyStoreImpl: historyStore, genaiClient: createMockGenai().genai });
    const agent = request(backend.app);

    await agent.post('/history/test-session/turn').send({ role: 'user' }).expect(200);
    expect(historyStore.appendTurn).toHaveBeenCalledWith('test-session', { role: 'user' });

    await agent.delete('/history').expect(200);
    expect(historyStore.clearHistory).toHaveBeenCalled();

    await agent.get('/history').expect(200);
    expect(historyStore.listSessions).toHaveBeenCalled();

    await agent.put('/history/limit').send({ limit: 10 }).expect(200);
    expect(historyStore.setMaxSessions).toHaveBeenCalledWith(10);

    const notFound = await agent.get('/history/unknown').expect(404);
    expect(notFound.body).toEqual({ error: 'Not found' });
  });

  test('websocket bridge proxies messages to Gemini and back', async () => {
    const audioChunk = Buffer.from('audio-chunk').toString('base64');
    const responses = [
      {
        serverContent: {
          modelTurn: {
            parts: [
              { text: 'streamed ' },
              { inlineData: { data: audioChunk, mimeType: 'audio/pcm;rate=16000' } },
              { text: 'response' },
            ],
            turnComplete: false,
          },
        },
      },
      { text: 'final chunk', final: true },
    ];
    const { genai, session } = createMockGenai({ responses });
    const historyStore = createHistoryStore();
    const backend = createBackend({
      logger,
      historyStoreImpl: historyStore,
      genaiClient: genai,
      ModalityEnum: { TEXT: 'TEXT' },
      port: 0,
    });

    const server = backend.app.listen(0);
    const address = server.address();
    const port = typeof address === 'object' ? address.port : 0;
    const wss = backend.attachLiveWebSocket(server);

    const ws = new WebSocket(`ws://127.0.0.1:${port}/live`);

    await new Promise(resolve => ws.on('open', resolve));

    const messages = [];
    const streamComplete = new Promise(resolve => {
      ws.on('message', data => {
        const payload = JSON.parse(data.toString());
        messages.push(payload);
        if (payload.type === 'status' && payload.event === 'session_closed') {
          resolve();
        }
      });
    });

    const payload = { audio: Buffer.from('abc').toString('base64'), mimeType: 'audio/test' };
    ws.send(JSON.stringify(payload));

    await new Promise(resolve => setImmediate(resolve));
    expect(session.sentInputs).toHaveLength(1);
    expect(session.sentInputs[0]).toEqual({
      audio: { data: Buffer.from('abc'), mime_type: 'audio/test' },
    });

    await streamComplete;

    expect(messages[0]).toEqual({ type: 'status', event: 'session_open', model: 'gemini-live-2.5-flash-preview' });

    const textChunk = messages.find(msg => msg.type === 'model_text' && msg.final === false);
    expect(textChunk).toEqual({ type: 'model_text', text: 'streamed response', final: false });

    const audioFrame = messages.find(msg => msg.type === 'model_audio');
    expect(audioFrame).toEqual({
      type: 'model_audio',
      data: audioChunk,
      mime: 'audio/pcm;rate=16000',
      final: false,
    });

    const finalChunk = messages.find(msg => msg.type === 'model_text' && msg.final === true);
    expect(finalChunk).toEqual({ type: 'model_text', text: 'final chunk', final: true });

    expect(messages[messages.length - 1]).toEqual({
      type: 'status',
      event: 'session_closed',
      reason: 'stream_complete',
    });

    ws.close();
    await new Promise(resolve => ws.on('close', resolve));
    expect(session.closed).toBe(true);

    await new Promise(resolve => wss.close(resolve));
    await new Promise(resolve => server.close(resolve));
  });

  test('websocket bridge surfaces stream errors as error frames', async () => {
    const receiveError = new Error('stream explode');
    const { genai } = createMockGenai({ receiveError });
    const historyStore = createHistoryStore();
    const backend = createBackend({
      logger,
      historyStoreImpl: historyStore,
      genaiClient: genai,
      ModalityEnum: { TEXT: 'TEXT' },
      port: 0,
    });

    const server = backend.app.listen(0);
    const address = server.address();
    const port = typeof address === 'object' ? address.port : 0;
    const wss = backend.attachLiveWebSocket(server);

    const ws = new WebSocket(`ws://127.0.0.1:${port}/live`);

    await new Promise(resolve => ws.on('open', resolve));

    const errorFrame = await new Promise(resolve => {
      ws.on('message', data => {
        const payload = JSON.parse(data.toString());
        if (payload.type === 'error') {
          resolve(payload);
        }
      });
    });

    expect(errorFrame).toMatchObject({
      type: 'error',
      event: 'session_error',
      message: expect.stringContaining('stream explode'),
    });

    ws.close();
    await new Promise(resolve => ws.on('close', resolve));

    await new Promise(resolve => wss.close(resolve));
    await new Promise(resolve => server.close(resolve));
  });
});
