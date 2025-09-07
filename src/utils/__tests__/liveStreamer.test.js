const { test, mock } = require('node:test');
const assert = require('node:assert');

// Stub WebSocket to avoid real network connections
global.WebSocket = class {
  constructor() {
    this.readyState = 1;
    setImmediate(() => this.onopen && this.onopen());
  }
  send() {}
  close() { if (this.onclose) this.onclose(); }
};
global.WebSocket.OPEN = 1;

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
