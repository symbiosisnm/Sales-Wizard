const MAX_FRAME_WIDTH = 960;
const VIDEO_FRAME_COUNT = 4;
const JPEG_QUALITY = 0.82;

function clampFrameWidth(width) {
  return Math.max(320, Math.min(MAX_FRAME_WIDTH, Math.round(width || MAX_FRAME_WIDTH)));
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return '';
  }
  return `${seconds.toFixed(1)}s`;
}

function createCanvas(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error('Failed to read file'));
    reader.onload = () => resolve(String(reader.result || ''));
    reader.readAsDataURL(file);
  });
}

async function loadVideo(file) {
  const objectUrl = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.preload = 'metadata';
  video.muted = true;
  video.playsInline = true;
  video.src = objectUrl;

  await new Promise((resolve, reject) => {
    const cleanup = () => {
      video.removeEventListener('loadedmetadata', handleLoadedMetadata);
      video.removeEventListener('error', handleError);
    };
    const handleLoadedMetadata = () => {
      cleanup();
      resolve();
    };
    const handleError = () => {
      cleanup();
      reject(video.error || new Error('Failed to load video metadata'));
    };
    video.addEventListener('loadedmetadata', handleLoadedMetadata, { once: true });
    video.addEventListener('error', handleError, { once: true });
  });

  return {
    objectUrl,
    video,
    cleanup: () => {
      try {
        video.pause();
      } catch (_err) {
        /* empty */
      }
      video.src = '';
      URL.revokeObjectURL(objectUrl);
    },
  };
}

function getSampleTimes(duration) {
  if (!Number.isFinite(duration) || duration <= 0) {
    return [0];
  }

  const rawTimes = [0.05, 0.3, 0.6, 0.88]
    .slice(0, VIDEO_FRAME_COUNT)
    .map(progress => Math.min(duration, Math.max(0, duration * progress)));

  return [...new Set(rawTimes.map(time => Number(time.toFixed(2))))];
}

async function seekVideo(video, time) {
  if (!Number.isFinite(time) || time < 0) {
    return;
  }

  const targetTime = Math.min(Math.max(0, time), Number.isFinite(video.duration) ? video.duration : time);
  if (Math.abs((video.currentTime || 0) - targetTime) < 0.01 && video.readyState >= 2) {
    return;
  }

  await new Promise((resolve, reject) => {
    const handleSeeked = () => {
      cleanup();
      resolve();
    };
    const handleError = () => {
      cleanup();
      reject(video.error || new Error('Failed to seek video'));
    };
    const cleanup = () => {
      video.removeEventListener('seeked', handleSeeked);
      video.removeEventListener('error', handleError);
    };
    video.addEventListener('seeked', handleSeeked, { once: true });
    video.addEventListener('error', handleError, { once: true });
    video.currentTime = targetTime;
  });
}

function captureVideoFrame(video, canvas) {
  const sourceWidth = video.videoWidth || 1280;
  const sourceHeight = video.videoHeight || 720;
  const width = clampFrameWidth(sourceWidth);
  const height = Math.max(180, Math.round((sourceHeight / sourceWidth) * width));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const ctx = canvas.getContext('2d', { alpha: false });
  ctx.drawImage(video, 0, 0, width, height);
  return canvas.toDataURL('image/jpeg', JPEG_QUALITY);
}

async function captureFrameAtTime(video, canvas, time) {
  await seekVideo(video, time);
  return captureVideoFrame(video, canvas);
}

export async function buildVisualContextFromFile(file, { onPreview } = {}) {
  if (!file) {
    return null;
  }

  const mimeType = String(file.type || '').toLowerCase();
  const name = file.name || 'visual-context';
  const label = name.replace(/\.[^.]+$/, '');

  if (mimeType.startsWith('image/')) {
    const dataUrl = await readFileAsDataUrl(file);
    return {
      filePath: file.path || '',
      kind: 'image',
      fileName: name,
      frameCount: 1,
      images: [dataUrl],
      label,
      mimeType,
      previewDataUrl: dataUrl,
      summary: `${name} - image`,
    };
  }

  if (!mimeType.startsWith('video/')) {
    throw new Error('Only image and video files are supported');
  }

  const { video, cleanup } = await loadVideo(file);
  const canvas = createCanvas(clampFrameWidth(video.videoWidth), Math.max(180, Math.round(video.videoHeight || 720)));

  try {
    const times = getSampleTimes(video.duration);
    const previewTime = times[Math.min(times.length - 1, Math.floor(times.length / 2))] ?? times[0] ?? 0;
    const previewDataUrl = await captureFrameAtTime(video, canvas, previewTime);
    if (typeof onPreview === 'function') {
      onPreview({
        durationSeconds: Number.isFinite(video.duration) ? Number(video.duration.toFixed(2)) : null,
        filePath: file.path || '',
        fileName: name,
        frameCount: 1,
        images: [previewDataUrl],
        kind: 'video',
        label,
        mimeType,
        previewDataUrl,
        processing: true,
        summary: `${name} - loading video context...`,
      });
    }

    const sampledFrames = [{ time: previewTime, dataUrl: previewDataUrl }];
    for (const time of times) {
      if (Math.abs(time - previewTime) < 0.01) {
        continue;
      }
      const dataUrl = await captureFrameAtTime(video, canvas, time);
      sampledFrames.push({ time, dataUrl });
    }

    sampledFrames.sort((a, b) => a.time - b.time);
    const frames = sampledFrames.map(frame => frame.dataUrl);
    return {
      durationSeconds: Number.isFinite(video.duration) ? Number(video.duration.toFixed(2)) : null,
      filePath: file.path || '',
      fileName: name,
      frameCount: frames.length,
      images: frames,
      kind: 'video',
      label,
      mimeType,
      previewDataUrl: previewDataUrl || frames[Math.floor(frames.length / 2)] || frames[0] || '',
      processing: false,
      summary: `${name} - ${frames.length} frames - ${formatDuration(video.duration) || 'video'}`,
    };
  } finally {
    cleanup();
  }
}
