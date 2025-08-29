// apps/desktop/src/services/llmClient.ts
// Unified LLM client over WS -> our backend /ws/live.
// No OpenAI anywhere.

const DEFAULT_WS = (import.meta.env.VITE_SERVER_URL || 'http://localhost:8787')
  .replace('http', 'ws')
  .replace('https', 'wss') + '/ws/live';

export interface LLMClientOptions {
  url?: string;
}

export interface ConnectConfig {
  model?: string;
  responseModalities?: string[];
  systemInstruction?: string;
}

export type TextCallback = (txt: string) => void;
export type StatusCallback = (s: string) => void;
export type ErrorCallback = (e: string) => void;
export type AudioCallback = (data: string, mime: string) => void;

export type OutgoingMessage =
  | { type: 'start'; model: string; responseModalities: string[]; systemInstruction?: string }
  | { type: 'text'; text: string }
  | { type: 'audio'; data: string; mime: string }
  | { type: 'image'; data: string; mime: string }
  | { type: 'end' };

export type IncomingMessage =
  | { type: 'status'; msg: string }
  | { type: 'error'; msg: string }
  | { type: 'model_text'; text: string }
  | { type: 'model_audio'; data: string; mime: string };

export class LLMClient {
  private ws: WebSocket | null = null;
  private url: string;

  onText: TextCallback = () => {};
  onStatus: StatusCallback = () => {};
  onError: ErrorCallback = () => {};
  onAudio: AudioCallback = () => {};

  constructor({ url = DEFAULT_WS }: LLMClientOptions = {}) {
    this.url = url;
  }

  connect({
    model = import.meta.env.VITE_MODEL || 'gemini-2.0-flash-live-001',
    responseModalities = (import.meta.env.VITE_RESPONSE_MODALITIES || 'TEXT').split(','),
    systemInstruction,
  }: ConnectConfig = {}): Promise<boolean> {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.url);
        this.ws.onopen = () => {
          this._send({ type: 'start', model, responseModalities, systemInstruction });
          this.onStatus('WS open');
          resolve(true);
        };
        this.ws.onclose = () => this.onStatus('WS closed');
        this.ws.onerror = (e: any) => this.onError(`WS error: ${e?.message || String(e)}`);
        this.ws.onmessage = (evt: MessageEvent<string>) => {
          try {
            const msg: IncomingMessage = JSON.parse(evt.data);
            if (msg.type === 'status') this.onStatus(msg.msg);
            else if (msg.type === 'error') this.onError(msg.msg);
            else if (msg.type === 'model_text') this.onText(msg.text);
            else if (msg.type === 'model_audio') this.onAudio(msg.data, msg.mime);
          } catch {}
        };
      } catch (e) {
        reject(e);
      }
    });
  }

  private _send(obj: OutgoingMessage): void {
    try {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify(obj));
      }
    } catch {}
  }

  sendText(text: string): void {
    this._send({ type: 'text', text });
  }

  sendPcm16Base64(base64: string, mime: string = 'audio/pcm;rate=16000'): void {
    this._send({ type: 'audio', data: base64, mime });
  }

  sendJpegBase64(base64: string, mime: string = 'image/jpeg'): void {
    this._send({ type: 'image', data: base64, mime });
  }

  end(): void {
    this._send({ type: 'end' });
    try {
      this.ws?.close();
    } catch {}
  }
}
