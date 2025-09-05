export async function startScreenCapture({ quality = 'medium', cropRegion = 'full' } = {}) {
  // Track cursor position when needed for cropping
  let lastCursorPoint = null;
  function startCursorTracking() {
    if (!window.electron?.ipcRenderer) return;
    const poll = async () => {
      try {
        const res = await window.electron.ipcRenderer.invoke('get-cursor-point');
        if (res?.success) lastCursorPoint = res;
      } catch (_e) {
        /* ignore */
      }
    };
    setInterval(poll, 300);
    poll();
  }

  // Track active window bounds when needed for cropping
  let lastActiveWindow = null;
  function startActiveWindowTracking() {
    if (!window.electron?.ipcRenderer) return;
    const poll = async () => {
      try {
        const res = await window.electron.ipcRenderer.invoke('get-active-window');
        if (res?.success) lastActiveWindow = res;
      } catch (_e) {
        /* ignore */
      }
    };
    setInterval(poll, 500);
    poll();
  }

  if (cropRegion === 'cursor') startCursorTracking();
  if (cropRegion === 'window') startActiveWindowTracking();

  // Obtain screen media
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: {
      width: { ideal: 1920 },
      height: { ideal: 1080 },
    },
    audio: false,
  });

  const [track] = stream.getVideoTracks();
  const processor = new MediaStreamTrackProcessor({ track });
  const reader = processor.readable.getReader();

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');

  let frameHandler = () => {};
  function onFrame(cb) {
    frameHandler = cb;
  }

  function getQualityValue() {
    switch (quality) {
      case 'high':
        return 0.9;
      case 'low':
        return 0.5;
      case 'medium':
      default:
        return 0.7;
    }
  }

  async function processFrame({ value: frame, done }) {
    if (done) return;
    try {
      const bitmap = await createImageBitmap(frame);
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      ctx.drawImage(bitmap, 0, 0);
      frame.close();

      let drawCanvas = canvas;
      if (cropRegion === 'cursor' && lastCursorPoint?.success) {
        try {
          const { point, bounds } = lastCursorPoint;
          const screenW = bounds.width;
          const screenH = bounds.height;
          const vx = Math.max(0, Math.min(point.x - bounds.x, screenW));
          const vy = Math.max(0, Math.min(point.y - bounds.y, screenH));
          const sx = Math.floor((vx / screenW) * canvas.width);
          const sy = Math.floor((vy / screenH) * canvas.height);
          const cropW = Math.min(768, canvas.width);
          const cropH = Math.min(432, canvas.height);
          const halfW = Math.floor(cropW / 2);
          const halfH = Math.floor(cropH / 2);
          const srcX = Math.max(0, Math.min(canvas.width - cropW, sx - halfW));
          const srcY = Math.max(0, Math.min(canvas.height - cropH, sy - halfH));
          const cropped = document.createElement('canvas');
          cropped.width = cropW;
          cropped.height = cropH;
          const cctx = cropped.getContext('2d');
          cctx.drawImage(canvas, srcX, srcY, cropW, cropH, 0, 0, cropW, cropH);
          drawCanvas = cropped;
        } catch (_e) {
          // ignore
        }
      } else if (cropRegion === 'window' && lastActiveWindow?.success) {
        try {
          const { bounds, displayBounds } = lastActiveWindow;
          const screenW = displayBounds.width;
          const screenH = displayBounds.height;
          const vx = Math.max(0, bounds.x - displayBounds.x);
          const vy = Math.max(0, bounds.y - displayBounds.y);
          const sx = Math.floor((vx / screenW) * canvas.width);
          const sy = Math.floor((vy / screenH) * canvas.height);
          const cropW = Math.floor((bounds.width / screenW) * canvas.width);
          const cropH = Math.floor((bounds.height / screenH) * canvas.height);
          const cropped = document.createElement('canvas');
          cropped.width = cropW;
          cropped.height = cropH;
          const cctx = cropped.getContext('2d');
          cctx.drawImage(canvas, sx, sy, cropW, cropH, 0, 0, cropW, cropH);
          drawCanvas = cropped;
        } catch (_e) {
          // ignore
        }
      }

      const qualityValue = getQualityValue();
      let mimeType = 'image/webp';
      let blob = await new Promise(resolve => drawCanvas.toBlob(resolve, mimeType, qualityValue));
      if (!blob) {
        mimeType = 'image/jpeg';
        blob = await new Promise(resolve => drawCanvas.toBlob(resolve, mimeType, qualityValue));
      }
      const buffer = new Uint8Array(await blob.arrayBuffer());
      let binary = '';
      buffer.forEach(b => (binary += String.fromCharCode(b)));
      const base64data = btoa(binary);
      frameHandler({ data: base64data, width: drawCanvas.width, height: drawCanvas.height, mimeType });
    } finally {
      reader.read().then(processFrame);
    }
  }

  reader.read().then(processFrame);

  function stop() {
    reader.cancel();
    track.stop();
    stream.getTracks().forEach(t => t.stop());
  }

  return { stop, onFrame };
}

export default startScreenCapture;

