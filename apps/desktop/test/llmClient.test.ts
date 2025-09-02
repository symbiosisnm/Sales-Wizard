// apps/desktop/test/llmClient.test.ts
import { describe, it, expect, vi } from 'vitest';
import WebSocket, { WebSocketServer } from 'ws';
import { LLMClient } from '../src/services/llmClient';

(globalThis as any).WebSocket = WebSocket;

describe('LLMClient', () => {
  it('connects and sends start message', async () => {
    const wss = new WebSocketServer({ port: 0 });
    const port = (wss.address() as any).port;
    const client = new LLMClient({ url: `ws://localhost:${port}` });

    const startMsg = new Promise<any>((resolve) => {
      wss.on('connection', (ws) => {
        ws.once('message', (data) => resolve(JSON.parse(data.toString())));
      });
    });

    await client.connect({ model: 'foo', responseModalities: ['TEXT'], systemInstruction: 'bar' });
    const msg = await startMsg;

    expect(msg).toEqual({
      type: 'start',
      model: 'foo',
      responseModalities: ['TEXT'],
      systemInstruction: 'bar',
    });

    client.end();
    wss.close();
  });

  it('handles incoming messages', async () => {
    const wss = new WebSocketServer({ port: 0 });
    const port = (wss.address() as any).port;
    const client = new LLMClient({ url: `ws://localhost:${port}` });

    const statuses: string[] = [];
    const texts: string[] = [];
    const audios: { data: string; mime: string }[] = [];
    const errors: string[] = [];

    client.onStatus = (s) => statuses.push(s);
    client.onText = (t) => texts.push(t);
    client.onAudio = (d, m) => audios.push({ data: d, mime: m });
    client.onError = (e) => errors.push(e);

    wss.on('connection', (ws) => {
      ws.on('message', () => {
        ws.send(JSON.stringify({ type: 'status', msg: 'ok' }));
        ws.send(JSON.stringify({ type: 'error', msg: 'bad' }));
        ws.send(JSON.stringify({ type: 'model_text', text: 'hi' }));
        ws.send(JSON.stringify({ type: 'model_audio', data: 'Zg==', mime: 'audio/wav' }));
      });
    });

    await client.connect();
    await new Promise((res) => setTimeout(res, 20));

    expect(statuses).toContain('ok');
    expect(errors).toContain('bad');
    expect(texts).toContain('hi');
    expect(audios).toContainEqual({ data: 'Zg==', mime: 'audio/wav' });

    client.end();
    wss.close();
  });

  it('emits onError when websocket errors', async () => {
    const wss = new WebSocketServer({ port: 0 });
    const port = (wss.address() as any).port;
    const client = new LLMClient({ url: `ws://localhost:${port}` });

    let msg = '';
    client.onError = (m) => { msg = m; };

    await client.connect();
    (client as any).ws.emit('error', new Error('boom'));
    await new Promise((res) => setTimeout(res, 20));

    expect(msg).toContain('boom');

    client.end();
    wss.close();
  });

  it('rejects with timeout if onopen never fires', async () => {
    const originalWS = WebSocket;
    vi.useFakeTimers();

    class HangingWS {
      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSING = 2;
      static CLOSED = 3;
      onopen: (() => void) | null = null;
      onclose: (() => void) | null = null;
      onerror: ((e: any) => void) | null = null;
      onmessage: ((e: any) => void) | null = null;
      readyState = HangingWS.CONNECTING;
      constructor(_url: string) {}
      send() {}
      close() { this.readyState = HangingWS.CLOSED; }
    }

    (globalThis as any).WebSocket = HangingWS as any;

    const client = new LLMClient({ url: 'ws://timeout' });
    const errors: string[] = [];
    client.onError = (e) => errors.push(e);

    const promise = client.connect();
    const expectation = expect(promise).rejects.toThrow(/timeout/i);
    await vi.advanceTimersByTimeAsync(10_000);
    await expectation;
    expect(errors.some((e) => e.toLowerCase().includes('timeout'))).toBe(true);

    (globalThis as any).WebSocket = originalWS;
    vi.useRealTimers();
  });

  it('rejects if websocket closes before open', async () => {
    const originalWS = WebSocket;
    vi.useFakeTimers();

    class ClosingWS {
      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSING = 2;
      static CLOSED = 3;
      onopen: (() => void) | null = null;
      onclose: (() => void) | null = null;
      onerror: ((e: any) => void) | null = null;
      onmessage: ((e: any) => void) | null = null;
      readyState = ClosingWS.CONNECTING;
      constructor(_url: string) {
        setTimeout(() => {
          this.readyState = ClosingWS.CLOSED;
          this.onclose?.({ code: 1006 } as any);
        }, 0);
      }
      send() {}
      close() { this.readyState = ClosingWS.CLOSED; }
    }

    (globalThis as any).WebSocket = ClosingWS as any;

    const client = new LLMClient({ url: 'ws://closed' });
    const errors: string[] = [];
    client.onError = (e) => errors.push(e);

    const promise = client.connect();
    const expectation = expect(promise).rejects.toThrow(/closed/i);
    await vi.runAllTimersAsync();
    await expectation;
    expect(errors.some((e) => e.toLowerCase().includes('closed'))).toBe(true);

    (globalThis as any).WebSocket = originalWS;
    vi.useRealTimers();
  });
});
