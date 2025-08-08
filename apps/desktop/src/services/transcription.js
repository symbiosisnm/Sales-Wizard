import { spawn } from 'child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import fs from 'node:fs/promises';

let config = { modelPath: '', language: 'en', enableCloudFallback: false };

export function init(opts) {
  config = { ...config, ...opts };
}

export function segmentAudio(buffer, sampleRate = 16000, windowSeconds = 2) {
  const windowSize = sampleRate * windowSeconds * 2; // PCM16 bytes
  const segments = [];
  for (let i = 0; i < buffer.length; i += windowSize) {
    segments.push(buffer.slice(i, i + windowSize));
  }
  return segments;
}

export async function transcribePcm16(buffer, sampleRate = 16000) {
  const file = join(tmpdir(), `whisper-${Date.now()}.wav`);
  await fs.writeFile(file, buffer);
  return new Promise((resolve, reject) => {
    const args = ['-m', config.modelPath, '-l', config.language, '-f', file, '-otxt'];
    const proc = spawn('whisper', args);
    let out = '';
    proc.stdout.on('data', d => (out += d.toString()));
    proc.on('error', err => {
      if (config.enableCloudFallback) {
        resolve({ text: '', segments: [] });
      } else {
        reject(err);
      }
    });
    proc.on('close', () => {
      resolve({ text: out.trim(), segments: [] });
    });
  });
}
