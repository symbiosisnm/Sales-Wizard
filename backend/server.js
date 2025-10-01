require('dotenv').config();
require("../src/utils/logger");
const express = require('express');
const { GoogleGenAI, Modality } = require('@google/genai');
const { Blob } = require('buffer');
const { WebSocketServer } = require('ws');
const historyStore = require('./historyStore');

const logger = global.logger || console;

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
  let starting = false;
  let closed = false;

  const defaultModel = 'gemini-live-2.5-flash-preview';

  function safeSend(payload) {
    try {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify(payload));
      }
    } catch (err) {
      logger?.error?.('WS send error', err);
    }
  }

  function sendStatus(msg) {
    safeSend({ type: 'status', msg });
  }

  function sendError(msg) {
    safeSend({ type: 'error', msg });
  }

  function extractTextAndMedia(message) {
    try {
      const textParts = [];
      const audioParts = [];

      if (typeof message?.text === 'string' && message.text.trim()) {
        textParts.push(message.text.trim());
      }

      const candidateParts = [];

      const serverParts = message?.serverContent?.modelTurn?.parts;
      if (Array.isArray(serverParts)) {
        candidateParts.push(...serverParts);
      }

      const outputParts = message?.output?.[0]?.content?.parts;
      if (Array.isArray(outputParts)) {
        candidateParts.push(...outputParts);
      }

      const directParts = message?.parts;
      if (Array.isArray(directParts)) {
        candidateParts.push(...directParts);
      }

      for (const part of candidateParts) {
        if (typeof part?.text === 'string' && part.text) {
          textParts.push(part.text);
        }

        const inlineData = part?.inlineData || part?.data;
        const mime = inlineData?.mimeType || inlineData?.mime_type || '';
        if (inlineData?.data && typeof inlineData.data !== 'undefined' && typeof mime === 'string' && mime.startsWith('audio/')) {
          try {
            const base64 = Buffer.from(inlineData.data).toString('base64');
            audioParts.push({ data: base64, mime });
          } catch (e) {
            logger?.warn?.('Failed to encode audio part', e);
          }
        }
      }

      if (textParts.length) {
        safeSend({ type: 'model_text', text: textParts.join('') });
      }

      for (const audio of audioParts) {
        safeSend({ type: 'model_audio', data: audio.data, mime: audio.mime });
      }
    } catch (err) {
      logger?.warn?.('Failed to forward live response', err);
    }
  }

  async function startSession(payload) {
    if (starting || liveSession) {
      return sendError('Session already started');
    }
    starting = true;

    const model = typeof payload?.model === 'string' && payload.model.trim()
      ? payload.model.trim()
      : defaultModel;

    const responseModalitiesInput = Array.isArray(payload?.responseModalities) && payload.responseModalities.length
      ? payload.responseModalities
      : ['TEXT'];

    const responseModalities = responseModalitiesInput
      .map((m) => {
        const key = typeof m === 'string' ? m.toUpperCase() : 'TEXT';
        return Modality[key] || Modality.TEXT;
      })
      .filter(Boolean);

    const userInstruction = typeof payload?.systemInstruction === 'string' ? payload.systemInstruction.trim() : '';
    const baseInstruction = buildSystemInstruction();
    const combinedInstruction = [baseInstruction, userInstruction].filter(Boolean).join(' ');

    try {
      sendStatus('Connecting to Gemini live session');
      liveSession = await genai.live.connect({
        model,
        config: {
          responseModalities: responseModalities.length ? responseModalities : [Modality.TEXT],
          systemInstruction: combinedInstruction ? { parts: [{ text: combinedInstruction }] } : undefined,
        },
        callbacks: {
          onopen: () => sendStatus('Gemini live opened'),
          onclose: (evt) => sendStatus(`Gemini live closed${evt?.reason ? `: ${evt.reason}` : ''}`),
          onerror: (err) => sendError(`Gemini live error: ${err?.message || err}`),
          onmessage: (msg) => extractTextAndMedia(msg),
        },
      });
      sendStatus(`Live session ready on model ${model}`);
    } catch (err) {
      logger?.error?.('Failed to start live session', err);
      sendError(`Failed to start live session: ${err?.message || err}`);
    } finally {
      starting = false;
    }
  }

  async function handleTextMessage(payload) {
    if (!liveSession) {
      return sendError('Not started');
    }
    const text = typeof payload?.text === 'string' ? payload.text.trim() : '';
    if (!text) {
      return sendError('Missing text payload');
    }
    try {
      liveSession.sendClientContent({
        turns: [{ parts: [{ text }] }],
      });
    } catch (err) {
      logger?.error?.('Failed to forward text to live session', err);
      sendError(`Failed to send text: ${err?.message || err}`);
    }
  }

  async function handleAudioMessage(payload) {
    if (!liveSession) {
      return sendError('Not started');
    }
    const base64 = typeof payload?.data === 'string' ? payload.data : '';
    if (!base64) {
      return sendError('Missing audio payload');
    }
    const mime = typeof payload?.mime === 'string' && payload.mime ? payload.mime : 'audio/pcm;rate=16000';
    try {
      const buffer = Buffer.from(base64, 'base64');
      const blob = new Blob([buffer], { type: mime });
      liveSession.sendRealtimeInput({ media: blob });
    } catch (err) {
      logger?.error?.('Failed to forward audio to live session', err);
      sendError(`Failed to send audio: ${err?.message || err}`);
    }
  }

  async function handleImageMessage(payload) {
    if (!liveSession) {
      return sendError('Not started');
    }
    const base64 = typeof payload?.data === 'string' ? payload.data : '';
    if (!base64) {
      return sendError('Missing image payload');
    }
    const mime = typeof payload?.mime === 'string' && payload.mime ? payload.mime : 'image/jpeg';
    try {
      const buffer = Buffer.from(base64, 'base64');
      const blob = new Blob([buffer], { type: mime });
      liveSession.sendRealtimeInput({ media: blob });
    } catch (err) {
      logger?.error?.('Failed to forward image to live session', err);
      sendError(`Failed to send image: ${err?.message || err}`);
    }
  }

  async function handleEndMessage() {
    try {
      await liveSession?.close?.();
    } catch (err) {
      logger?.warn?.('Error closing live session', err);
    }
    liveSession = null;
    try {
      if (ws.readyState === ws.OPEN || ws.readyState === ws.CLOSING) {
        ws.close();
      }
    } catch (err) {
      logger?.warn?.('Error closing client websocket', err);
    }
    closed = true;
  }

  ws.on('message', async (raw) => {
    if (closed) return;
    let payload;
    try {
      payload = JSON.parse(raw.toString());
    } catch (err) {
      return sendError('Invalid JSON payload');
    }

    const type = payload?.type;
    switch (type) {
      case 'start':
        await startSession(payload);
        break;
      case 'text':
        await handleTextMessage(payload);
        break;
      case 'audio':
        await handleAudioMessage(payload);
        break;
      case 'image':
        await handleImageMessage(payload);
        break;
      case 'end':
        await handleEndMessage();
        break;
      default:
        sendError('Unsupported message type');
        break;
    }
  });

  ws.on('close', async () => {
    closed = true;
    try {
      await liveSession?.close?.();
    } catch (err) {
      logger?.warn?.('Error closing live session after socket close', err);
    }
    liveSession = null;
  });
});
