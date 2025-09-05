export async function startScreenCapture({ intervalMs = 1000, quality = 'medium', cropRegion = 'full' } = {}) {
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

    if (cropRegion === 'cursor') startCursorTracking();

    // Obtain screen media
    const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
            frameRate: 1,
            width: { ideal: 1920 },
            height: { ideal: 1080 },
        },
        audio: false,
    });

    const video = document.createElement('video');
    video.srcObject = stream;
    video.muted = true;
    video.playsInline = true;
    await video.play();
    await new Promise(resolve => {
        if (video.readyState >= 2) return resolve();
        video.onloadedmetadata = () => resolve();
    });

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');

    let frameHandler = () => {};
    function onFrame(cb) {
        frameHandler = cb;
    }

    function captureFrame() {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
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
        }

        let qualityValue;
        switch (quality) {
            case 'high':
                qualityValue = 0.9;
                break;
            case 'low':
                qualityValue = 0.5;
                break;
            case 'medium':
            default:
                qualityValue = 0.7;
        }

        let mimeType = 'image/webp';
        let dataUrl = drawCanvas.toDataURL(mimeType, qualityValue);
        if (!dataUrl.startsWith('data:image/webp')) {
            mimeType = 'image/jpeg';
            dataUrl = drawCanvas.toDataURL(mimeType, qualityValue);
        }
        const base64data = dataUrl.split(',')[1];
        frameHandler({ data: base64data, width: drawCanvas.width, height: drawCanvas.height, mimeType });
    }

    const intervalId = setInterval(captureFrame, intervalMs);
    setTimeout(captureFrame, 100);

    function stop() {
        clearInterval(intervalId);
        stream.getTracks().forEach(t => t.stop());
    }

    return { stop, onFrame };
}

export default startScreenCapture;
