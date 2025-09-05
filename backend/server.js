require('dotenv').config();
require("../src/utils/logger");
const express = require('express');
const { GoogleGenAI, Modality } = require('@google/genai');
const { WebSocketServer } = require('ws');

const app = express();
app.use(express.json());
const genai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });

// In-memory stores for tests/demo
const sessions = {};
const contextParams = {};

// Conversation turn endpoints
app.post('/sessions/:sessionId/turns', (req, res) => {
  const { sessionId } = req.params;
  const { transcription = '', ai_response = '' } = req.body || {};
  sessions[sessionId] = sessions[sessionId] || [];
  sessions[sessionId].push({ transcription, ai_response });
  res.status(201).json({ ok: true });
});

app.get('/sessions/:sessionId/transcript', (req, res) => {
  const { sessionId } = req.params;
  res.json({ transcript: sessions[sessionId] || [] });
});

// Context parameter endpoints with source restrictions
app.put('/context/:name', (req, res) => {
  const { name } = req.params;
  const { value, source } = req.body || {};
  if (!value || !source) return res.status(400).json({ error: 'Missing fields' });
  const existing = contextParams[name];
  if (existing && existing.source !== source) {
    return res.status(403).json({ error: 'Source mismatch' });
  }
  contextParams[name] = { value, source };
  res.json(contextParams[name]);
});

app.get('/context/:name', (req, res) => {
  const param = contextParams[req.params.name];
  if (!param) return res.status(404).json({ error: 'Not found' });
  res.json(param);
});

// Ask endpoint remains for completeness
app.post('/ask', async (req, res) => {
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

function startServer(port = process.env.PORT || 3001) {
  const server = app.listen(port);
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
  return server;
}

if (require.main === module) {
  startServer();
}

module.exports = { app, sessions, contextParams, startServer };
