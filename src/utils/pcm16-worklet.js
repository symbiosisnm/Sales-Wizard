/* global sampleRate */
class PCM16Worklet extends AudioWorkletProcessor {
    constructor(options) {
        super();
        const opts = options?.processorOptions || {};
        this.targetSampleRate = opts.targetSampleRate || sampleRate;
        this.samplesPerChunk = opts.samplesPerChunk || this.targetSampleRate / 2; // default 0.5s
        this._buffer = [];
    }

    process(inputs) {
        const input = inputs[0][0];
        if (!input) return true;
        const ratio = sampleRate / this.targetSampleRate;
        for (let i = 0; i < input.length; i += ratio) {
            const sample = input[Math.floor(i)];
            const s = Math.max(-1, Math.min(1, sample));
            const val = s < 0 ? s * 0x8000 : s * 0x7fff;
            this._buffer.push(val);
        }
        while (this._buffer.length >= this.samplesPerChunk) {
            const chunk = this._buffer.splice(0, this.samplesPerChunk);
            const bytes = new Uint8Array(Int16Array.from(chunk).buffer);
            this.port.postMessage(bytes);
        }
        return true;
    }
}

registerProcessor('pcm16-worklet', PCM16Worklet);
