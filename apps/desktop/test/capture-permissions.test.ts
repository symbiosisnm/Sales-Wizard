// apps/desktop/test/capture-permissions.test.ts
import { describe, it, expect, vi } from 'vitest';
import { AudioCapture } from '../src/utils/AudioCapture';
import { ScreenCapture } from '../src/utils/ScreenCapture';

// Helpers to restore globals after tests
function restore() {
  vi.unstubAllGlobals();
}

describe('AudioCapture permission denials', () => {
  it('calls onError and cleans up when getUserMedia is denied', async () => {
    const err = new Error('denied');
    const onError = vi.fn();
    const closeFn = vi.fn().mockResolvedValue(undefined);
    class MockAudioContext {
      audioWorklet = { addModule: vi.fn().mockResolvedValue(undefined) };
      close = closeFn;
    }
    vi.stubGlobal('AudioContext', MockAudioContext as any);
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: vi.fn().mockRejectedValue(err) } });

    const ac = new AudioCapture({ onError });
    await expect(ac.start()).rejects.toThrow('denied');
    expect(onError).toHaveBeenCalledWith(err);
    expect(closeFn).toHaveBeenCalled();
    // @ts-ignore accessing private for test
    expect(ac['ctx']).toBeNull();
    restore();
  });
});

describe('ScreenCapture permission denials', () => {
  it('calls onError when getDisplayMedia is denied', async () => {
    const err = new Error('denied');
    const onError = vi.fn();
    vi.stubGlobal('navigator', { mediaDevices: { getDisplayMedia: vi.fn().mockRejectedValue(err) } });
    vi.stubGlobal('document', { createElement: () => ({ getContext: () => ({}) }) });

    const sc = new ScreenCapture({ fps: 1, onError });
    await expect(sc.start()).rejects.toThrow('denied');
    expect(onError).toHaveBeenCalledWith(err);
    restore();
  });
});
