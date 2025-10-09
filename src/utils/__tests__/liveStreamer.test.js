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
const { LLMClient } = require('../../services/llmClient');

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
  const screenStatuses = onStatus.mock.calls
    .map(call => call.arguments[0])
    .filter(arg => arg && typeof arg === 'object' && 'screen' in arg);
  assert.ok(screenStatuses.length >= 1);
  assert.deepStrictEqual(screenStatuses.at(-1), { screen: 'idle', message: 'Screen capture ended' });

  // Calling returned cleanup should not throw and should not double clear interval
  stopFn();
  assert.strictEqual(clearIntervalMock.mock.callCount(), 1);
  const finalScreenStatuses = onStatus.mock.calls
    .map(call => call.arguments[0])
    .filter(arg => arg && typeof arg === 'object' && 'screen' in arg);
  assert.deepStrictEqual(finalScreenStatuses.at(-1), { screen: 'idle', message: 'Screen capture ended' });

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
  const statusPayloads = onStatus.mock.calls.map(call => call.arguments[0]);
  assert.ok(statusPayloads.some(payload => payload?.screen === 'error'));
  const finalStatus = statusPayloads.filter(payload => payload?.screen).at(-1);
  assert.deepStrictEqual(finalStatus, { screen: 'idle', message: 'Screen capture ended' });

  restoreTimers(origTimers);
});

test('fallback to grabFrame encodes frames when takePhoto is unavailable', async () => {
  global.logger = { warn: mock.fn(), error: mock.fn(), info: mock.fn() };

  const origNavigator = global.navigator;
  const track = {
    stop: mock.fn(),
    onended: null,
    getSettings: () => ({ width: 8, height: 6 }),
  };
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

  const grabFrameMock = mock.fn(async () => ({ width: 8, height: 6, close: mock.fn() }));
  const origImageCapture = global.ImageCapture;
  global.ImageCapture = class {
    constructor() {}
    grabFrame = grabFrameMock;
  };

  const origOffscreenCanvas = global.OffscreenCanvas;
  const origBlob = global.Blob;
  const origBtoa = global.btoa;

  class FakeBlob {
    constructor(parts, { type } = {}) {
      this.type = type;
      const buffers = Array.isArray(parts) ? parts : [parts];
      this._buffer = Buffer.concat(buffers.map(p => (Buffer.isBuffer(p) ? p : Buffer.from(String(p)))));
    }
    async arrayBuffer() {
      return this._buffer;
    }
  }

  class FakeOffscreenCanvas {
    constructor(width, height) {
      this.width = width;
      this.height = height;
      this._ctx = { drawImage: mock.fn() };
    }
    getContext() {
      return this._ctx;
    }
    convertToBlob({ type } = {}) {
      return Promise.resolve(new FakeBlob(Buffer.from('bitmap'), { type }));
    }
  }

  global.OffscreenCanvas = FakeOffscreenCanvas;
  global.Blob = FakeBlob;
  global.btoa = str => Buffer.from(str, 'binary').toString('base64');

  const origTimers = { setInterval, clearInterval };
  const callbacks = [];
  global.setInterval = mock.fn(fn => {
    callbacks.push(fn);
    return callbacks.length;
  });
  global.clearInterval = mock.fn();

  const origSendJpeg = LLMClient.prototype.sendJpegBase64;
  const sendSpy = mock.fn();
  LLMClient.prototype.sendJpegBase64 = sendSpy;

  try {
    const stopFn = await startLiveStreaming({ onResponse: () => {}, onStatus: () => {}, onError: () => {} });

    assert.strictEqual(callbacks.length, 1, 'frame interval registered');

    await callbacks[0]();

    assert.strictEqual(sendSpy.mock.callCount(), 1, 'frame sent via grabFrame fallback');
    const [base64, mime] = sendSpy.mock.calls[0].arguments;
    assert.strictEqual(typeof base64, 'string');
    assert.strictEqual(mime, 'image/jpeg');

    stopFn();
  } finally {
    LLMClient.prototype.sendJpegBase64 = origSendJpeg;
    global.setInterval = origTimers.setInterval;
    global.clearInterval = origTimers.clearInterval;
    global.navigator = origNavigator;
    global.ImageCapture = origImageCapture;
    global.OffscreenCanvas = origOffscreenCanvas;
    global.Blob = origBlob;
    if (origBtoa) global.btoa = origBtoa; else delete global.btoa;
  }
});

test('canvas fallback draws frame and cleans up DOM nodes', async () => {
  global.logger = { warn: mock.fn(), error: mock.fn(), info: mock.fn() };

  const origNavigator = global.navigator;
  const track = {
    stop: mock.fn(),
    onended: null,
    getSettings: () => ({ width: 10, height: 12 }),
  };
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

  const origImageCapture = global.ImageCapture;
  global.ImageCapture = class {
    constructor() {}
    takePhoto() { throw new Error('not supported'); }
    grabFrame() { throw new Error('grabFrame unavailable'); }
  };

  const origDocument = global.document;
  const appended = [];
  const body = {
    appendChild(node) {
      appended.push(node);
      node.parentNode = body;
    },
    removeChild(node) {
      const idx = appended.indexOf(node);
      if (idx >= 0) appended.splice(idx, 1);
      node.parentNode = null;
    },
  };

  const makeCanvas = () => {
    const ctx = { drawImage: mock.fn() };
    return {
      tagName: 'CANVAS',
      style: {},
      width: 0,
      height: 0,
      parentNode: null,
      getContext: () => ctx,
      toBlob: cb => cb(new FakeBlob(Buffer.from('canvas'), { type: 'image/jpeg' })),
      remove() { if (this.parentNode) this.parentNode.removeChild(this); },
    };
  };

  const makeVideo = () => ({
    tagName: 'VIDEO',
    style: {},
    readyState: 3,
    videoWidth: 10,
    videoHeight: 12,
    width: 10,
    height: 12,
    parentNode: null,
    play: () => Promise.resolve(),
    pause: mock.fn(),
    remove() { if (this.parentNode) this.parentNode.removeChild(this); },
  });

  class FakeBlob {
    constructor(parts, { type } = {}) {
      this.type = type;
      const buffers = Array.isArray(parts) ? parts : [parts];
      this._buffer = Buffer.concat(buffers.map(p => (Buffer.isBuffer(p) ? p : Buffer.from(String(p)))));
    }
    async arrayBuffer() {
      return this._buffer;
    }
  }

  const origBlob = global.Blob;
  global.Blob = FakeBlob;
  const origBtoa = global.btoa;
  global.btoa = str => Buffer.from(str, 'binary').toString('base64');

  global.document = {
    createElement(tag) {
      if (tag === 'canvas') return makeCanvas();
      if (tag === 'video') return makeVideo();
      return { tagName: tag.toUpperCase(), style: {}, remove() { if (this.parentNode) this.parentNode.removeChild(this); } };
    },
    body,
  };

  const origTimers = { setInterval, clearInterval };
  const callbacks = [];
  global.setInterval = mock.fn(fn => {
    callbacks.push(fn);
    return callbacks.length;
  });
  global.clearInterval = mock.fn();

  const origSendJpeg = LLMClient.prototype.sendJpegBase64;
  const sendSpy = mock.fn();
  LLMClient.prototype.sendJpegBase64 = sendSpy;

  try {
    const stopFn = await startLiveStreaming({ onResponse: () => {}, onStatus: () => {}, onError: () => {} });

    assert.strictEqual(callbacks.length, 1, 'frame interval registered');

    await callbacks[0]();

    assert.strictEqual(sendSpy.mock.callCount(), 1, 'frame sent via canvas fallback');
    assert.ok(appended.length > 0, 'DOM nodes created for fallback');

    track.onended();
    assert.strictEqual(appended.length, 0, 'DOM nodes cleaned on track end');

    stopFn();
  } finally {
    LLMClient.prototype.sendJpegBase64 = origSendJpeg;
    global.setInterval = origTimers.setInterval;
    global.clearInterval = origTimers.clearInterval;
    global.navigator = origNavigator;
    global.ImageCapture = origImageCapture;
    global.document = origDocument;
    global.Blob = origBlob;
    if (origBtoa) global.btoa = origBtoa; else delete global.btoa;
  }
});

test('electron IPC path wires callbacks and stops stream', async () => {
  const origWindow = global.window;
  const start = mock.fn(async () => ({ success: true }));
  const stop = mock.fn(async () => ({ success: true }));
  const removeResponse = mock.fn();
  const removeStatus = mock.fn();
  let responseHandler;
  let statusHandler;

  global.window = {
    electron: {
      startLiveStream: start,
      stopLiveStream: stop,
      onUpdateResponse: handler => {
        responseHandler = handler;
      },
      onUpdateStatus: handler => {
        statusHandler = handler;
      },
      removeUpdateResponseListener: handler => removeResponse(handler),
      removeUpdateStatusListener: handler => removeStatus(handler),
    },
  };

  const onResponse = mock.fn();
  const onStatus = mock.fn();
  const onError = mock.fn();

  const stopFn = await startLiveStreaming({
    onResponse,
    onStatus,
    onError,
    onAudioLevel: () => {},
    onNote: () => {},
  });

  assert.strictEqual(start.mock.callCount(), 1);
  assert.deepStrictEqual(onStatus.mock.calls[0].arguments, ['Initializing live stream...']);

  statusHandler({}, 'Listening...');
  assert.deepStrictEqual(onStatus.mock.calls.at(-1).arguments, ['Listening...']);

  responseHandler({}, 'Hello world');
  assert.deepStrictEqual(onResponse.mock.calls.at(-1).arguments, ['Hello world']);
  assert.strictEqual(onError.mock.callCount(), 0);

  stopFn();
  assert.strictEqual(stop.mock.callCount(), 1);
  assert.strictEqual(removeResponse.mock.callCount(), 1);
  assert.strictEqual(removeStatus.mock.callCount(), 1);

  if (typeof origWindow === 'undefined') {
    delete global.window;
  } else {
    global.window = origWindow;
  }
});

test('electron IPC path surfaces start errors', async () => {
  const origWindow = global.window;
  const start = mock.fn(async () => ({ success: false, error: 'no session' }));
  const stop = mock.fn(async () => ({ success: true }));
  const removeResponse = mock.fn();
  const removeStatus = mock.fn();

  global.window = {
    electron: {
      startLiveStream: start,
      stopLiveStream: stop,
      onUpdateResponse: () => {},
      onUpdateStatus: () => {},
      removeUpdateResponseListener: handler => removeResponse(handler),
      removeUpdateStatusListener: handler => removeStatus(handler),
    },
  };

  const onResponse = mock.fn();
  const onStatus = mock.fn();
  const onError = mock.fn();

  await assert.rejects(
    startLiveStreaming({ onResponse, onStatus, onError, onAudioLevel: () => {}, onNote: () => {} }),
    /no session/
  );

  assert.strictEqual(onError.mock.callCount(), 1);
  assert.strictEqual(stop.mock.callCount(), 0);
  assert.strictEqual(removeResponse.mock.callCount(), 1);
  assert.strictEqual(removeStatus.mock.callCount(), 1);

  if (typeof origWindow === 'undefined') {
    delete global.window;
  } else {
    global.window = origWindow;
  }
});
