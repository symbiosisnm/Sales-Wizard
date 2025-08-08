import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import http from 'http';
import { WebSocketServer } from 'ws';
import { createLiveGateway } from './liveGateway.js';
import { textHandler } from './text.js';

const PORT = Number(process.env.PORT || 3001);
const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

app.get('/healthz', (_, res) => res.json({ ok: true }));

app.post('/ask', textHandler);

const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

wss.on('connection', (ws) => {
  const gateway = createLiveGateway(ws, {
    apiKey: process.env.GEMINI_API_KEY!,
    model: process.env.GEMINI_LIVE_MODEL || 'gemini-live-2.5-flash-preview',
    systemInstruction: process.env.SYSTEM_INSTRUCTION || 'You are a concise, helpful real-time assistant.'
  });

  ws.on('close', () => gateway.teardown().catch(() => {}));
});

server.on('upgrade', (req, socket, head) => {
  if (req.url?.startsWith('/live')) {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  } else {
    socket.destroy();
  }
});

server.listen(PORT, () => {
  console.log(`[backend] listening on :${PORT}`);
});
