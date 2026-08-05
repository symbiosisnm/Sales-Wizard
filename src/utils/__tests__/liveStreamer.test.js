const { test, mock } = require('node:test');
const assert = require('node:assert');

// Stub WebSocket to avoid real network connections
global.WebSocket = class {
  constructor() {
    this.readyState = 1;
    this.sent = [];
    global.WebSocket.instances.push(this);
    setImmediate(() => this.onopen && this.onopen());
  }
  send(payload) { this.sent.push(payload); }
  close() { if (this.onclose) this.onclose(); }
};
global.WebSocket.OPEN = 1;
global.WebSocket.instances = [];

// Lazily import the ESM live streamer so Node's CommonJS tests can use it.
let liveStreamerModule = null;
async function getLiveStreamer() {
  if (!liveStreamerModule) {
    liveStreamerModule = await import('../liveStreamer.mjs');
  }
  return liveStreamerModule;
}

// Helper to restore globals after each test
function restoreTimers(orig) {
  global.setInterval = orig.setInterval;
  global.clearInterval = orig.clearInterval;
}

function nextTick() {
  return new Promise(resolve => setImmediate(resolve));
}

function setNavigatorMediaDevices(mediaDevices) {
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    writable: true,
    value: { mediaDevices },
  });
}

function latestSocket() {
  return global.WebSocket.instances.at(-1);
}

test('screen track end stops interval and notifies status', async () => {
  const { startLiveStreaming } = await getLiveStreamer();
  global.logger = { warn: mock.fn(), error: mock.fn(), info: mock.fn() };

  const track = { stop: mock.fn(), onended: null };
  const screenStream = {
    getVideoTracks: () => [track],
    getTracks: () => [track],
  };

  setNavigatorMediaDevices({
    getUserMedia: mock.fn(async () => { throw new Error('no audio'); }),
    getDisplayMedia: mock.fn(async () => screenStream),
  });

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
  await nextTick();
  await nextTick();

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
  const { startLiveStreaming } = await getLiveStreamer();
  global.logger = { warn: mock.fn(), error: mock.fn(), info: mock.fn() };
  const err = new Error('Permission denied');
  err.name = 'NotAllowedError';
  setNavigatorMediaDevices({
    getUserMedia: mock.fn(async () => { throw new Error('no audio'); }),
    getDisplayMedia: mock.fn(async () => { throw err; }),
  });

  const onStatus = mock.fn();
  const onError = mock.fn();

  const origTimers = { setInterval, clearInterval };
  global.setInterval = mock.fn();
  global.clearInterval = mock.fn();

  await startLiveStreaming({ onResponse: () => {}, onStatus, onError });
  await nextTick();
  await nextTick();

  assert.ok(onError.mock.callCount() >= 1);
  assert.match(onError.mock.calls[0].arguments[0], /blocked or denied/);
  assert.ok(onStatus.mock.callCount() >= 1);
  assert.deepStrictEqual(onStatus.mock.calls.at(-1).arguments, ['Screen capture ended']);

  restoreTimers(origTimers);
});

test('screen previews and refresh_help share the live websocket session', async () => {
  const { startLiveStreaming } = await getLiveStreamer();
  global.logger = { warn: mock.fn(), error: mock.fn(), info: mock.fn() };

  const track = { stop: mock.fn(), onended: null };
  const screenStream = {
    getVideoTracks: () => [track],
    getTracks: () => [track],
  };

  setNavigatorMediaDevices({
    getUserMedia: mock.fn(async () => { throw new Error('no audio'); }),
    getDisplayMedia: mock.fn(async () => screenStream),
  });

  class FakeBlob {
    constructor() {
      this.type = 'image/jpeg';
    }
    async arrayBuffer() {
      return Uint8Array.from([1, 2, 3]).buffer;
    }
  }

  global.ImageCapture = class {
    constructor() {}
    async takePhoto() {
      return new FakeBlob();
    }
  };

  const onScreenPreview = mock.fn();
  const origTimers = { setInterval, clearInterval };
  global.setInterval = mock.fn(() => 456);
  global.clearInterval = mock.fn();

  const stopFn = await startLiveStreaming({
    apiKey: 'sk-test',
    onResponse: () => {},
    onScreenPreview,
    screenshotIntervalSeconds: 'manual',
  });
  await nextTick();
  await nextTick();

  assert.strictEqual(onScreenPreview.mock.callCount(), 1);
  assert.match(onScreenPreview.mock.calls[0].arguments[0].dataUrl, /^data:image\/jpeg;base64,/);

  await stopFn.refreshHelp('Explain your hardware validation process.');

  const sentMessages = latestSocket().sent.map(payload => JSON.parse(payload));
  assert.ok(sentMessages.some(msg => msg.type === 'image'));
  assert.ok(
    sentMessages.some(
      msg => msg.type === 'refresh_help' && msg.text === 'Explain your hardware validation process.'
    )
  );

  stopFn();
  restoreTimers(origTimers);
});

test('refresh_help does not wait for a fresh screen frame before sending the request', async () => {
  const { startLiveStreaming } = await getLiveStreamer();
  global.logger = { warn: mock.fn(), error: mock.fn(), info: mock.fn() };

  const track = { stop: mock.fn(), onended: null };
  const screenStream = {
    getVideoTracks: () => [track],
    getTracks: () => [track],
  };

  setNavigatorMediaDevices({
    getUserMedia: mock.fn(async () => { throw new Error('no audio'); }),
    getDisplayMedia: mock.fn(async () => screenStream),
  });

  global.ImageCapture = class {
    constructor() {}
    async takePhoto() {
      return new Promise(() => {});
    }
  };

  const origTimers = { setInterval, clearInterval };
  global.setInterval = mock.fn();
  global.clearInterval = mock.fn();

  const stopFn = await startLiveStreaming({
    apiKey: 'sk-test',
    onResponse: () => {},
    screenshotIntervalSeconds: 'manual',
  });
  await nextTick();

  stopFn.refreshHelp('Search for the latest Z2 workstation specs.');
  await nextTick();

  const sentMessages = latestSocket().sent.map(payload => JSON.parse(payload));
  assert.ok(
    sentMessages.some(
      msg => msg.type === 'refresh_help' && msg.text === 'Search for the latest Z2 workstation specs.'
    )
  );

  stopFn();
  restoreTimers(origTimers);
});

test('focus updates and refresh_response stay on the live websocket session', async () => {
  const { startLiveStreaming } = await getLiveStreamer();
  global.logger = { warn: mock.fn(), error: mock.fn(), info: mock.fn() };

  setNavigatorMediaDevices({
    getUserMedia: mock.fn(async () => { throw new Error('no audio'); }),
    getDisplayMedia: mock.fn(async () => { throw new Error('no screen'); }),
  });

  const origTimers = { setInterval, clearInterval };
  global.setInterval = mock.fn();
  global.clearInterval = mock.fn();

  const stopFn = await startLiveStreaming({
    apiKey: 'sk-test',
    focusConfig: {
      jobTitle: 'Hardware interview',
      objective: 'Stay on board bring-up',
    },
    onResponse: () => {},
  });
  await nextTick();
  await nextTick();

  stopFn.updateFocusConfig({
    jobTitle: 'Automotive diagnostics',
    objective: 'Explain the next troubleshooting step',
    strictFocus: true,
  });
  await stopFn.refreshResponse('What do I say about this relay fault?', true);

  const sentMessages = latestSocket().sent.map(payload => JSON.parse(payload));
  assert.ok(
    sentMessages.some(
      msg =>
        msg.type === 'start' &&
        msg.focusConfig?.jobTitle === 'Hardware interview' &&
        msg.focusConfig?.objective === 'Stay on board bring-up'
    )
  );
  assert.ok(
    sentMessages.some(
      msg =>
        msg.type === 'focus_config' &&
        msg.config?.jobTitle === 'Automotive diagnostics' &&
        msg.config?.strictFocus === true
    )
  );
  assert.ok(
    sentMessages.some(
      msg =>
        msg.type === 'refresh_response' &&
        msg.text === 'What do I say about this relay fault?' &&
        msg.refreshHelp === true
    )
  );

  stopFn();
  restoreTimers(origTimers);
});

test('captureSystemAudio requests display audio when enabled', async () => {
  const { startLiveStreaming } = await getLiveStreamer();
  global.logger = { warn: mock.fn(), error: mock.fn(), info: mock.fn() };

  const track = { stop: mock.fn(), onended: null };
  const screenStream = {
    getAudioTracks: () => [],
    getVideoTracks: () => [track],
    getTracks: () => [track],
  };
  const getDisplayMedia = mock.fn(async () => screenStream);

  setNavigatorMediaDevices({
    getUserMedia: mock.fn(async () => {
      throw new Error('no audio');
    }),
    getDisplayMedia,
  });

  global.ImageCapture = class {
    constructor() {}
    async takePhoto() {
      return new (class {
        constructor() {
          this.type = 'image/jpeg';
        }
        async arrayBuffer() {
          return Uint8Array.from([1, 2, 3]).buffer;
        }
      })();
    }
  };

  const origTimers = { setInterval, clearInterval };
  global.setInterval = mock.fn();
  global.clearInterval = mock.fn();

  const stopFn = await startLiveStreaming({
    apiKey: 'sk-test',
    onResponse: () => {},
    sessionOptions: {
      captureSystemAudio: true,
    },
    screenshotIntervalSeconds: 'manual',
  });
  await nextTick();

  assert.strictEqual(getDisplayMedia.mock.callCount(), 1);
  assert.deepStrictEqual(getDisplayMedia.mock.calls[0].arguments[0], {
    video: true,
    audio: true,
  });

  stopFn();
  restoreTimers(origTimers);
});

test('session option updates stay on the live websocket session', async () => {
  const { startLiveStreaming } = await getLiveStreamer();
  global.logger = { warn: mock.fn(), error: mock.fn(), info: mock.fn() };

  setNavigatorMediaDevices({
    getUserMedia: mock.fn(async () => {
      throw new Error('no audio');
    }),
    getDisplayMedia: mock.fn(async () => {
      throw new Error('no screen');
    }),
  });

  const origTimers = { setInterval, clearInterval };
  global.setInterval = mock.fn();
  global.clearInterval = mock.fn();

  const stopFn = await startLiveStreaming({
    apiKey: 'sk-test',
    onResponse: () => {},
  });
  await nextTick();
  await nextTick();

  stopFn.updateSessionOptions({
    rememberImports: true,
    videoAssistMode: 'imported',
  });

  const sentMessages = latestSocket().sent.map(payload => JSON.parse(payload));
  assert.ok(
    sentMessages.some(
      msg =>
        msg.type === 'session_options' &&
        msg.options?.rememberImports === true &&
        msg.options?.videoAssistMode === 'imported'
    )
  );

  stopFn();
  restoreTimers(origTimers);
});
