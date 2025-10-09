// Unified LLM client for live interactions over WebSocket.
// Mirrors the desktop implementation but with browser-friendly defaults.

import { resolveLiveWsUrl } from './backendConfig.js';

const DEFAULT_WS = resolveLiveWsUrl();

export class LLMClient {
    /** @type {WebSocket|null} */
    ws = null;
    /** @type {(txt:string)=>void} */
    onText = () => {};
    /** @type {(status:string,payload?:Record<string,unknown>)=>void} */
    onStatus = () => {};
    /** @type {(message:string,payload?:unknown)=>void} */
    onError = () => {};
    /** @type {(data:string,mime:string)=>void} */
    onAudio = () => {};

    constructor({ url = DEFAULT_WS } = {}) {
        this.url = url;
    }

    connect({ model = 'gemini-2.0-flash-live-001', responseModalities = ['TEXT'], systemInstruction } = {}) {
        return new Promise((resolve, reject) => {
            try {
                this.ws = new WebSocket(this.url);
                let opened = false;
                const timeout = setTimeout(() => {
                    if (!opened) {
                        const msg = 'WS open timeout';
                        this.onError(msg);
                        this._safeClose();
                        reject(new Error(msg));
                    }
                }, 10_000);

                this.ws.onopen = () => {
                    opened = true;
                    clearTimeout(timeout);
                    const instr = systemInstruction ?? this._buildSystemInstruction();
                    this._send({
                        type: 'start',
                        model,
                        responseModalities,
                        systemInstruction: instr,
                    });
                    this._emitStatus('WS open', { connection: 'connected', open: true });
                    resolve(true);
                };

                this.ws.onclose = evt => {
                    this._emitStatus('WS closed', {
                        connection: 'disconnected',
                        code: evt?.code,
                        reason: evt?.reason,
                        terminal: true,
                    });
                    if (!opened) {
                        clearTimeout(timeout);
                        const msg = 'WS closed before open';
                        this.onError(msg);
                        reject(new Error(msg));
                    }
                };

                this.ws.onerror = e => {
                    const msg = `WS error: ${e?.message || String(e)}`;
                    this._emitStatus('WS error', { connection: 'error', error: e, message: msg });
                    this.onError(msg, e);
                    if (!opened) {
                        clearTimeout(timeout);
                        reject(new Error(msg));
                    }
                };

                this.ws.onmessage = evt => {
                    const parsed = this._safeParse(evt?.data);
                    if (!parsed) return;
                    this._handleIncoming(parsed);
                };
            } catch (e) {
                reject(e);
            }
        });
    }

    _buildSystemInstruction() {
        try {
            if (typeof localStorage === 'undefined') return undefined;
            const allowedSources = localStorage.getItem('contextAllowedSources') || '';
            const toneLength = localStorage.getItem('contextToneLength') || '';
            const disallowedTopics = localStorage.getItem('contextDisallowedTopics') || '';
            const parts = [];
            if (allowedSources) parts.push(`Allowed sources: ${allowedSources}.`);
            if (toneLength) parts.push(`Tone/Length: ${toneLength}.`);
            if (disallowedTopics) parts.push(`Disallowed topics: ${disallowedTopics}.`);
            return parts.join(' ');
        } catch (e) {
            return undefined;
        }
    }

    _send(obj) {
        try {
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.ws.send(JSON.stringify(obj));
            }
        } catch (e) {
            /* empty */
        }
    }

    _emitStatus(message, payload = {}) {
        try {
            this.onStatus(message, { ...payload, message });
        } catch (e) {
            /* empty */
        }
    }

    _safeParse(raw) {
        if (!raw) return null;
        try {
            return typeof raw === 'string' ? JSON.parse(raw) : JSON.parse(String(raw));
        } catch (e) {
            this.onError('Failed to parse message', { raw, error: e });
            return null;
        }
    }

    _handleIncoming(msg) {
        switch (msg?.type) {
            case 'status':
                this._emitStatus(msg.message ?? msg.msg ?? '', msg);
                break;
            case 'error':
                this.onError(msg.message ?? msg.msg ?? 'Unknown error', msg);
                break;
            case 'model_text':
                if (typeof msg.text === 'string') {
                    this.onText(msg.text);
                }
                break;
            case 'model_audio':
                if (typeof msg.data === 'string') {
                    this.onAudio(msg.data, msg.mime || 'audio/pcm;rate=16000');
                }
                break;
            default:
                this._emitStatus('Unhandled message', msg || {});
                break;
        }
    }

    _safeClose() {
        try {
            this.ws?.close();
        } catch (e) {
            /* empty */
        }
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
        this._safeClose();
    }
}
