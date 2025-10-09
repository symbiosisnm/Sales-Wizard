import { describe, it, expect, afterEach } from 'vitest';
import '../NoteStreamPanel.js';

describe('NoteStreamPanel', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('renders notes pushed through helper methods', async () => {
    const el = document.createElement('note-stream-panel');
    document.body.appendChild(el);

    el.addNote('First');
    el.addNote('Second');
    await el.updateComplete;

    const notes = Array.from(el.shadowRoot.querySelectorAll('.note-item')).map(item => item.textContent.trim());
    expect(notes).toEqual(['First', 'Second']);

    el.clear();
    await el.updateComplete;
    expect(el.shadowRoot.querySelectorAll('.note-item')).toHaveLength(0);
  });
});
