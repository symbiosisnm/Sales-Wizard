require('dotenv').config();
require('../src/utils/logger');
const express = require('express');
const { GoogleGenAI, Modality } = require('@google/genai');
const { WebSocketServer } = require('ws');
const { Blob } = require('buffer');
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

  const expectedToken = (process.env.AUTH_TOKEN || '').trim();
  const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean);

  function originAllowed(origin) {
    if (!allowedOrigins.length) {
      return true;
    }
    return typeof origin === 'string' && allowedOrigins.includes(origin);
  }

  function applyCorsHeaders(res, origin) {
    if (originAllowed(origin) && origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    }
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, AUTH_TOKEN, authToken, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS,PATCH');
  }

  function extractHttpToken(req) {
    return (
      req.get('AUTH_TOKEN') ||
      req.get('auth_token') ||
      req.query?.authToken ||
      req.query?.AUTH_TOKEN ||
      ''
    ).toString().trim();
  }

  app.use((req, res, next) => {
    const origin = req.get('Origin') || req.get('origin');

    if (!originAllowed(origin)) {
      return res.status(403).json({ error: 'Origin not allowed' });
    }

    applyCorsHeaders(res, origin);

    if (req.method === 'OPTIONS') {
      return res.sendStatus(204);
    }

    if (!expectedToken) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const providedToken = extractHttpToken(req);
    if (providedToken !== expectedToken) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    return next();
  });

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

  function wsSend(wsInstance, payload) {
    try {
      if (wsInstance.readyState === wsInstance.OPEN) {
        wsInstance.send(JSON.stringify(payload));
      }
    } catch (err) {
      logger.error('Failed to send websocket payload:', err);
    }
  }

  function normalizeGeminiResponse(response) {
    const frames = [];
    if (!response || typeof response !== 'object') {
      return frames;
    }

    const isFinal = Boolean(
      response.final ||
        response.isFinal ||
        response.done ||
        response.turnComplete ||
        response?.serverContent?.turnComplete ||
        response?.serverContent?.modelTurn?.turnComplete ||
        response?.metadata?.turnComplete
    );

    const seenTexts = new Set();
    const collectText = text => {
      if (typeof text !== 'string') return;
      const trimmed = text;
      if (!trimmed) return;
      if (seenTexts.has(trimmed)) return;
      seenTexts.add(trimmed);
    };

    const visitParts = parts => {
      if (!Array.isArray(parts)) return { textParts: [], audioParts: [] };
      const textParts = [];
      const audioParts = [];
      for (const part of parts) {
        if (!part) continue;
        if (typeof part === 'string') {
          textParts.push(part);
        } else if (typeof part.text === 'string') {
          textParts.push(part.text);
        } else if (part.inlineData && part.inlineData.mimeType) {
          audioParts.push(part.inlineData);
        }
      }
      return { textParts, audioParts };
    };

    const textCandidates = [];
    const audioCandidates = [];

    if (typeof response.text === 'string') {
      textCandidates.push(response.text);
    }

    if (typeof response.output_text === 'string') {
      textCandidates.push(response.output_text);
    }

    if (Array.isArray(response.output_texts)) {
      textCandidates.push(...response.output_texts.filter(t => typeof t === 'string'));
    }

    if (Array.isArray(response.candidates)) {
      for (const candidate of response.candidates) {
        if (candidate?.content?.parts) {
          const { textParts, audioParts } = visitParts(candidate.content.parts);
          textCandidates.push(...textParts);
          audioCandidates.push(...audioParts);
        }
      }
    }

    if (response.serverContent?.modelTurn?.parts) {
      const { textParts, audioParts } = visitParts(response.serverContent.modelTurn.parts);
      textCandidates.push(...textParts);
      audioCandidates.push(...audioParts);
    }

    if (response.modelTurn?.parts) {
      const { textParts, audioParts } = visitParts(response.modelTurn.parts);
      textCandidates.push(...textParts);
      audioCandidates.push(...audioParts);
    }

    const uniqueTexts = [];
    for (const candidate of textCandidates) {
      collectText(candidate);
    }

    for (const value of seenTexts.values()) {
      uniqueTexts.push(value);
    }

    if (uniqueTexts.length > 0) {
      frames.push({ type: 'model_text', text: uniqueTexts.join(''), final: isFinal });
    }

    const toBase64 = data => {
      if (typeof data === 'string') {
        try {
          return Buffer.from(data, 'base64').toString('base64');
        } catch (err) {
          logger.error('Failed to treat inline string as base64, falling back to utf8 -> base64:', err);
          return Buffer.from(data).toString('base64');
        }
      }
      if (ArrayBuffer.isView(data)) {
        return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString('base64');
      }
      if (data instanceof ArrayBuffer) {
        return Buffer.from(new Uint8Array(data)).toString('base64');
      }
      if (data instanceof Blob) {
        // synchronous conversion for Blob is non-trivial; leave empty
        return '';
      }
      try {
        return Buffer.from(data).toString('base64');
      } catch (err) {
        logger.error('Unable to convert inline data to base64:', err);
        return '';
      }
    };

    for (const inlineData of audioCandidates) {
      const base64 = toBase64(inlineData?.data);
      if (!base64) continue;
      frames.push({
        type: 'model_audio',
        data: base64,
        mime: inlineData.mimeType || 'audio/pcm;rate=16000',
        final: isFinal,
      });
    }

    if (response.error) {
      const message = typeof response.error === 'string' ? response.error : response.error.message || 'Gemini error';
      frames.push({ type: 'error', event: 'model_error', message });
    }

    return frames;
  }

  async function handleLiveConnection(ws) {
    const sendStatus = (event, extra = {}) => wsSend(ws, { type: 'status', event, ...extra });
    const sendError = (event, err) => {
      const message = err?.message || err?.toString() || 'Unknown error';
      wsSend(ws, { type: 'error', event, message });
    };

    let session;
    const model = 'gemini-live-2.5-flash-preview';
    try {
      session = await genai.live.connect({
        model,
        config: { response_modalities: [ModalityEnum.TEXT], system_instruction: buildSystemInstruction() },
      });
      sendStatus('session_open', { model });
    } catch (err) {
      logger.error('Failed to open Gemini live session:', err);
      sendError('session_error', err);
      if (ws.readyState === ws.OPEN) {
        ws.close(1011, 'Gemini live connection failed');
      }
      throw err;
    }

    (async () => {
      try {
        for await (const response of session.receive()) {
          const frames = normalizeGeminiResponse(response);
          for (const frame of frames) {
            wsSend(ws, frame);
          }
        }
        sendStatus('session_closed', { reason: 'stream_complete' });
      } catch (err) {
        logger.error('Error streaming Gemini response:', err);
        sendError('session_error', err);
        sendStatus('session_closed', { reason: 'stream_error' });
      }
    })().catch(err => {
      logger.error('Unexpected error in Gemini receive loop:', err);
      sendError('session_error', err);
    });

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
        sendError('client_error', err);
      }
    });

    ws.on('close', () => {
      if (typeof session.close === 'function') {
        session.close();
      }
    });

    return session;
  }

  function extractSocketToken(request) {
    const headerToken =
      request.headers['auth_token'] ||
      request.headers['auth-token'] ||
      request.headers['AUTH_TOKEN'];

    if (headerToken) {
      return headerToken.toString().trim();
    }

    try {
      const url = new URL(request.url, `http://${request.headers.host}`);
      return (
        url.searchParams.get('authToken') ||
        url.searchParams.get('AUTH_TOKEN') ||
        ''
      )
        .toString()
        .trim();
    } catch (err) {
      logger.error('Failed to parse WebSocket auth parameters:', err);
      return '';
    }
  }

  function attachLiveWebSocket(serverInstance) {
    const wss = new WebSocketServer({ noServer: true });

    const upgradeListener = (request, socket, head) => {
      let parsedUrl;
      try {
        parsedUrl = new URL(request.url, `http://${request.headers.host}`);
      } catch (err) {
        socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
        socket.destroy();
        return;
      }

      if (parsedUrl.pathname !== '/live') {
        socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
        socket.destroy();
        return;
      }

      const origin = request.headers.origin || request.headers.Origin;

      if (!originAllowed(origin)) {
        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
        socket.destroy();
        return;
      }

      if (!expectedToken) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }

      const token = extractSocketToken(request);
      if (token !== expectedToken) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }

      wss.handleUpgrade(request, socket, head, ws => {
        wss.emit('connection', ws, request);
      });
    };

    serverInstance.on('upgrade', upgradeListener);

    wss.on('close', () => {
      serverInstance.removeListener('upgrade', upgradeListener);
    });

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

function startServer(options = {}) {
  const backend = createBackend(options);
  return backend.start();
}

if (require.main === module) {
  startServer();
}

module.exports = { createBackend, startServer };
