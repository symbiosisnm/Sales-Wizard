const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ffmpegStatic = require('ffmpeg-static');
const ffprobeStatic = require('ffprobe-static');

const { ensureDir, resolveKnowledgePaths } = require('./appData');

function getFfmpegPath() {
  return String(process.env.FFMPEG_PATH || ffmpegStatic || '').trim();
}

function getFfprobePath() {
  return String(process.env.FFPROBE_PATH || ffprobeStatic.path || '').trim();
}

function hasBundledFfmpeg() {
  return Boolean(getFfmpegPath() && getFfprobePath());
}

function runBinary(binaryPath, args, label) {
  return new Promise((resolve, reject) => {
    const child = spawn(binaryPath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', chunk => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', chunk => {
      stderr += chunk.toString();
    });

    child.on('error', reject);
    child.on('close', code => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new Error(`${label} failed with code ${code}: ${stderr || stdout}`));
    });
  });
}

async function runFfmpeg(args) {
  const binary = getFfmpegPath();
  if (!binary) {
    throw new Error('ffmpeg is not available');
  }
  return runBinary(binary, ['-y', ...args], 'ffmpeg');
}

async function runFfprobe(args) {
  const binary = getFfprobePath();
  if (!binary) {
    throw new Error('ffprobe is not available');
  }
  return runBinary(binary, args, 'ffprobe');
}

async function probeVideo(inputPath) {
  const { stdout } = await runFfprobe([
    '-v',
    'error',
    '-print_format',
    'json',
    '-show_streams',
    '-show_format',
    inputPath,
  ]);
  return JSON.parse(stdout || '{}');
}

function buildSampleTimes(durationSeconds, maxFrames = 6) {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return [0];
  }
  const count = Math.max(1, Math.min(8, maxFrames));
  const times = [];
  for (let index = 0; index < count; index += 1) {
    const progress = count === 1 ? 0.5 : (index + 1) / (count + 1);
    times.push(Number((durationSeconds * progress).toFixed(2)));
  }
  return times;
}

async function extractFramesAtTimes({
  inputPath,
  outputDir,
  maxFrames = 6,
  prefix = 'frame',
  width = 960,
}) {
  ensureDir(outputDir);
  const probe = await probeVideo(inputPath);
  const durationSeconds = Number(probe?.format?.duration || 0);
  const sampleTimes = buildSampleTimes(durationSeconds, maxFrames);
  const framePaths = [];

  for (let index = 0; index < sampleTimes.length; index += 1) {
    const time = sampleTimes[index];
    const outputPath = path.join(outputDir, `${prefix}-${String(index + 1).padStart(2, '0')}.jpg`);
    await runFfmpeg([
      '-ss',
      String(time),
      '-i',
      inputPath,
      '-frames:v',
      '1',
      '-vf',
      `scale='min(${width},iw)':-2`,
      outputPath,
    ]);
    framePaths.push(outputPath);
  }

  return {
    durationSeconds,
    framePaths,
    sampleTimes,
  };
}

function parseDataUrl(dataUrl) {
  const match = String(dataUrl || '').match(/^data:([^;]+);base64,(.+)$/);
  if (!match) {
    throw new Error('Invalid data URL');
  }
  return {
    mimeType: match[1],
    buffer: Buffer.from(match[2], 'base64'),
  };
}

async function createClipFromFrames({
  frames,
  outputDir = resolveKnowledgePaths().tempDir,
  clipName = `clip-${crypto.randomUUID()}`,
  fps = 1,
}) {
  if (!Array.isArray(frames) || !frames.length) {
    throw new Error('No frames provided to create clip');
  }

  ensureDir(outputDir);
  const frameDir = ensureDir(path.join(outputDir, `${clipName}-frames`));
  for (let index = 0; index < frames.length; index += 1) {
    const { buffer } = parseDataUrl(frames[index]);
    const framePath = path.join(frameDir, `frame-${String(index + 1).padStart(2, '0')}.jpg`);
    await fs.writeFile(framePath, buffer);
  }

  const clipPath = path.join(outputDir, `${clipName}.mp4`);
  await runFfmpeg([
    '-framerate',
    String(fps),
    '-i',
    path.join(frameDir, 'frame-%02d.jpg'),
    '-pix_fmt',
    'yuv420p',
    '-vcodec',
    'libx264',
    clipPath,
  ]);

  return {
    clipPath,
    frameDir,
  };
}

async function extractAudioTrack({
  inputPath,
  outputPath,
}) {
  await runFfmpeg([
    '-i',
    inputPath,
    '-vn',
    '-ac',
    '1',
    '-ar',
    '16000',
    '-f',
    'wav',
    outputPath,
  ]);
  return outputPath;
}

async function cleanupPaths(paths = []) {
  await Promise.all(
    paths.filter(Boolean).map(async targetPath => {
      try {
        await fs.rm(targetPath, { recursive: true, force: true });
      } catch (_error) {
        /* empty */
      }
    })
  );
}

module.exports = {
  cleanupPaths,
  createClipFromFrames,
  extractAudioTrack,
  extractFramesAtTimes,
  getFfmpegPath,
  getFfprobePath,
  hasBundledFfmpeg,
  probeVideo,
  runFfmpeg,
  runFfprobe,
};
