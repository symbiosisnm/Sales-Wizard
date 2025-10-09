require('dotenv').config();
require('../src/utils/logger');
const express = require('express');
const { GoogleGenAI, Modality } = require('@google/genai');
const { WebSocketServer } = require('ws');
const historyStore = require('./historyStore');

function createBackend(options = {}) {
  const {
    logger = globalThis.logger || console,
    historyStoreImpl = historyStore,
    genaiClient,
    port = process.env.PORT || 3001,
    ModalityEnum = Modality,
  } = options;

  const app = express();
  app.use(express.json());

  const genai = genaiClient || new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });

  // In-memory state for conversation history and context parameters
  const state = {
    history: [],
    contextParams: {
      allowedSources: '',
      toneLength: '',
      disallowedTopics: '',
    },
  };

  // Helper to build system instructions from stored parameters
  function buildSystemInstruction() {
    const parts = ['You are a helpful assistant.'];
    const { allowedSources, toneLength, disallowedTopics } = state.contextParams;
    if (allowedSources) parts.push(`Limit knowledge retrieval to: ${allowedSources}.`);
    if (toneLength) parts.push(`Maintain tone/length constraints: ${toneLength}.`);
    if (disallowedTopics) parts.push(`Avoid the following topics: ${disallowedTopics}.`);
    return parts.join(' ');
  }

  // Context parameters endpoints
  app.get('/context-params', (_req, res) => {
    res.json(state.contextParams);
  });

  app.put('/context-params', (req, res) => {
    state.contextParams = { ...state.contextParams, ...req.body };
    res.json({ success: true, data: state.contextParams });
  });

  app.post('/ask', async (req, res) => {
    const prompt = req.body.prompt || '';
    try {
      const model = genai.getGenerativeModel({
        model: 'gemini-pro',
        systemInstruction: buildSystemInstruction(),
      });
      const result = await model.generateContent([{ role: 'user', parts: [{ text: prompt }] }]);
      const reply = result?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
      state.history.push({ prompt, reply });
      res.json({ reply });
    } catch (err) {
      logger.error('Error:', err);
      res.status(500).json({ error: 'Generation failed' });
    }
  });

  app.post('/history/:sessionId/turn', (req, res) => {
    const { sessionId } = req.params;
    try {
      historyStoreImpl.appendTurn(sessionId, req.body || {});
      res.json({ ok: true });
    } catch (err) {
      logger.error('Error saving history turn:', err);
      res.status(500).json({ error: 'Failed to save turn' });
    }
  });

  // Clear all stored history sessions
  app.delete('/history', (_req, res) => {
    try {
      historyStoreImpl.clearHistory();
      res.json({ ok: true });
    } catch (err) {
      logger.error('Error clearing history:', err);
      res.status(500).json({ error: 'Failed to clear history' });
    }
  });

  app.get('/history', (req, res) => {
    try {
      const sessions = historyStoreImpl.listSessions();
      res.json(sessions);
    } catch (err) {
      logger.error('Error listing history:', err);
      res.status(500).json({ error: 'Failed to list history' });
    }
  });

  app.get('/history/:sessionId', (req, res) => {
    try {
      const session = historyStoreImpl.getSession(req.params.sessionId);
      if (!session) {
        return res.status(404).json({ error: 'Not found' });
      }
      res.json(session);
    } catch (err) {
      logger.error('Error loading session:', err);
      res.status(500).json({ error: 'Failed to load session' });
    }
  });

  // Update maximum stored session count
  app.put('/history/limit', (req, res) => {
    try {
      historyStoreImpl.setMaxSessions(req.body?.limit);
      res.json({ ok: true, limit: req.body?.limit });
    } catch (err) {
      logger.error('Error updating history limit:', err);
      res.status(500).json({ error: 'Failed to update limit' });
    }
  });

  async function handleLiveConnection(ws) {
    const session = await genai.live.connect({
      model: 'gemini-live-2.5-flash-preview',
      config: { response_modalities: [ModalityEnum.TEXT], system_instruction: buildSystemInstruction() },
    });

    (async () => {
      for await (const response of session.receive()) {
        ws.send(JSON.stringify({ text: response.text || '' }));
      }
    })().catch(err => logger.error('Error streaming Gemini response:', err));

    ws.on('message', async msg => {
      try {
        const data = JSON.parse(msg);
        if (data.audio) {
          const buf = Buffer.from(data.audio, 'base64');
          await session.send_realtime_input({
            audio: { data: buf, mime_type: data.mimeType || 'audio/pcm;rate=16000' },
          });
        } else if (data.image) {
          const buf = Buffer.from(data.image, 'base64');
          await session.send_realtime_input({ image: { data: buf, mime_type: data.mimeType || 'image/jpeg' } });
        }
      } catch (err) {
        logger.error('Error handling live message:', err);
      }
    });

    ws.on('close', () => {
      if (typeof session.close === 'function') {
        session.close();
      }
    });

    return session;
  }

  function attachLiveWebSocket(serverInstance) {
    const wss = new WebSocketServer({ server: serverInstance, path: '/live' });
    wss.on('connection', ws => {
      handleLiveConnection(ws).catch(err => logger.error('Failed to establish live session:', err));
    });
    return wss;
  }

  function start() {
    const serverInstance = app.listen(port);
    const wss = attachLiveWebSocket(serverInstance);
    return { server: serverInstance, wss };
  }

  return { app, state, buildSystemInstruction, start, attachLiveWebSocket };
}

if (require.main === module) {
  const { start } = createBackend();
  start();
}

module.exports = { createBackend };
