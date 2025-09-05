const { test, mock } = require('node:test');
const assert = require('node:assert');

test('convertStereoToMono converts buffer', () => {
    const { convertStereoToMono } = require('../audioHandler');
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
    const { computeEnergyFromBase64Pcm16 } = require('../audioHandler');
    const buf = Buffer.alloc(4);
    buf.writeInt16LE(1000, 0);
    buf.writeInt16LE(-1000, 2);
    const base64 = buf.toString('base64');
    const energy = computeEnergyFromBase64Pcm16(base64);
    assert.strictEqual(energy, 1000);
});

test('startMacOSAudioCapture rejects if binary missing', async () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'darwin' });

    const fs = require('fs');
    const cp = require('child_process');
    mock.method(cp, 'exec', (cmd, cb) => cb(null, ''));
    mock.method(fs, 'existsSync', () => false);

    const electronPath = require.resolve('electron');
    require.cache[electronPath] = { exports: { app: { isPackaged: false } } };

    const modulePath = require.resolve('../audioHandler');
    delete require.cache[modulePath];
    const { startMacOSAudioCapture } = require(modulePath);

    await assert.rejects(() => startMacOSAudioCapture({ current: null }), /SystemAudioDump binary not found/);

    mock.restoreAll();
    delete require.cache[modulePath];
    delete require.cache[electronPath];
    Object.defineProperty(process, 'platform', { value: originalPlatform });
});

test('startMacOSAudioCapture propagates spawn error', async () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'darwin' });

    const fs = require('fs');
    const cp = require('child_process');
    mock.method(cp, 'exec', (cmd, cb) => cb(null, ''));
    mock.method(fs, 'existsSync', () => true);

    const electronPath = require.resolve('electron');
    require.cache[electronPath] = { exports: { app: { isPackaged: false } } };

    mock.method(cp, 'spawn', () => {
        const { EventEmitter } = require('events');
        const proc = new EventEmitter();
        proc.pid = 1234;
        proc.stdout = new EventEmitter();
        proc.stderr = new EventEmitter();
        proc.kill = () => {};
        process.nextTick(() => proc.emit('error', new Error('spawn fail')));
        return proc;
    });

    const modulePath = require.resolve('../audioHandler');
    delete require.cache[modulePath];
    const { startMacOSAudioCapture } = require(modulePath);

    await assert.rejects(() => startMacOSAudioCapture({ current: null }), /spawn fail/);

    mock.restoreAll();
    delete require.cache[modulePath];
    delete require.cache[electronPath];
    Object.defineProperty(process, 'platform', { value: originalPlatform });
});

test('startMacOSAudioCapture propagates stderr output', async () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'darwin' });

    const fs = require('fs');
    const cp = require('child_process');
    mock.method(cp, 'exec', (cmd, cb) => cb(null, ''));
    mock.method(fs, 'existsSync', () => true);

    const electronPath = require.resolve('electron');
    require.cache[electronPath] = { exports: { app: { isPackaged: false } } };

    mock.method(cp, 'spawn', () => {
        const { EventEmitter } = require('events');
        const proc = new EventEmitter();
        proc.pid = 1234;
        proc.stdout = new EventEmitter();
        proc.stderr = new EventEmitter();
        proc.kill = () => {};
        process.nextTick(() => proc.stderr.emit('data', Buffer.from('boom')));
        return proc;
    });

    const modulePath = require.resolve('../audioHandler');
    delete require.cache[modulePath];
    const { startMacOSAudioCapture } = require(modulePath);

    await assert.rejects(() => startMacOSAudioCapture({ current: null }), /SystemAudioDump stderr: boom/);

    mock.restoreAll();
    delete require.cache[modulePath];
    delete require.cache[electronPath];
    Object.defineProperty(process, 'platform', { value: originalPlatform });
});

