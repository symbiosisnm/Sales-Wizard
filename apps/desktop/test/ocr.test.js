import { describe, it, expect } from 'vitest';
import { init, recognize } from '../src/services/ocr.js';

// Small "hello" PNG encoded as base64 to avoid binary fixtures in git
const HELLO_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAGQAAAAUBAMAAACJ7oWmAAAAG1BMVEUAAAD///9/f3+fn59fX1/f398fHx+/v78/Pz94CML9AAAACXBIWXMAAA7EAAAOxAGVKw4bAAAAdElEQVQoke3PMQqAMAyF4Yet6DGkk2MR6Vx6ktLBcwQt4rFN6+QWBxfxLf/0QQL8u6250lNPUqKuaNKvkjAjmVhIMjLVerVY2EIsnIh00NljYHJ4rLLDmEzGMcmEJCZU339CdlsJZ5QS2oIv73NEpC7e8t2doB0YR0ncqXMAAAAASUVORK5CYII=';

describe.skip('ocr service', () => {
  it('recognizes hello text', async () => {
    await init(1);
    const img = Buffer.from(HELLO_PNG_BASE64, 'base64');
    const result = await recognize(img);
    expect(result.text.toLowerCase()).toContain('hello');
  });
});
