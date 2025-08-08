// apps/desktop/src/services/transcription.ts
// Local ASR using @xenova/transformers Whisper.
// First run downloads the model into a cache directory.

import { pipeline, env } from '@xenova/transformers';

// Disable telemetry
env.localModelPath = undefined; // use default cache
env.allowLocalModels = true;

let _asr: any = null;

async function getASR() {
  if (_asr) return _asr;
  // small.en is a good balance; you can swap to tiny.en for faster
  _asr = await pipeline('automatic-speech-recognition', 'Xenova/whisper-small.en');
  return _asr;
}

/**
 * @param pcm16 - Int16Array PCM @16kHz mono
 * @returns {Promise<string>}
 */
export async function transcribePCM16(pcm16: Int16Array): Promise<string> {
  if (!pcm16.length || pcm16.every((v) => v === 0)) return '';
  const asr = await getASR();
  const float32 = new Float32Array(pcm16.length);
  for (let i = 0; i < pcm16.length; i++) float32[i] = Math.max(-1, Math.min(1, pcm16[i] / 32768));
  const out = await asr(float32, { chunk_length_s: 15, stride_length_s: 5, return_timestamps: false });
  const text = (typeof out === 'string') ? out : (out?.text || '');
  return text.trim();
}
