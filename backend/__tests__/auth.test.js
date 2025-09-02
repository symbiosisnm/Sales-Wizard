const test = require('node:test');
const assert = require('node:assert');
const WebSocket = require('ws');
const { startServer } = require('../server');

test('ask endpoint enforces auth token', async (t) => {
  process.env.AUTH_TOKEN = 'secret';
  const server = startServer(0);
  const port = server.address().port;

  await t.test('missing token returns 401', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/ask`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: 'hi' }),
    });
    assert.strictEqual(res.status, 401);
  });

  await t.test('bad token returns 403', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/ask`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-auth-token': 'wrong',
      },
      body: JSON.stringify({ prompt: 'hi' }),
    });
    assert.strictEqual(res.status, 403);
  });

  await new Promise((resolve) => server.close(resolve));
});

test('live websocket enforces auth token', async (t) => {
  process.env.AUTH_TOKEN = 'secret';
  const server = startServer(0);
  const port = server.address().port;

  await t.test('missing token denied with 401', async () => {
    await new Promise((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/live`);
      ws.on('open', () => {
        ws.terminate();
        assert.fail('should not open');
      });
      ws.on('error', (err) => {
        assert.match(err.message, /401/);
        resolve();
      });
    });
  });

  await t.test('bad token denied with 403', async () => {
    await new Promise((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/live`, {
        headers: { 'x-auth-token': 'wrong' },
      });
      ws.on('open', () => {
        ws.terminate();
        assert.fail('should not open');
      });
      ws.on('error', (err) => {
        assert.match(err.message, /403/);
        resolve();
      });
    });
  });

  await new Promise((resolve) => server.close(resolve));
});

