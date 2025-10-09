export function generateNotesFromResponse(resp) {
  try {
    const text = typeof resp === 'string' ? resp : resp?.text || '';
    const trimmed = text.trim();
    if (!trimmed) return null;
    const now = Date.now();
    return {
      id: now.toString(36),
      text: trimmed,
      timestamp: now,
      type: 'auto',
    };
  } catch (e) {
    return null;
  }
}

