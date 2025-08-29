const { test } = require('node:test');
const assert = require('node:assert');
const { convertStereoToMono, computeEnergyFromBase64Pcm16 } = require('../audioHandler');

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
