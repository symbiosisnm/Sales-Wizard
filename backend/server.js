require('dotenv').config();
require('../src/utils/logger');

const express = require('express');
const { WebSocketServer, WebSocket } = require('ws');
const historyStore = require('./historyStore');

const app = express();
app.use(express.json());

const DEFAULT_TEXT_MODEL = process.env.OPENAI_TEXT_MODEL || 'gpt-5.4-mini';
const DEFAULT_REALTIME_MODEL = process.env.OPENAI_REALTIME_MODEL || 'gpt-realtime-2';
const DEFAULT_TRANSCRIPTION_MODEL =
  process.env.OPENAI_TRANSCRIPTION_MODEL || 'gpt-4o-mini-transcribe';
const DEFAULT_VOICE = process.env.OPENAI_VOICE || 'marin';
const RESPONSES_URL = 'https://api.openai.com/v1/responses';
const REALTIME_URL = 'wss://api.openai.com/v1/realtime';

// In-memory state for conversation history and context parameters
const state = {
  history: [],
  contextParams: {
    allowedSources: '',
    toneLength: '',
    disallowedTopics: '',
  },
};

function buildSystemInstruction() {
  const parts = ['You are a helpful assistant.'];
  const { allowedSources, toneLength, disallowedTopics } = state.contextParams;
  if (allowedSources) parts.push(`Limit knowledge retrieval to: ${allowedSources}.`);
  if (toneLength) parts.push(`Maintain tone/length constraints: ${toneLength}.`);
  if (disallowedTopics) parts.push(`Avoid the following topics: ${disallowedTopics}.`);
  return parts.join(' ');
}

function resolveApiKey(...candidates) {
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
  }
  return process.env.OPENAI_API_KEY || '';
}

function extractResponseText(payload) {
  if (typeof payload?.output_text === 'string') {
    return payload.output_text.trim();
  }

  const outputs = Array.isArray(payload?.output) ? payload.output : [];
  for (const item of outputs) {
    const contents = Array.isArray(item?.content) ? item.content : [];
    for (const content of contents) {
      if (typeof content?.text === 'string' && content.text.trim()) {
        return content.text.trim();
      }
    }
  }

  return '';
}

function buildRealtimeSessionConfig(instructions, outputModalities = ['text']) {
  return {
    type: 'realtime',
    instructions,
    output_modalities: outputModalities,
    max_output_tokens: 1024,
    audio: {
      input: {
        format: {
          type: 'audio/pcm',
          rate: 24000,
        },
        noise_reduction: { type: 'near_field' },
        transcription: {
          model: DEFAULT_TRANSCRIPTION_MODEL,
          language: 'en',
        },
        turn_detection: {
          type: 'server_vad',
          create_response: true,
          interrupt_response: true,
          silence_duration_ms: 250,
        },
      },
      output: {
        format: {
          type: 'audio/pcm',
          rate: 24000,
        },
        voice: DEFAULT_VOICE,
      },
    },
  };
}

app.get('/context-params', (_req, res) => {
  res.json(state.contextParams);
});

app.put('/context-params', (req, res) => {
  state.contextParams = { ...state.contextParams, ...req.body };
  res.json({ success: true, data: state.contextParams });
});

app.post('/ask', async (req, res) => {
  const prompt = String(req.body?.prompt || '').trim();
  const apiKey = resolveApiKey(req.body?.apiKey, req.get('x-openai-api-key'));

  if (!apiKey) {
    return res.status(400).json({ error: 'Missing OpenAI API key' });
  }
  if (!prompt) {
    return res.status(400).json({ error: 'Prompt is required' });
  }

  try {
    const response = await fetch(RESPONSES_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: DEFAULT_TEXT_MODEL,
        instructions: buildSystemInstruction(),
        input: prompt,
      }),
    });
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload?.error?.message || 'Generation failed');
    }

    const reply = extractResponseText(payload);
    state.history.push({ prompt, reply });
    res.json({ reply });
  } catch (err) {
    logger.error('Error generating OpenAI response:', err);
    res.status(500).json({ error: err.message || 'Generation failed' });
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

app.delete('/history', (_req, res) => {
  try {
    historyStore.clearHistory();
    res.json({ ok: true });
  } catch (err) {
    logger.error('Error clearing history:', err);
    res.status(500).json({ error: 'Failed to clear history' });
  }
});

app.get('/history', (_req, res) => {
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

const wss = new WebSocketServer({ server, path: '/live' });
wss.on('connection', ws => {
  let upstream = null;
  let upstreamReady = false;
  let pendingActions = [];
  let currentInstruction = buildSystemInstruction();
  let currentApiKey = '';
  let currentModel = DEFAULT_REALTIME_MODEL;
  let latestImageItemId = null;
  const responseTextByItem = new Map();

  const sendJson = payload => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
    }
  };

  const sendStatus = message => sendJson({ type: 'status', msg: message });
  const sendError = (error, context = 'openai-realtime') => {
    logger.error(`[${context}]`, error);
    sendJson({ type: 'error', msg: error?.message || String(error) });
  };

  const flushQueue = () => {
    if (!upstreamReady || !upstream) return;
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
    if (upstreamReady && upstream) {
      try {
        action();
      } catch (err) {
        sendError(err, 'queueOrRun');
      }
    } else {
      pendingActions.push(action);
    }
  };

  const resolveOutputModalities = list => {
    if (!Array.isArray(list) || !list.length) return ['text'];
    const normalized = list.map(mod => String(mod || '').toLowerCase());
    return normalized.includes('audio') ? ['audio'] : ['text'];
  };

  const closeUpstream = () => {
    pendingActions = [];
    upstreamReady = false;
    responseTextByItem.clear();
    latestImageItemId = null;
    if (upstream) {
      try {
        upstream.close();
      } catch (err) {
        logger.warn('Error closing upstream OpenAI socket:', err);
      }
      upstream = null;
    }
  };

  const sendUpstream = event => {
    queueOrRun(() => {
      if (upstream?.readyState === WebSocket.OPEN) {
        upstream.send(JSON.stringify(event));
      }
    });
  };

  const ensureSession = async ({ instructionOverride, responseModalities, apiKey, model } = {}) => {
    if (upstream) return;

    currentApiKey = resolveApiKey(apiKey);
    if (!currentApiKey) {
      throw new Error('Missing OpenAI API key');
    }
    if (typeof model === 'string' && model.trim()) {
      currentModel = model.trim();
    }
    if (instructionOverride && typeof instructionOverride === 'string') {
      const trimmed = instructionOverride.trim();
      if (trimmed) {
        currentInstruction = currentInstruction
          ? `${currentInstruction}\n${trimmed}`
          : trimmed;
      }
    }

    const sessionConfig = buildRealtimeSessionConfig(
      currentInstruction,
      resolveOutputModalities(responseModalities)
    );
    const url = `${REALTIME_URL}?model=${encodeURIComponent(currentModel)}`;

    await new Promise((resolve, reject) => {
      let settled = false;
      upstream = new WebSocket(url, {
        headers: {
          Authorization: `Bearer ${currentApiKey}`,
        },
      });

      upstream.on('open', () => {
        upstream.send(JSON.stringify({ type: 'session.update', session: sessionConfig }));
        if (!settled) {
          settled = true;
          resolve();
        }
      });

      upstream.on('message', raw => {
        let event;
        try {
          event = JSON.parse(raw.toString());
        } catch (err) {
          sendError(err, 'upstream-parse');
          return;
        }

        try {
          switch (event.type) {
            case 'session.created':
              sendStatus('OpenAI Realtime session created');
              break;
            case 'session.updated':
              upstreamReady = true;
              sendStatus('OpenAI Realtime ready');
              flushQueue();
              break;
            case 'input_audio_buffer.speech_started':
              sendStatus('Listening...');
              break;
            case 'input_audio_buffer.speech_stopped':
              sendStatus('Processing...');
              break;
            case 'conversation.item.input_audio_transcription.completed':
              if (event.transcript) {
                sendJson({
                  type: 'user_transcript',
                  transcript: event.transcript,
                  itemId: event.item_id,
                });
              }
              break;
            case 'response.created':
              sendStatus('Responding...');
              break;
            case 'response.output_text.delta': {
              const key = `${event.item_id}:${event.content_index}`;
              const nextText = `${responseTextByItem.get(key) || ''}${event.delta || ''}`;
              responseTextByItem.set(key, nextText);
              sendJson({ type: 'model_text', text: nextText });
              break;
            }
            case 'response.output_text.done': {
              const key = `${event.item_id}:${event.content_index}`;
              const text = event.text || responseTextByItem.get(key) || '';
              responseTextByItem.set(key, text);
              sendJson({ type: 'model_text', text, final: true });
              break;
            }
            case 'response.output_audio.delta':
              sendJson({ type: 'model_audio', data: event.delta, mime: 'audio/pcm;rate=24000' });
              break;
            case 'response.done':
              sendStatus('Ready');
              break;
            case 'rate_limits.updated':
              sendJson({ type: 'usage', metadata: event.rate_limits });
              break;
            case 'error':
              sendError(new Error(event?.error?.message || 'OpenAI Realtime error'), 'upstream-event');
              break;
            default:
              break;
          }
        } catch (err) {
          sendError(err, 'upstream-message');
        }
      });

      upstream.on('error', err => {
        sendError(err, 'upstream-socket');
        if (!settled) {
          settled = true;
          reject(err);
        }
      });

      upstream.on('close', () => {
        const wasReady = upstreamReady;
        upstreamReady = false;
        upstream = null;
        responseTextByItem.clear();
        latestImageItemId = null;
        if (ws.readyState === WebSocket.OPEN) {
          sendStatus(wasReady ? 'OpenAI Realtime session closed' : 'OpenAI Realtime connection closed');
        }
        if (!settled) {
          settled = true;
          reject(new Error('OpenAI Realtime connection closed before ready'));
        }
      });
    });
  };

  const handleText = text => {
    const trimmed = String(text || '').trim();
    if (!trimmed) return;

    sendUpstream({
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: trimmed,
          },
        ],
      },
    });

    sendUpstream({
      type: 'response.create',
      response: {
        output_modalities: ['text'],
      },
    });
  };

  const handleAudio = payload => {
    if (!payload?.data) return;
    sendUpstream({
      type: 'input_audio_buffer.append',
      audio: payload.data,
    });
  };

  const handleImage = payload => {
    if (!payload?.data) return;
    const mimeType = payload.mime || payload.mimeType || 'image/jpeg';
    const nextItemId = `screen_${Date.now()}`;

    if (latestImageItemId) {
      sendUpstream({
        type: 'conversation.item.delete',
        item_id: latestImageItemId,
      });
    }

    latestImageItemId = nextItemId;
    sendUpstream({
      type: 'conversation.item.create',
      item: {
        id: nextItemId,
        type: 'message',
        role: 'user',
        content: [
          {
            type: 'input_image',
            detail: 'low',
            image_url: `data:${mimeType};base64,${payload.data}`,
          },
        ],
      },
    });
  };

  ws.on('message', async raw => {
    let data;
    try {
      data = JSON.parse(raw.toString());
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
            apiKey: data.apiKey,
            model: data.model,
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
          closeUpstream();
          break;
        default:
          logger.warn('Unhandled live message type:', type);
      }
    } catch (err) {
      sendError(err, 'message-handler');
    }
  });

  ws.on('close', () => {
    closeUpstream();
  });

  ws.on('error', err => {
    sendError(err, 'ws');
  });
});
