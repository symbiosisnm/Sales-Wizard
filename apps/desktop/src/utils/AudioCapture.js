import { EventEmitter } from 'events';

class AudioCapture extends EventEmitter {
  constructor() {
    super();
    this.stream = null;
    this.ctx = null;
  }

  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.ctx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
    const source = this.ctx.createMediaStreamSource(this.stream);
    const processor = this.ctx.createScriptProcessor(4096, 1, 1);
    source.connect(processor);
    processor.connect(this.ctx.destination);
    processor.onaudioprocess = e => {
      const input = e.inputBuffer.getChannelData(0);
      const pcm = new Int16Array(input.length);
      for (let i = 0; i < input.length; i++) {
        const s = Math.max(-1, Math.min(1, input[i]));
        pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }
      this.emit('data', Buffer.from(pcm.buffer));
    };
    this._processor = processor;
    this._source = source;
  }

  stop() {
    if (this._processor) this._processor.disconnect();
    if (this._source) this._source.disconnect();
    if (this.stream) this.stream.getTracks().forEach(t => t.stop());
    if (this.ctx) this.ctx.close();
  }
}

export default AudioCapture;
