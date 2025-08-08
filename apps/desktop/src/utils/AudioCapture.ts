// apps/desktop/src/utils/AudioCapture.ts
type Opts = {
  onPcm16Base64?: (b64: string) => void; // streamed to WS
  onLocalPCM16?: (pcm: Int16Array) => void; // for local ASR
};

export class AudioCapture {
  private ctx: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private opts: Opts;

  constructor(opts: Opts) { this.opts = opts; }

  async start() {
    if (this.ctx) return;
    this.ctx = new AudioContext({ sampleRate: 48000 });
    await this.ctx.audioWorklet.addModule(new URL('./pcm16-worklet.js', import.meta.url).toString());
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
    this.mediaStream = stream;
    const src = this.ctx.createMediaStreamSource(stream);
    this.workletNode = new AudioWorkletNode(this.ctx, 'pcm16-worklet', { processorOptions: { targetSampleRate: 16000 } });
    this.workletNode.port.onmessage = (e) => {
      const bytes = e.data as Uint8Array;
      // WS streaming
      if (this.opts.onPcm16Base64) {
        const b64 = btoa(String.fromCharCode(...bytes));
        this.opts.onPcm16Base64(b64);
      }
      // Local ASR
      if (this.opts.onLocalPCM16) {
        const i16 = new Int16Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
        this.opts.onLocalPCM16(i16);
      }
    };
    src.connect(this.workletNode);
    this.workletNode.connect(this.ctx.destination); // keep graph alive
  }

  async stop() {
    this.workletNode?.disconnect();
    this.workletNode = null;
    this.mediaStream?.getTracks().forEach(t => t.stop());
    this.mediaStream = null;
    await this.ctx?.close();
    this.ctx = null;
  }
}
