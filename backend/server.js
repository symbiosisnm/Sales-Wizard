require('dotenv').config();
const express = require('express');
const { GoogleGenAI, Modality } = require('@google/genai');
const { WebSocketServer } = require('ws');

const app = express();
app.use(express.json());
const genai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });

app.post('/ask', async (req, res) => {
  const prompt = req.body.prompt || '';
  try {
    const model = genai.getGenerativeModel({ model: 'gemini-pro' });
    const result = await model.generateContent([{ role: 'user', parts: [{ text: prompt }] }]);
    const reply = result?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
    res.json({ reply });
  } catch (err) {
    console.error('Error:', err);
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

module.exports = { app, server, wss };
