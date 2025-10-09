require('dotenv').config();
require('../src/utils/logger');
const express = require('express');
const { GoogleGenAI, Modality } = require('@google/genai');
const { WebSocketServer } = require('ws');
const historyStore = require('./historyStore');

const app = express();
app.use(express.json());
const genai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });

const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean);

function isOriginAllowed(origin) {
  if (!origin || allowedOrigins.length === 0) {
    return true;
  }
  return allowedOrigins.includes(origin);
}

app.use((req, res, next) => {
  const origin = req.get('Origin');
  if (origin && !isOriginAllowed(origin)) {
    return res.status(403).json({ error: 'Origin not allowed' });
  }

  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }

  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, AUTH_TOKEN');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }

  return next();
});

function getConfiguredToken() {
  return (process.env.AUTH_TOKEN || '').trim();
}

function extractAuthToken(req) {
  const headerToken = (req.get('AUTH_TOKEN') || '').trim();
  const queryToken = (req.query?.AUTH_TOKEN || req.query?.authToken || '').trim();
  return headerToken || queryToken;
}

function authMiddleware(req, res, next) {
  if (req.method === 'OPTIONS') {
    return next();
  }

  const configuredToken = getConfiguredToken();
  if (!configuredToken) {
    logger.error('AUTH_TOKEN environment variable is not configured.');
    return res.status(500).json({ error: 'Server misconfiguration' });
  }

  const providedToken = extractAuthToken(req);
  if (providedToken !== configuredToken) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  return next();
}

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

app.post('/ask', authMiddleware, async (req, res) => {
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

app.post('/history/:sessionId/turn', authMiddleware, (req, res) => {
  const { sessionId } = req.params;
  try {
    historyStore.appendTurn(sessionId, req.body || {});
    res.json({ ok: true });
  } catch (err) {
    logger.error('Error saving history turn:', err);
    res.status(500).json({ error: 'Failed to save turn' });
  }
});

// Clear all stored history sessions
app.delete('/history', authMiddleware, (_req, res) => {
  try {
    historyStore.clearHistory();
    res.json({ ok: true });
  } catch (err) {
    logger.error('Error clearing history:', err);
    res.status(500).json({ error: 'Failed to clear history' });
  }
});

app.get('/history', authMiddleware, (req, res) => {
  try {
    const sessions = historyStore.listSessions();
    res.json(sessions);
  } catch (err) {
    logger.error('Error listing history:', err);
    res.status(500).json({ error: 'Failed to list history' });
  }
});

app.get('/history/:sessionId', authMiddleware, (req, res) => {
  try {
    const session = historyStore.getSession(req.params.sessionId);
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
app.put('/history/limit', authMiddleware, (req, res) => {
  try {
    historyStore.setMaxSessions(req.body?.limit);
    res.json({ ok: true, limit: req.body?.limit });
  } catch (err) {
    logger.error('Error updating history limit:', err);
    res.status(500).json({ error: 'Failed to update limit' });
  }
});

function startWebSocketServer(serverInstance) {
  const wssInstance = new WebSocketServer({ server: serverInstance, path: '/live' });
  wssInstance.on('connection', async (ws, req) => {
    const origin = req.headers?.origin;
    if (origin && !isOriginAllowed(origin)) {
      ws.close(1008, 'Origin not allowed');
      return;
    }

    const configuredToken = getConfiguredToken();
    if (!configuredToken) {
      logger.error('AUTH_TOKEN environment variable is not configured.');
      ws.close(1011, 'Server misconfiguration');
      return;
    }

    const headerToken = (req.headers?.auth_token || req.headers?.['auth-token'] || '').trim();
    const requestUrl = new URL(req.url, 'http://localhost');
    const queryToken =
      (requestUrl.searchParams.get('AUTH_TOKEN') || requestUrl.searchParams.get('authToken') || '').trim();
    const providedToken = headerToken || queryToken;

    if (providedToken !== configuredToken) {
      ws.close(1008, 'Unauthorized');
      return;
    }

    try {
      const session = await genai.live.connect({
        model: 'gemini-live-2.5-flash-preview',
        config: { response_modalities: [Modality.TEXT], system_instruction: buildSystemInstruction() }
      });

      // Forward Gemini replies back to the client
      (async () => {
        for await (const response of session.receive()) {
          ws.send(JSON.stringify({ text: response.text || '' }));
        }
      })();

      ws.on('message', async (msg) => {
        const data = JSON.parse(msg);
        if (data.audio) {
          const buf = Buffer.from(data.audio, 'base64');
          await session.send_realtime_input({
            audio: { data: buf, mime_type: data.mimeType || 'audio/pcm;rate=16000' }
          });
        } else if (data.image) {
          const buf = Buffer.from(data.image, 'base64');
          await session.send_realtime_input({
            image: { data: buf, mime_type: data.mimeType || 'image/jpeg' }
          });
        }
      });

      ws.on('close', () => session.close());
    } catch (err) {
      logger.error('Failed to initialize Gemini Live session:', err);
      ws.close(1011, 'Gemini Live initialization failed');
    }
  });

  return wssInstance;
}

function startServer({ port } = {}) {
  const listenPort = port ?? process.env.PORT ?? 3001;
  const serverInstance = app.listen(listenPort);
  const wssInstance = startWebSocketServer(serverInstance);
  return { server: serverInstance, wss: wssInstance };
}

if (require.main === module) {
  startServer();
}

module.exports = { app, startServer, state };
