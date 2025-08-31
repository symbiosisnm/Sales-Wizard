const { test, before, after } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const WebSocket = require('ws');
const { once } = require('events');
const Module = require('module');

let server;
let wss;
let session;
let port;

class FakeSession {
  constructor() {
    this.sent = [];
  }
  async send_realtime_input(data) {
    this.sent.push(data);
  }
  async *receive() {
    yield { text: 'ws reply' };
  }
  close() {}
}

before(() => {
  session = new FakeSession();
  const mockGenai = {
    GoogleGenAI: class {
      getGenerativeModel() {
        return {
          generateContent: async () => ({
            candidates: [
              { content: { parts: [{ text: 'hello from gemini' }] } }
            ]
          })
        };
      }
      get live() {
        return {
          connect: async () => session
        };
      }
    },
    Modality: { TEXT: 'text' }
  };
  const originalLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === '@google/genai') {
      return mockGenai;
    }
    return originalLoad(request, parent, isMain);
  };
  ({ server, wss } = require('../server'));
  Module._load = originalLoad;
  port = server.address().port;
});

after(() => {
  wss.close();
  server.close();
});

test('POST /ask responds with model reply', async () => {
  const res = await request(server).post('/ask').send({ prompt: 'hi' });
  assert.strictEqual(res.status, 200);
  assert.deepStrictEqual(res.body, { reply: 'hello from gemini' });
});

test('WebSocket /live forwards text and audio', async () => {
  const ws = new WebSocket(`ws://localhost:${port}/live`);
  const msgPromise = once(ws, 'message');
  await once(ws, 'open');
  const audioBase64 = Buffer.from('dummy').toString('base64');
  ws.send(JSON.stringify({ audio: audioBase64, mimeType: 'audio/pcm;rate=16000' }));
  const [msg] = await msgPromise;
  const data = JSON.parse(msg.toString());
  assert.strictEqual(data.text, 'ws reply');
  ws.close();
  await once(ws, 'close');
  assert.strictEqual(session.sent.length, 1);
  assert.ok(Buffer.isBuffer(session.sent[0].audio.data));
  assert.strictEqual(session.sent[0].audio.mime_type, 'audio/pcm;rate=16000');
});
