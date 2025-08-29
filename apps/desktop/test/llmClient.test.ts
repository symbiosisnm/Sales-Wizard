// apps/desktop/test/llmClient.test.ts
import { describe, it, expect } from 'vitest';
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
});
