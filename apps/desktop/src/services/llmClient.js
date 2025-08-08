// apps/desktop/src/services/llmClient.js
// Unified LLM client over WS -> our backend /ws/live.
// No OpenAI anywhere.

const DEFAULT_WS = (import.meta.env.VITE_SERVER_URL || 'http://localhost:8787')
  .replace('http', 'ws')
  .replace('https', 'wss') + '/ws/live';

export class LLMClient {
  /** @type {WebSocket | null} */
  ws = null;
  /** @type {(txt:string)=>void} */
  onText = () => {};
  /** @type {(s:string)=>void} */
  onStatus = () => {};
  /** @type {(e:string)=>void} */
  onError = () => {};
  /** @type {(data:string, mime:string)=>void} */
  onAudio = () => {};

  constructor({ url = DEFAULT_WS } = {}) {
    this.url = url;
  }

  connect({ model = (import.meta.env.VITE_MODEL || 'gemini-2.0-flash-live-001'),
            responseModalities = (import.meta.env.VITE_RESPONSE_MODALITIES || 'TEXT').split(','),
            systemInstruction } = {}) {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.url);
        this.ws.onopen = () => {
          this._send({
            type: 'start',
            model,
            responseModalities,
            systemInstruction,
          });
          this.onStatus('WS open');
          resolve(true);
        };
        this.ws.onclose = () => this.onStatus('WS closed');
        this.ws.onerror = (e) => this.onError(`WS error: ${e?.message || String(e)}`);
        this.ws.onmessage = (evt) => {
          try {
            const msg = JSON.parse(evt.data);
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

  _send(obj) {
    try {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify(obj));
      }
    } catch {}
  }

  sendText(text) {
    this._send({ type: 'text', text });
  }

  sendPcm16Base64(base64, mime = 'audio/pcm;rate=16000') {
    this._send({ type: 'audio', data: base64, mime });
  }

  sendJpegBase64(base64, mime = 'image/jpeg') {
    this._send({ type: 'image', data: base64, mime });
  }

  end() {
    this._send({ type: 'end' });
    try { this.ws?.close(); } catch {}
  }
}
