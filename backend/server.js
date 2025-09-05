require('dotenv').config();
require("../src/utils/logger");
const express = require('express');
const { GoogleGenAI, Modality } = require('@google/genai');
const { WebSocketServer } = require('ws');

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

const server = app.listen(process.env.PORT || 3001);

// WebSocket endpoint for Gemini Live
const wss = new WebSocketServer({ server, path: '/live' });
wss.on('connection', async (ws) => {
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
      await session.send_realtime_input({ audio: { data: buf, mime_type: data.mimeType || 'audio/pcm;rate=16000' } });
    } else if (data.image) {
      const buf = Buffer.from(data.image, 'base64');
      await session.send_realtime_input({ image: { data: buf, mime_type: data.mimeType || 'image/jpeg' } });
    }
  });

  ws.on('close', () => session.close());
});
