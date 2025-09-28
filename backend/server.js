require('dotenv').config();
require("../src/utils/logger");
const express = require('express');
const { GoogleGenAI, Modality } = require('@google/genai');
const { WebSocketServer } = require('ws');
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
wss.on('connection', ws => {
  let session = null;
  let sessionReady = false;
  let pendingActions = [];
  let currentInstruction = buildSystemInstruction();

  const sendJson = payload => {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify(payload));
    }
  };

  const sendStatus = message => sendJson({ type: 'status', msg: message });
  const sendError = (error, context = 'gemini-live') => {
    logger.error(`[${context}]`, error);
    sendJson({ type: 'error', msg: error?.message || String(error) });
  };

  const flushQueue = () => {
    if (!sessionReady) return;
    const tasks = pendingActions;
    pendingActions = [];
    for (const task of tasks) {
      try {
        task();
      } catch (err) {
        sendError(err, 'flushQueue');
      }
    }
  };

  const queueOrRun = action => {
    if (sessionReady) {
      try {
        action();
      } catch (err) {
        sendError(err, 'queueOrRun');
      }
    } else {
      pendingActions.push(action);
    }
  };

  const resolveModalities = list => {
    if (!Array.isArray(list) || !list.length) return [Modality.TEXT];
    return list
      .map(mod => String(mod || '').toUpperCase())
      .map(mod => {
        if (mod === 'AUDIO') return Modality.AUDIO;
        if (mod === 'VIDEO' || mod === 'IMAGE') return Modality.VIDEO;
        return Modality.TEXT;
      });
  };

  const ensureSession = async ({ instructionOverride, responseModalities } = {}) => {
    if (session) return;

    if (instructionOverride && typeof instructionOverride === 'string') {
      const trimmed = instructionOverride.trim();
      if (trimmed) {
        currentInstruction = currentInstruction
          ? `${currentInstruction}\n${trimmed}`
          : trimmed;
      }
    }

    const config = {
      responseModalities: resolveModalities(responseModalities),
    };

    if (currentInstruction) {
      config.systemInstruction = {
        role: 'system',
        parts: [{ text: currentInstruction }],
      };
    }

    try {
      session = await genai.live.connect({
        model: process.env.GEMINI_LIVE_MODEL || 'gemini-live-2.5-flash-preview',
        config,
        callbacks: {
          onopen: () => {
            sessionReady = true;
            sendStatus('Gemini live session ready');
            flushQueue();
          },
          onmessage: message => {
            try {
              if (message.setupComplete) {
                sendStatus('Gemini session setup complete');
              }

              if (message.text) {
                sendJson({ type: 'model_text', text: message.text });
              }

              const parts = message?.serverContent?.modelTurn?.parts || [];
              for (const part of parts) {
                const inline = part.inlineData;
                if (inline?.mimeType?.startsWith('audio/') && inline.data) {
                  sendJson({ type: 'model_audio', data: inline.data, mime: inline.mimeType });
                }
              }

              if (message.usageMetadata) {
                sendJson({ type: 'usage', metadata: message.usageMetadata });
              }
            } catch (err) {
              sendError(err, 'onmessage');
            }
          },
          onerror: event => {
            const err = event?.error || new Error(event?.message || 'Gemini live error');
            sendError(err, 'onerror');
          },
          onclose: () => {
            sessionReady = false;
            sendStatus('Gemini live session closed');
          },
        },
      });
    } catch (err) {
      sendError(err, 'ensureSession');
      throw err;
    }
  };

  const handleText = text => {
    if (!text) return;
    queueOrRun(() => {
      session.sendClientContent({
        turns: [
          {
            role: 'user',
            parts: [{ text }],
          },
        ],
        turnComplete: true,
      });
    });
  };

  const handleAudio = payload => {
    if (!payload?.data) return;
    const mimeType = payload.mime || payload.mimeType || 'audio/pcm;rate=16000';
    queueOrRun(() => {
      session.sendRealtimeInput({
        audio: {
          data: payload.data,
          mimeType,
        },
      });
    });
  };

  const handleImage = payload => {
    if (!payload?.data) return;
    const mimeType = payload.mime || payload.mimeType || 'image/jpeg';
    queueOrRun(() => {
      session.sendRealtimeInput({
        video: {
          data: payload.data,
          mimeType,
        },
      });
    });
  };

  ws.on('message', async raw => {
    let data;
    try {
      data = JSON.parse(raw);
    } catch (err) {
      sendError(err, 'parse');
      return;
    }

    const { type } = data || {};

    try {
      switch (type) {
        case 'start':
          await ensureSession({
            instructionOverride: data.systemInstruction,
            responseModalities: data.responseModalities,
          });
          sendStatus('Start command acknowledged');
          break;
        case 'text':
          await ensureSession();
          handleText(data.text);
          break;
        case 'audio':
          await ensureSession();
          handleAudio(data);
          break;
        case 'image':
          await ensureSession();
          handleImage(data);
          break;
        case 'end':
          if (session) {
            session.close();
            session = null;
            sessionReady = false;
          }
          break;
        default:
          logger.warn('Unhandled live message type:', type);
      }
    } catch (err) {
      sendError(err, 'message-handler');
    }
  });

  ws.on('close', () => {
    pendingActions = [];
    if (session) {
      try {
        session.close();
      } catch (err) {
        sendError(err, 'close');
      }
      session = null;
      sessionReady = false;
    }
  });

  ws.on('error', err => {
    sendError(err, 'ws');
  });
});
