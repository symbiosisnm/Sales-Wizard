// apps/desktop/src/utils/ScreenCapture.ts
type Opts = {
  fps: number;
  onJpegBase64?: (b64: string) => void;
  onLocalJpegBytes?: (bytes: Uint8Array) => void; // for OCR
  onError?: (err: unknown) => void;
};

export class ScreenCapture {
  private stream: MediaStream | null = null;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private handle: number | null = null;
  private opts: Opts;

  constructor(opts: Opts) {
    this.opts = opts;
    this.canvas = document.createElement('canvas');
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('2d ctx');
    this.ctx = ctx;
  }

  async start() {
    try {
      this.stream = await (navigator.mediaDevices as any).getDisplayMedia({ video: { frameRate: 15 }, audio: false });
      const track = this.stream.getVideoTracks()[0];
      const settings = track.getSettings();
      const width = Math.min(1280, (settings.width as number) || 1280);
      const height = Math.min(800, (settings.height as number) || 800);
      this.canvas.width = width;
      this.canvas.height = height;

      const video = document.createElement('video');
      video.srcObject = this.stream;
      await video.play();

      const interval = Math.max(200, 1000 / (this.opts.fps || 1));
      const loop = async () => {
        this.ctx.drawImage(video, 0, 0, this.canvas.width, this.canvas.height);
        const blob = await new Promise<Blob | null>((resolve) => this.canvas.toBlob(b => resolve(b), 'image/jpeg', 0.6));
        if (blob) {
          const bytes = new Uint8Array(await blob.arrayBuffer());
          if (this.opts.onJpegBase64) {
            const b64 = btoa(String.fromCharCode(...bytes));
            this.opts.onJpegBase64(b64);
          }
          if (this.opts.onLocalJpegBytes) {
            this.opts.onLocalJpegBytes(bytes);
          }
        }
        this.handle = self.setTimeout(loop, interval) as any;
      };
      loop();
    } catch (err) {
      await this.stop();
      if (this.opts.onError) this.opts.onError(err);
      throw err;
    }
  }

  async stop() {
    if (this.handle) { clearTimeout(this.handle); this.handle = null; }
    this.stream?.getTracks().forEach(t => t.stop());
    this.stream = null;
  }

  async dispose() {
    await this.stop();
  }
}
