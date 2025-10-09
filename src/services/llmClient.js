// Unified LLM client for live interactions over WebSocket.
// Mirrors the desktop implementation but with browser-friendly defaults.

import { resolveLiveWsUrl } from './backendConfig.js';

const DEFAULT_WS = resolveLiveWsUrl();

export class LLMClient {
    /** @type {WebSocket|null} */
    ws = null;
    /** @type {(txt:string)=>void} */
    onText = () => {};
    /** @type {(s:string)=>void} */
    onStatus = () => {};
    /** @type {(e:string)=>void} */
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
                this._emitStatus({ connection: 'connecting', message: 'Opening WebSocket' });
                let opened = false;
                const timeout = setTimeout(() => {
                    if (!opened) {
                        const msg = 'WS open timeout';
                        this.onError(msg);
                        try {
                            this.ws?.close();
                        } catch (e) {
                            /* empty */
                        }
                        reject(new Error(msg));
                    }
                }, 10_000);

                this.ws.onopen = () => {
                    opened = true;
                    clearTimeout(timeout);
                    const instr = systemInstruction || this._buildSystemInstruction();
                    this._send({
                        type: 'start',
                        model,
                        responseModalities,
                        systemInstruction: instr,
                    });
                    this._emitStatus({ connection: 'connected', message: 'WS open' });
                    resolve(true);
                };
                this.ws.onclose = () => {
                    this._emitStatus({ connection: 'disconnected', message: 'WS closed' });
                    if (!opened) {
                        clearTimeout(timeout);
                        const msg = 'WS closed before open';
                        this.onError(msg);
                        reject(new Error(msg));
                    }
                };
                this.ws.onerror = e => {
                    const msg = `WS error: ${e?.message || String(e)}`;
                    this._emitStatus({ connection: 'error', message: msg });
                    this.onError(msg);
                    if (!opened) {
                        clearTimeout(timeout);
                        reject(new Error(msg));
                    }
                };
                this.ws.onmessage = evt => {
                    try {
                        const msg = JSON.parse(evt.data);
                        if (msg.type === 'status') this._emitStatus(this._formatStatusPayload(msg.msg));
                        else if (msg.type === 'error') this.onError(msg.msg);
                        else if (msg.type === 'model_text') this.onText(msg.text);
                        else if (msg.type === 'model_audio') this.onAudio(msg.data, msg.mime);
                    } catch (e) {
                        /* empty */
                    }
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

    _emitStatus(payload) {
        try {
            this.onStatus(payload);
        } catch (_e) {
            /* empty */
        }
    }

    _formatStatusPayload(status) {
        if (status && typeof status === 'object') {
            return {
                ...status,
                message: typeof status.message === 'string' ? status.message : status.msg || status.text || '',
            };
        }

        if (typeof status === 'string') {
            const payload = { message: status };
            const connection = this._inferState('connection', status);
            if (connection) payload.connection = connection;
            const audio = this._inferState('audio', status);
            if (audio) payload.audio = audio;
            const screen = this._inferState('screen', status);
            if (screen) payload.screen = screen;
            return payload;
        }

        return { message: status ? String(status) : '' };
    }

    _inferState(kind, message) {
        if (typeof message !== 'string') return null;
        if (kind === 'connection') {
            if (/(ws open|connected|ready|live session connected)/i.test(message)) return 'connected';
            if (/(connecting|opening|initialising|initializing)/i.test(message)) return 'connecting';
            if (/(closed|ended|disconnected|session closed)/i.test(message)) return 'disconnected';
            if (/(error|invalid|timeout|failed)/i.test(message)) return 'error';
        }
        if (kind === 'audio') {
            if (/(listening|microphone (active|streaming)|audio capture started)/i.test(message)) return 'capturing';
            if (/(microphone idle|audio capture stopped|microphone muted)/i.test(message)) return 'idle';
            if (/(audio|microphone).*(error|denied|failed)/i.test(message)) return 'error';
        }
        if (kind === 'screen') {
            if (/(screen capture (started|active)|sharing screen|screen streaming)/i.test(message)) return 'sharing';
            if (/(screen capture ended|stopped|screen idle)/i.test(message)) return 'idle';
            if (/(screen capture request was blocked|screen streaming failed|screen capture error)/i.test(message)) return 'error';
        }
        return null;
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
        try {
            this.ws?.close();
        } catch (e) {
            /* empty */
        }
    }
}
