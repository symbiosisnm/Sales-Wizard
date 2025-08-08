const test = require('node:test');
const assert = require('node:assert');
const { createServer } = require('http');
const { once } = require('events');
const WebSocket = require('ws');
const { attachLiveGateway } = require('../attachLiveGateway.js');

function waitFor(condition, timeout = 1000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    (function check() {
      if (condition()) return resolve();
      if (Date.now() - start > timeout) return reject(new Error('timeout'));
      setTimeout(check, 10);
    })();
  });
}

test('live gateway message flow', async () => {
  const httpServer = createServer();
  attachLiveGateway(httpServer);
  await new Promise((resolve) => httpServer.listen(0, resolve));
  const port = httpServer.address().port;

  const ws = new WebSocket(`ws://localhost:${port}/live`);
  const messages = [];
  ws.on('message', (data) => messages.push(JSON.parse(data)));
  await once(ws, 'open');

  ws.send(JSON.stringify({ type: 'start', apiKey: 'mock' }));
  await waitFor(() => messages.length >= 2);
  assert.deepStrictEqual(messages[0], { type: 'status', status: 'ok' });
  assert.deepStrictEqual(messages[1], { type: 'model', model: 'mock-gemini' });

  ws.send(JSON.stringify({ type: 'input_text', text: 'hello' }));
  await waitFor(() => messages.length >= 3);
  assert.deepStrictEqual(messages[2], { type: 'text', text: 'hello' });

  ws.send(JSON.stringify({ type: 'input_audio_buffer', data: 'audio' }));
  await waitFor(() => messages.length >= 4);
  assert.deepStrictEqual(messages[3], { type: 'audio', data: 'audio' });

  ws.send(JSON.stringify({ type: 'input_image', data: 'image' }));
  await waitFor(() => messages.length >= 5);
  assert.deepStrictEqual(messages[4], { type: 'image', data: 'image' });

  ws.send(JSON.stringify({ type: 'end' }));
  await once(ws, 'close');
  httpServer.close();
  await once(httpServer, 'close');
});
