const { test, mock } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const mockFs = require('mock-fs');
const childProcess = require('child_process');
const audioHandler = require('../audioHandler');
const ipcUtils = require('../ipcUtils');

const { convertStereoToMono, computeEnergyFromBase64Pcm16, startMacOSAudioCapture } = audioHandler;

function stubPlatform(t, platform) {
    const descriptor = Object.getOwnPropertyDescriptor(process, 'platform');
    Object.defineProperty(process, 'platform', { ...descriptor, value: platform });
    t.after(() => Object.defineProperty(process, 'platform', descriptor));
}

function stubElectron(t, overrides = {}) {
    const electronPath = require.resolve('electron');
    const original = require.cache[electronPath];
    require.cache[electronPath] = { exports: { app: { isPackaged: false, ...overrides } } };
    t.after(() => {
        if (original) {
            require.cache[electronPath] = original;
        } else {
            delete require.cache[electronPath];
        }
    });
}

function stubLogger(t) {
    const originalLogger = global.logger;
    global.logger = {
        error: mock.fn(),
        warn: mock.fn(),
        info: mock.fn(),
        debug: mock.fn(),
    };
    t.after(() => {
        global.logger = originalLogger;
    });
}

function stubSendToRenderer(t) {
    const statusSpy = mock.fn();
    const originalSend = ipcUtils.sendToRenderer;
    ipcUtils.sendToRenderer = statusSpy;
    t.after(() => {
        ipcUtils.sendToRenderer = originalSend;
    });
    return statusSpy;
}

function stubSpawn(t, implementation) {
    const originalSpawn = childProcess.spawn;
    childProcess.spawn = implementation;
    t.after(() => {
        childProcess.spawn = originalSpawn;
    });
}

function mockKillProcess() {
    const listeners = {};
    return {
        pid: 111,
        on(event, handler) {
            listeners[event] = handler;
            if (event === 'close') {
                setImmediate(() => handler(0, null));
            }
            return this;
        },
        kill() {
            if (listeners.close) listeners.close(0, null);
        },
        stdout: { on() {} },
        stderr: { on() {} },
    };
}

test('convertStereoToMono converts buffer', () => {
    const stereo = Buffer.alloc(8);
    stereo.writeInt16LE(1, 0);
    stereo.writeInt16LE(2, 2);
    stereo.writeInt16LE(3, 4);
    stereo.writeInt16LE(4, 6);
    const mono = convertStereoToMono(stereo);
    assert.strictEqual(mono.length, 4);
    assert.strictEqual(mono.readInt16LE(0), 1);
    assert.strictEqual(mono.readInt16LE(2), 3);
});

test('computeEnergyFromBase64Pcm16 calculates average amplitude', () => {
    const buf = Buffer.alloc(4);
    buf.writeInt16LE(1000, 0);
    buf.writeInt16LE(-1000, 2);
    const base64 = buf.toString('base64');
    const energy = computeEnergyFromBase64Pcm16(base64);
    assert.strictEqual(energy, 1000);
});

test('startMacOSAudioCapture notifies when SystemAudioDump binary is missing', async t => {
    stubPlatform(t, 'darwin');
    stubElectron(t);
    stubLogger(t);
    const statusSpy = stubSendToRenderer(t);

    stubSpawn(t, mock.fn(command => {
        if (command === 'pkill') {
            return mockKillProcess();
        }
        throw new Error(`Unexpected spawn command: ${command}`);
    }));

    mockFs({});
    t.after(() => mockFs.restore());

    const result = await startMacOSAudioCapture({ current: null });
    assert.strictEqual(result, false);
    assert.ok(statusSpy.mock.callCount() > 0);
    const lastStatus = statusSpy.mock.calls.at(-1).arguments;
    assert.deepStrictEqual(lastStatus[0], 'update-status');
    assert.match(lastStatus[1], /binary not found/i);
});

test('startMacOSAudioCapture surfaces spawn errors to the renderer', async t => {
    stubPlatform(t, 'darwin');
    stubElectron(t);
    stubLogger(t);
    const statusSpy = stubSendToRenderer(t);

    const spawnError = new Error('spawn failure');
    stubSpawn(t, mock.fn((command, args, options) => {
        if (command === 'pkill') {
            return mockKillProcess();
        }
        throw spawnError;
    }));

    const assetsDir = path.join(__dirname, '../../assets');
    mockFs({
        [assetsDir]: {
            SystemAudioDump: mockFs.file({ mode: 0o755, content: '' }),
        },
    });
    t.after(() => mockFs.restore());

    const result = await startMacOSAudioCapture({ current: null });
    assert.strictEqual(result, false);
    assert.strictEqual(childProcess.spawn.mock.callCount(), 2);
    const lastStatus = statusSpy.mock.calls.at(-1).arguments;
    assert.deepStrictEqual(lastStatus[0], 'update-status');
    assert.match(lastStatus[1], /Error starting system audio capture/i);
    assert.match(lastStatus[1], /spawn failure/i);
});
