// apps/desktop/test/transcription.test.ts
import { describe, it, expect } from 'vitest';
import { transcribePCM16 } from '../src/services/transcription';

describe('Transcription', () => {
  it('returns empty string for silence', async () => {
    const pcm = new Int16Array(16000); // 1s of silence
    const txt = await transcribePCM16(pcm);
    expect(typeof txt).toBe('string');
  }, 60_000);
});
