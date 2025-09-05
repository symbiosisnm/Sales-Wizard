require('dotenv').config();
require("../src/utils/logger");
const express = require('express');
const { GoogleGenAI, Modality } = require('@google/genai');
const { WebSocketServer } = require('ws');

const app = express();
app.use(express.json());
const genai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });

// In-memory whitelist of allowed resource domains/documents
const whitelist = new Set(
  (process.env.WHITELIST || '')
    .split(',')
    .map(d => d.trim())
    .filter(Boolean)
);

// Middleware to validate requested resources against the whitelist
function validateResources(req, res, next) {
  const resources = Array.isArray(req.body?.resources) ? req.body.resources : [];
  const invalid = [];

  for (const urlStr of resources) {
    try {
      const url = new URL(urlStr);
      const allowed = Array.from(whitelist).some(domain =>
        url.hostname === domain || url.hostname.endsWith(`.${domain}`)
      );
      if (!allowed) invalid.push(urlStr);
    } catch (_e) {
      // Malformed URLs are considered invalid
      invalid.push(urlStr);
    }
  }

  if (invalid.length > 0) {
    return res.status(400).json({ error: 'Resource not permitted', invalid });
  }
  next();
}

// Whitelist management endpoints
app.get('/context/whitelist', (_req, res) => {
  res.json({ whitelist: Array.from(whitelist) });
});

app.post('/context/whitelist', (req, res) => {
  const { whitelist: list } = req.body || {};
  if (!Array.isArray(list)) {
    return res.status(400).json({ error: 'Whitelist must be an array of domains' });
  }
  whitelist.clear();
  for (const item of list) {
    if (typeof item === 'string' && item.trim()) {
      whitelist.add(item.trim());
    }
  }
  res.json({ whitelist: Array.from(whitelist) });
});

app.post('/ask', validateResources, async (req, res) => {
  const prompt = req.body.prompt || '';
  try {
    const model = genai.getGenerativeModel({ model: 'gemini-pro' });
    const result = await model.generateContent([{ role: 'user', parts: [{ text: prompt }] }]);
    const reply = result?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
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
    config: { response_modalities: [Modality.TEXT], system_instruction: 'You are a helpful assistant.' }
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
