require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { GoogleGenAI, Modality } = require('@google/genai');
const { WebSocketServer } = require('ws');

const app = express();
app.use(express.json());

// Configure CORS with allowed origins list
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
        cb(null, true);
      } else {
        cb(new Error('Not allowed by CORS'));
      }
    },
  })
);

const genai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });

// Optional auth middleware
function checkAuth(req, res, next) {
  const expected = process.env.AUTH_TOKEN;
  if (!expected) return next();
  const token = req.headers['x-auth-token'];
  if (!token) {
    return res.status(401).json({ error: 'Auth token required' });
  }
  if (token !== expected) {
    return res.status(403).json({ error: 'Invalid auth token' });
  }
  next();
}

app.post('/ask', checkAuth, async (req, res) => {
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

function startServer(port = process.env.PORT || 3001) {
  const server = app.listen(port);

  // WebSocket endpoint for Gemini Live
  const wss = new WebSocketServer({
    server,
    path: '/live',
    verifyClient: (info, done) => {
      if (allowedOrigins.length && info.origin && !allowedOrigins.includes(info.origin)) {
        return done(false, 403, 'Origin not allowed');
      }
      const expected = process.env.AUTH_TOKEN;
      if (!expected) return done(true);
      const token = info.req.headers['x-auth-token'];
      if (!token) return done(false, 401, 'Auth token required');
      if (token !== expected) return done(false, 403, 'Invalid auth token');
      return done(true);
    },
  });

  wss.on('connection', async (ws) => {
    const session = await genai.live.connect({
      model: 'gemini-live-2.5-flash-preview',
      config: {
        response_modalities: [Modality.TEXT],
        system_instruction: 'You are a helpful assistant.',
      },
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
          audio: { data: buf, mime_type: data.mimeType || 'audio/pcm;rate=16000' },
        });
      } else if (data.image) {
        const buf = Buffer.from(data.image, 'base64');
        await session.send_realtime_input({
          image: { data: buf, mime_type: data.mimeType || 'image/jpeg' },
        });
      }
    });

    ws.on('close', () => session.close());
  });

  return server;
}

if (require.main === module) {
  startServer();
}

module.exports = { app, startServer };
