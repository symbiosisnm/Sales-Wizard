// apps/desktop/test/ocr.test.ts
import { describe, it, expect } from 'vitest';
import { ocrBytes } from '../src/services/ocr';

describe('OCR', () => {
  it('handles empty bytes', async () => {
    const txt = await ocrBytes(new Uint8Array([]));
    expect(typeof txt).toBe('string');
  });
});
