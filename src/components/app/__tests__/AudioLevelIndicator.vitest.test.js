import { describe, it, expect, afterEach } from 'vitest';
import '../AudioLevelIndicator.js';

describe('AudioLevelIndicator', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('clamps the audio level between 0 and 100 percent', async () => {
    const el = document.createElement('audio-level-indicator');
    document.body.appendChild(el);

    el.level = 1.2;
    await el.updateComplete;
    let level = el.shadowRoot.querySelector('.level');
    expect(level.style.width).toBe('100%');

    el.level = -0.5;
    await el.updateComplete;
    level = el.shadowRoot.querySelector('.level');
    expect(level.style.width).toBe('0%');
  });

  it('updates width when level changes', async () => {
    const el = document.createElement('audio-level-indicator');
    document.body.appendChild(el);

    el.level = 0.42;
    await el.updateComplete;
    const level = el.shadowRoot.querySelector('.level');
    expect(level.style.width).toBe('42%');
  });
});
