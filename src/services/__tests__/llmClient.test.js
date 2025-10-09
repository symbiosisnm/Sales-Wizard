const { test, before, after } = require('node:test');
const assert = require('node:assert');

class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances = [];

  constructor(url) {
    this.url = url;
    this.readyState = FakeWebSocket.CONNECTING;
    this.sent = [];
    FakeWebSocket.instances.push(this);
    setImmediate(() => {
      if (this.readyState === FakeWebSocket.CONNECTING) {
        this.readyState = FakeWebSocket.OPEN;
        this.onopen?.();
      }
    });
  }

  send(payload) {
    this.sent.push(JSON.parse(payload));
  }

  close() {
    if (this.readyState === FakeWebSocket.CLOSED) return;
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.({ code: 1000, reason: 'client close' });
  }

  static latest() {
    return FakeWebSocket.instances.at(-1) || null;
  }

  static reset() {
    FakeWebSocket.instances = [];
  }
}

before(() => {
  FakeWebSocket.reset();
  global.WebSocket = FakeWebSocket;
});

after(() => {
  delete global.WebSocket;
  FakeWebSocket.reset();
});

test('LLMClient sends start handshake on connect', async () => {
  FakeWebSocket.reset();
  const { LLMClient } = await import('../../services/llmClient.js');
  const client = new LLMClient({ url: 'ws://example.test' });
  const statuses = [];
  client.onStatus = (msg) => statuses.push(msg);

  await client.connect({ model: 'custom-model', responseModalities: ['TEXT'], systemInstruction: 'sys' });
  const ws = FakeWebSocket.latest();

  assert.ok(ws, 'websocket created');
  assert.deepStrictEqual(ws.sent[0], {
    type: 'start',
    model: 'custom-model',
    responseModalities: ['TEXT'],
    systemInstruction: 'sys',
  });
  assert.ok(statuses.includes('WS open'));
});

test('LLMClient routes inbound messages to callbacks', async () => {
  FakeWebSocket.reset();
  const { LLMClient } = await import('../../services/llmClient.js');
  const client = new LLMClient({ url: 'ws://example.test' });

  const statuses = [];
  const texts = [];
  const audios = [];
  const errors = [];

  client.onStatus = (msg, payload) => statuses.push({ msg, payload });
  client.onText = (text) => texts.push(text);
  client.onAudio = (data, mime) => audios.push({ data, mime });
  client.onError = (msg) => errors.push(msg);

  await client.connect();
  const ws = FakeWebSocket.latest();
  assert.ok(ws);

  ws.onmessage?.({ data: JSON.stringify({ type: 'status', message: 'connected', terminal: false }) });
  ws.onmessage?.({ data: JSON.stringify({ type: 'model_text', text: 'hello' }) });
  ws.onmessage?.({ data: JSON.stringify({ type: 'model_audio', data: 'Zg==', mime: 'audio/wav' }) });
  ws.onmessage?.({ data: JSON.stringify({ type: 'error', message: 'fail' }) });

  const relevantStatuses = statuses.filter(({ msg }) => msg !== 'WS open');
  assert.deepStrictEqual(relevantStatuses, [
    { msg: 'connected', payload: { type: 'status', message: 'connected', terminal: false } },
  ]);
  assert.deepStrictEqual(texts, ['hello']);
  assert.deepStrictEqual(audios, [{ data: 'Zg==', mime: 'audio/wav' }]);
  assert.deepStrictEqual(errors, ['fail']);
});

test('LLMClient end sends termination control message', async () => {
  FakeWebSocket.reset();
  const { LLMClient } = await import('../../services/llmClient.js');
  const client = new LLMClient({ url: 'ws://example.test' });

  await client.connect();
  const ws = FakeWebSocket.latest();
  assert.ok(ws);

  client.end();
  assert.deepStrictEqual(ws.sent.at(-1), { type: 'end' });
  assert.strictEqual(ws.readyState, FakeWebSocket.CLOSED);
});

