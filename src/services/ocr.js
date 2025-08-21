/**
 * OCR service for Cheating Daddy.
 * Accepts a base64-encoded PNG and returns recognized text using Tesseract.js.
 */
export async function ocrBase64(base64) {
  try {
    if (typeof base64 !== 'string' || base64.trim() === '') {
      throw new Error('Invalid image data');
    }

    // Support both raw base64 and data URLs
    const cleaned = base64.includes(',') ? base64.split(',')[1] : base64;

    const buffer = Buffer.from(cleaned, 'base64');
    if (!buffer.length) {
      throw new Error('Invalid image data');
    }

    const { default: Tesseract } = await import('tesseract.js');
    const {
      data: { text }
    } = await Tesseract.recognize(buffer, 'eng');

    return (text || '').trim();
  } catch (error) {
    console.error('OCR error:', error);
    throw new Error('OCR failed: ' + error.message);
  }
}
