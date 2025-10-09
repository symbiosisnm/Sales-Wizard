require('dotenv').config();
require("../src/utils/logger");
const express = require('express');
const { GoogleGenAI, Modality } = require('@google/genai');
const { WebSocketServer } = require('ws');
const { Blob } = require('buffer');
const historyStore = require('./historyStore');

const app = express();
app.use(express.json());
const genai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });

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
    historyStore.appendTurn(sessionId, req.body || {});
    res.json({ ok: true });
  } catch (err) {
    logger.error('Error saving history turn:', err);
    res.status(500).json({ error: 'Failed to save turn' });
  }
});

// Clear all stored history sessions
app.delete('/history', (_req, res) => {
  try {
    historyStore.clearHistory();
    res.json({ ok: true });
  } catch (err) {
    logger.error('Error clearing history:', err);
    res.status(500).json({ error: 'Failed to clear history' });
  }
});

app.get('/history', (req, res) => {
  try {
    const sessions = historyStore.listSessions();
    res.json(sessions);
  } catch (err) {
    logger.error('Error listing history:', err);
    res.status(500).json({ error: 'Failed to list history' });
  }
});

app.get('/history/:sessionId', (req, res) => {
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
app.put('/history/limit', (req, res) => {
  try {
    historyStore.setMaxSessions(req.body?.limit);
    res.json({ ok: true, limit: req.body?.limit });
  } catch (err) {
    logger.error('Error updating history limit:', err);
    res.status(500).json({ error: 'Failed to update limit' });
  }
});

const server = app.listen(process.env.PORT || 3001);

// WebSocket endpoint for Gemini Live
const wss = new WebSocketServer({ server, path: '/live' });
wss.on('connection', (ws) => {
  let liveSession = null;
  let started = false;
  let shuttingDown = false;

  const now = () => new Date().toISOString();
  const sendJSON = (payload) => {
    try {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify(payload));
      }
    } catch (err) {
      logger.error('Failed to send WS payload', err);
    }
  };

  const sendStatus = (message, { terminal = false } = {}) =>
    sendJSON({ type: 'status', message, terminal, ts: now() });
  const sendError = (message, { terminal = false } = {}) =>
    sendJSON({ type: 'error', message, terminal, ts: now() });
  const sendText = (text) => sendJSON({ type: 'model_text', text });
  const sendAudio = (data, mime) => sendJSON({ type: 'model_audio', data, mime });

  const finalize = async (message, { sendTerminal = true } = {}) => {
    if (shuttingDown) return;
    if (sendTerminal) {
      const terminalMessage = message || 'Session closed';
      sendStatus(terminalMessage, { terminal: true });
    }
    shuttingDown = true;
    try {
      await liveSession?.close?.();
    } catch (err) {
      logger.error('Error closing live session', err);
    }
    try {
      if (ws.readyState === ws.OPEN || ws.readyState === ws.CLOSING) {
        ws.close();
      }
    } catch (err) {
      logger.error('Error closing WebSocket', err);
    }
  };

  const normalizeModalities = (modalities) => {
    if (!Array.isArray(modalities) || modalities.length === 0) {
      return [Modality.TEXT];
    }
    return modalities.map((mod) => {
      if (typeof mod === 'string' && Modality[mod]) {
        return Modality[mod];
      }
      return mod;
    });
  };

  const forwardServerMessage = (message) => {
    try {
      const text = typeof message?.text === 'string' ? message.text : '';
      if (text) {
        sendText(text);
      }

      const parts = message?.serverContent?.modelTurn?.parts || [];
      for (const part of parts) {
        const inline = part?.inlineData;
        if (inline?.mimeType?.startsWith('audio/') && inline.data) {
          try {
            let buffer;
            if (typeof inline.data === 'string') {
              buffer = Buffer.from(inline.data, 'base64');
            } else if (inline.data instanceof Uint8Array || Buffer.isBuffer(inline.data)) {
              buffer = Buffer.from(inline.data);
            }
            if (buffer && buffer.length) {
              sendAudio(buffer.toString('base64'), inline.mimeType);
            }
          } catch (err) {
            logger.error('Failed to forward audio chunk', err);
          }
        }
      }
    } catch (err) {
      logger.error('Error forwarding Gemini message', err);
    }
  };

  sendStatus('Connected to live gateway. Awaiting start command.');

  ws.on('message', async (raw) => {
    if (shuttingDown) return;
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch (err) {
      logger.warn('Discarding invalid JSON payload', err);
      sendError('Invalid JSON payload');
      return;
    }

    if (!started) {
      if (msg?.type !== 'start') {
        sendError('First message must be a start command', { terminal: true });
        await finalize('Session terminated: start command missing');
        return;
      }

      started = true;
      const model = typeof msg.model === 'string' && msg.model.trim() ? msg.model.trim() : 'gemini-2.0-flash-live-001';
      const systemInstruction = msg.systemInstruction || buildSystemInstruction();
      const responseModalities = normalizeModalities(msg.responseModalities);

      sendStatus(`Starting Gemini live session on ${model}...`);

      try {
        liveSession = await genai.live.connect({
          model,
          config: {
            responseModalities,
            systemInstruction: systemInstruction ? { parts: [{ text: systemInstruction }] } : undefined,
          },
          httpOptions: { apiVersion: 'v1alpha' },
          callbacks: {
            onopen: () => sendStatus('Gemini live session established'),
            onmessage: forwardServerMessage,
            onerror: (err) => {
              logger.error('Gemini live error', err);
              sendError(`Gemini live error: ${err?.message || err}`);
            },
            onclose: (evt) => {
              const reason = evt?.reason ? `Gemini live closed: ${evt.reason}` : 'Gemini live closed';
              finalize(reason).catch((closeErr) => logger.error('Error during live finalize', closeErr));
            },
          },
        });

        sendStatus(`Live session ready on model ${model}`);
      } catch (err) {
        logger.error('Failed to start live session', err);
        sendError('Failed to start live session', { terminal: true });
        await finalize('Session terminated: Gemini live start failure');
      }
      return;
    }

    if (!liveSession) {
      sendError('Live session not initialized');
      return;
    }

    switch (msg.type) {
      case 'text':
        if (typeof msg.text === 'string' && msg.text.trim()) {
          try {
            await liveSession.sendClientContent({
              turns: [{ parts: [{ text: msg.text }] }],
            });
          } catch (err) {
            logger.error('Failed to forward text input', err);
            sendError('Failed to send text to Gemini');
          }
        }
        break;
      case 'audio':
        if (typeof msg.data === 'string' && msg.data) {
          try {
            const bytes = Buffer.from(msg.data, 'base64');
            const blob = new Blob([bytes], { type: msg.mime || 'audio/pcm;rate=16000' });
            liveSession.sendRealtimeInput({ media: blob });
          } catch (err) {
            logger.error('Failed to forward audio input', err);
            sendError('Failed to send audio to Gemini');
          }
        }
        break;
      case 'image':
        if (typeof msg.data === 'string' && msg.data) {
          try {
            const bytes = Buffer.from(msg.data, 'base64');
            const blob = new Blob([bytes], { type: msg.mime || 'image/jpeg' });
            liveSession.sendRealtimeInput({ media: blob });
          } catch (err) {
            logger.error('Failed to forward image input', err);
            sendError('Failed to send image to Gemini');
          }
        }
        break;
      case 'end':
        await finalize('Session ended by client');
        break;
      default:
        sendError(`Unsupported message type: ${msg.type}`);
        break;
    }
  });

  ws.on('close', async () => {
    shuttingDown = true;
    try {
      await liveSession?.close?.();
    } catch (err) {
      logger.error('Error closing live session after socket close', err);
    }
  });
});
