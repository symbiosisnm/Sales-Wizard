export async function getScreenStream(): Promise<MediaStream> {
  return navigator.mediaDevices.getDisplayMedia({
    video: { frameRate: 5, width: { ideal: 1280 }, height: { ideal: 720 } },
    audio: false
  });
}

export function startScreenBursting(stream: MediaStream, onFrame: (b64: string) => void, fps = 1) {
  const [track] = stream.getVideoTracks();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const imageCapture: any = new (window as any).ImageCapture(track);
  let timer: number | null = null;

  async function shoot() {
    try {
      const bitmap = await imageCapture.grabFrame();
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(bitmap, 0, 0);
      const blob = await canvas.convertToBlob({ type: 'image/webp', quality: 0.6 });
      const b64 = await blobToBase64(blob);
      onFrame(b64);
    } catch (e) {
      console.warn('screen frame error', e);
    }
  }

  const interval = 1000 / fps;
  timer = setInterval(shoot, interval) as unknown as number;

  return () => {
    if (timer) clearInterval(timer);
    track.stop();
  };
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  let binary = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}
