function handleInput(frame) {
  switch (frame.type) {
    case 'input_text':
      return { type: 'text', text: frame.text };
    case 'input_audio_buffer':
      return { type: 'audio', data: frame.data ?? null };
    case 'input_image':
      return { type: 'image', data: frame.data ?? null };
    default:
      return null;
  }
}

module.exports = { handleInput };
