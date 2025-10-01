const { test, mock } = require('node:test');
const assert = require('node:assert');

// Stub WebSocket to avoid real network connections
const wsInstances = [];
global.WebSocket = class {
  constructor() {
    this.readyState = 1;
    this.sent = [];
    wsInstances.push(this);
    setImmediate(() => this.onopen && this.onopen());
  }
  send(payload) {
    this.sent.push(payload);
  }
  close() {
    this.readyState = 3;
    if (this.onclose) this.onclose();
  }
};
global.WebSocket.OPEN = 1;
global.WebSocket.CLOSING = 2;
global.WebSocket.CLOSED = 3;
global.WebSocket.instances = wsInstances;

// Use real startLiveStreaming with stubbed WebSocket
const { startLiveStreaming } = require('../liveStreamer');

// Helper to restore globals after each test
function restoreTimers(orig) {
  global.setInterval = orig.setInterval;
  global.clearInterval = orig.clearInterval;
}

test('screen track end stops interval and notifies status', async () => {
  global.logger = { warn: mock.fn(), error: mock.fn(), info: mock.fn() };

  const track = { stop: mock.fn(), onended: null };
  const screenStream = {
    getVideoTracks: () => [track],
    getTracks: () => [track],
  };

  global.navigator = {
    mediaDevices: {
      getUserMedia: mock.fn(async () => { throw new Error('no audio'); }),
      getDisplayMedia: mock.fn(async () => screenStream),
    },
  };

  global.ImageCapture = class {
    constructor() {}
    takePhoto() { return Promise.reject(new Error('no photo')); }
  };

  const onStatus = mock.fn();
  const onError = mock.fn();

  const origTimers = { setInterval, clearInterval };
  const clearIntervalMock = mock.fn();
  const setIntervalMock = mock.fn(() => 123);
  global.setInterval = setIntervalMock;
  global.clearInterval = clearIntervalMock;

  const stopFn = await startLiveStreaming({ onResponse: () => {}, onStatus, onError });

  assert.ok(track.onended, 'track.onended attached');

  // Simulate user stopping share
  track.onended();

  assert.strictEqual(clearIntervalMock.mock.callCount(), 1);
  assert.deepStrictEqual(clearIntervalMock.mock.calls[0].arguments, [123]);
  assert.deepStrictEqual(onStatus.mock.calls.at(-1).arguments, ['Screen capture ended']);

  // Calling returned cleanup should not throw and should not double clear interval
  stopFn();
  assert.strictEqual(clearIntervalMock.mock.callCount(), 1);
  assert.deepStrictEqual(onStatus.mock.calls.at(-1).arguments, ['Screen capture ended']);

  restoreTimers(origTimers);
});

test('getDisplayMedia denial triggers onError', async () => {
  global.logger = { warn: mock.fn(), error: mock.fn(), info: mock.fn() };
  const err = new Error('Permission denied');
  err.name = 'NotAllowedError';
  global.navigator = {
    mediaDevices: {
      getUserMedia: mock.fn(async () => { throw new Error('no audio'); }),
      getDisplayMedia: mock.fn(async () => { throw err; }),
    },
  };

  const onStatus = mock.fn();
  const onError = mock.fn();

  const origTimers = { setInterval, clearInterval };
  global.setInterval = mock.fn();
  global.clearInterval = mock.fn();

  await startLiveStreaming({ onResponse: () => {}, onStatus, onError });

  assert.ok(onError.mock.callCount() >= 1);
  assert.match(onError.mock.calls[0].arguments[0], /blocked or denied/);
  assert.ok(onStatus.mock.callCount() >= 1);
  assert.deepStrictEqual(onStatus.mock.calls.at(-1).arguments, ['Screen capture ended']);

  restoreTimers(origTimers);
});

test('LLMClient routes structured messages correctly', async () => {
  global.WebSocket.instances.length = 0;

  const { LLMClient } = require('../../services/llmClient');

  const client = new LLMClient({ url: 'ws://example.test/live' });
  const statuses = [];
  const texts = [];
  const audios = [];
  const errors = [];

  client.onStatus = (msg) => statuses.push(msg);
  client.onText = (txt) => texts.push(txt);
  client.onAudio = (data, mime) => audios.push({ data, mime });
  client.onError = (msg) => errors.push(msg);

  await client.connect({ model: 'model-id', responseModalities: ['TEXT'], systemInstruction: 'extra context' });

  const ws = global.WebSocket.instances.at(-1);
  assert.ok(ws, 'WebSocket created');

  const startPayload = JSON.parse(ws.sent[0]);
  assert.deepStrictEqual(startPayload, {
    type: 'start',
    model: 'model-id',
    responseModalities: ['TEXT'],
    systemInstruction: 'extra context',
  });

  client.sendText('Hello world');
  client.sendPcm16Base64('QUJD', 'audio/pcm;rate=16000');
  client.sendJpegBase64('R0hJ', 'image/jpeg');

  assert.deepStrictEqual(JSON.parse(ws.sent[1]), { type: 'text', text: 'Hello world' });
  assert.deepStrictEqual(JSON.parse(ws.sent[2]), {
    type: 'audio',
    data: 'QUJD',
    mime: 'audio/pcm;rate=16000',
  });
  assert.deepStrictEqual(JSON.parse(ws.sent[3]), {
    type: 'image',
    data: 'R0hJ',
    mime: 'image/jpeg',
  });

  ws.onmessage({ data: JSON.stringify({ type: 'status', msg: 'ready' }) });
  ws.onmessage({ data: JSON.stringify({ type: 'model_text', text: 'response text' }) });
  ws.onmessage({ data: JSON.stringify({ type: 'model_audio', data: 'c29uZw==', mime: 'audio/wav' }) });
  ws.onmessage({ data: JSON.stringify({ type: 'error', msg: 'bad news' }) });

  assert.ok(statuses.includes('WS open'));
  assert.ok(statuses.includes('ready'));
  assert.deepStrictEqual(texts, ['response text']);
  assert.deepStrictEqual(audios, [{ data: 'c29uZw==', mime: 'audio/wav' }]);
  assert.ok(errors.includes('bad news'));

  client.end();
  assert.deepStrictEqual(JSON.parse(ws.sent.at(-1)), { type: 'end' });
  assert.ok(statuses.includes('WS closed'));
});
