const test = require('node:test');
const assert = require('node:assert/strict');
const WebSocket = require('ws');
const { createBackend } = require('../server');

const AUTH_TOKEN = 'test-secret-token';
const ALLOWED_ORIGIN = 'http://allowed.test';

process.env.AUTH_TOKEN = AUTH_TOKEN;
process.env.ALLOWED_ORIGINS = ALLOWED_ORIGIN;
process.env.PORT = 0;

function createMockGenai({ replyText = 'Mock reply', responses = [{ text: 'streamed response' }] } = {}) {
  const session = {
    sentInputs: [],
    closed: false,
    async *receive() {
      for (const response of responses) {
        await new Promise(resolve => setImmediate(resolve));
        yield response;
      }
    },
    async send_realtime_input(payload) {
      this.sentInputs.push(payload);
      return { ok: true };
    },
    async close() {
      this.closed = true;
    },
  };

  return {
    session,
    genai: {
      getGenerativeModel() {
        return {
          async generateContent() {
            return {
              candidates: [
                {
                  content: {
                    parts: [{ text: replyText }],
                  },
                },
              ],
            };
          },
        };
      },
      live: {
        async connect() {
          return session;
        },
      },
    },
  };
}

async function createServer(t, options = {}) {
  const { genai, session } = createMockGenai(options);
  const backend = createBackend({ genaiClient: genai, logger: console, port: 0 });
  const server = backend.app.listen(0);
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : address;
  const baseUrl = `http://127.0.0.1:${port}`;
  const wss = backend.attachLiveWebSocket(server);

  t.after(() => new Promise(resolve => wss.close(resolve)));
  t.after(() => new Promise(resolve => server.close(resolve)));

  return { baseUrl, port, session };
}

test('allows POST /ask with valid credentials', async t => {
  const { baseUrl } = await createServer(t, { replyText: 'Authorized reply' });

  const response = await fetch(`${baseUrl}/ask`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      AUTH_TOKEN,
      Origin: ALLOWED_ORIGIN,
    },
    body: JSON.stringify({ prompt: 'hello' }),
  });

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.deepEqual(payload, { reply: 'Authorized reply' });
});

test('rejects POST /ask without an auth token', async t => {
  const { baseUrl } = await createServer(t);

  const response = await fetch(`${baseUrl}/ask`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: ALLOWED_ORIGIN,
    },
    body: JSON.stringify({ prompt: 'hello' }),
  });

  assert.equal(response.status, 401);
  const payload = await response.json();
  assert.equal(payload.error, 'Unauthorized');
});

test('rejects history requests with an invalid token', async t => {
  const { baseUrl } = await createServer(t);

  const response = await fetch(`${baseUrl}/history`, {
    method: 'GET',
    headers: {
      AUTH_TOKEN: 'wrong-token',
      Origin: ALLOWED_ORIGIN,
    },
  });

  assert.equal(response.status, 401);
  const payload = await response.json();
  assert.equal(payload.error, 'Unauthorized');
});

test('rejects requests from disallowed origins before auth', async t => {
  const { baseUrl } = await createServer(t);

  const response = await fetch(`${baseUrl}/ask`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      AUTH_TOKEN,
      Origin: 'http://blocked.test',
    },
    body: JSON.stringify({ prompt: 'hello' }),
  });

  assert.equal(response.status, 403);
  const payload = await response.json();
  assert.equal(payload.error, 'Origin not allowed');
});

test('allows websocket connections with valid credentials', async t => {
  const { port, session } = await createServer(t, {
    responses: [{ text: 'streamed response' }],
  });

  const ws = new WebSocket(`ws://127.0.0.1:${port}/live`, {
    headers: {
      AUTH_TOKEN,
      Origin: ALLOWED_ORIGIN,
    },
  });

  t.after(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.terminate();
    }
  });

  await new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });

  const incoming = new Promise(resolve => {
    ws.once('message', data => resolve(data.toString()));
  });

  const audioPayload = Buffer.from('abc');
  ws.send(
    JSON.stringify({
      audio: audioPayload.toString('base64'),
      mimeType: 'audio/test',
    }),
  );

  const message = await incoming;
  assert.deepEqual(JSON.parse(message), { text: 'streamed response' });

  assert.equal(session.sentInputs.length, 1);
  assert.deepEqual(session.sentInputs[0], {
    audio: { data: audioPayload, mime_type: 'audio/test' },
  });

  ws.close();
  await new Promise(resolve => ws.once('close', resolve));
  assert.equal(session.closed, true);
});
