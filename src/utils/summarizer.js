export function generateNotesFromResponse(resp) {
  try {
    const text = typeof resp === 'string' ? resp : resp?.text || '';
    const trimmed = text.trim();
    if (!trimmed) return null;
    return {
      id: Date.now().toString(36),
      text: trimmed,
      timestamp: Date.now(),
    };
  } catch (e) {
    return null;
  }
}

