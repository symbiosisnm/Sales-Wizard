const test = require('node:test');
const assert = require('node:assert');

// Minimal mocks for AudioWorklet environment
global.sampleRate = 16000;
const messages = [];
class BaseProcessor {
    constructor() {
        this.port = { postMessage: m => messages.push(m) };
    }
}
global.AudioWorkletProcessor = BaseProcessor;
let ProcessorCtor;
global.registerProcessor = (_name, ctor) => {
    ProcessorCtor = ctor;
};

// Load worklet definition
require('../pcm16-worklet.js');

// Test processing
const proc = new ProcessorCtor({ processorOptions: { targetSampleRate: 16000, samplesPerChunk: 4 } });
test('pcm16-worklet converts Float32 to Int16 chunks', () => {
    const input = new Float32Array([0, 0.5, -0.5, 1]);
    proc.process([[input]]);
    const bytes = messages.shift();
    const i16 = new Int16Array(bytes.buffer);
    assert.deepStrictEqual(Array.from(i16), [0, 16383, -16384, 32767]);
});
