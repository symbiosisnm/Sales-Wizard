// apps/desktop/src/services/ocr.ts
import Tesseract from 'tesseract.js';

/**
 * Run OCR on a JPEG/PNG bytes (Uint8Array) and return plain text.
 */
export async function ocrBytes(bytes: Uint8Array, lang = 'eng'): Promise<string> {
  if (!bytes.length) return '';
  const blob = new Blob([bytes], { type: 'image/jpeg' });
  const url = URL.createObjectURL(blob);
  try {
    const { data: { text } } = await Tesseract.recognize(url, lang, {
      // A light config; you can extend to control OEM/PSM if needed
      logger: () => {}
    });
    return (text || '').trim();
  } finally {
    URL.revokeObjectURL(url);
  }
}
