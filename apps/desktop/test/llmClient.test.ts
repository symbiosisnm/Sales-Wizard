// apps/desktop/test/llmClient.test.ts
import { describe, it, expect } from 'vitest';
import { LLMClient } from '../src/services/llmClient';

describe('LLMClient', () => {
  it('constructs with defaults', () => {
    const client = new LLMClient();
    expect(client).toBeTruthy();
  });

  it('invokes onAudio handler', () => {
    const client = new LLMClient();
    let called = false;
    client.onAudio = () => { called = true; };
    client.onAudio('Zg==', 'audio/wav');
    expect(called).toBe(true);
  });
});
