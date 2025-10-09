const test = require('node:test');
const assert = require('node:assert');

process.env.AUTH_TOKEN = 'test-secret-token';
process.env.ALLOWED_ORIGINS = 'http://allowed.test';
process.env.PORT = 0;

const { startServer } = require('../server');

async function createServer(t) {
  const { server, wss } = startServer({ port: 0 });
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  t.after(async () => {
    await new Promise(resolve => wss.close(resolve));
    await new Promise(resolve => server.close(resolve));
  });

  return { baseUrl };
}

test('rejects POST /ask without an auth token', async (t) => {
  const { baseUrl } = await createServer(t);
  const response = await fetch(`${baseUrl}/ask`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'http://allowed.test'
    },
    body: JSON.stringify({ prompt: 'hello' })
  });

  assert.strictEqual(response.status, 401);
  const payload = await response.json();
  assert.strictEqual(payload.error, 'Unauthorized');
});

test('rejects history requests with an invalid token', async (t) => {
  const { baseUrl } = await createServer(t);
  const response = await fetch(`${baseUrl}/history`, {
    method: 'GET',
    headers: {
      AUTH_TOKEN: 'wrong-token',
      Origin: 'http://allowed.test'
    }
  });

  assert.strictEqual(response.status, 401);
  const payload = await response.json();
  assert.strictEqual(payload.error, 'Unauthorized');
});

test('rejects requests from disallowed origins before auth', async (t) => {
  const { baseUrl } = await createServer(t);
  const response = await fetch(`${baseUrl}/ask`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      AUTH_TOKEN: 'test-secret-token',
      Origin: 'http://blocked.test'
    },
    body: JSON.stringify({ prompt: 'hello' })
  });

  assert.strictEqual(response.status, 403);
  const payload = await response.json();
  assert.strictEqual(payload.error, 'Origin not allowed');
});
