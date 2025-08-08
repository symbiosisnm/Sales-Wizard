import { describe, it, expect } from 'vitest';
import { segmentAudio } from '../src/services/transcription.js';

describe('transcription segmentation', () => {
  it('splits buffer into 2s windows', () => {
    const sampleRate = 16000;
    const seconds = 5;
    const buffer = Buffer.alloc(sampleRate * seconds * 2);
    const segments = segmentAudio(buffer, sampleRate, 2);
    expect(segments.length).toBe(3);
  });
});
