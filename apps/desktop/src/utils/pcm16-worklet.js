// apps/desktop/src/utils/pcm16-worklet.js
class PCM16Worklet extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.targetSampleRate = options.processorOptions?.targetSampleRate || 16000;
    this._buffer = [];
  }

  process(inputs) {
    const input = inputs[0][0];
    if (!input) return true;
    // downsample from sampleRate to targetSampleRate
    const ratio = sampleRate / this.targetSampleRate;
    for (let i = 0; i < input.length; i += ratio) {
      const sample = input[Math.floor(i)];
      const s = Math.max(-1, Math.min(1, sample));
      const val = s < 0 ? s * 0x8000 : s * 0x7fff;
      this._buffer.push(val);
    }
    if (this._buffer.length >= this.targetSampleRate / 2) { // 0.5s
      const i16 = new Int16Array(this._buffer);
      const bytes = new Uint8Array(i16.buffer);
      this.port.postMessage(bytes);
      this._buffer = [];
    }
    return true;
  }
}

registerProcessor('pcm16-worklet', PCM16Worklet);
