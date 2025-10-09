// Unified LLM client for live interactions over WebSocket.
// Mirrors the desktop implementation but with browser-friendly defaults.

import { resolveLiveWsUrl } from './backendConfig.js';
import defaultLogger from '../utils/logger.js';

const DEFAULT_WS = resolveLiveWsUrl();
const getLogger = () => globalThis.logger || defaultLogger || console;
const MAX_PAYLOAD_LOG_LENGTH = 512;

const describePayload = payload => {
    if (typeof payload !== 'string') return '[unserializable payload]';
    return payload.length > MAX_PAYLOAD_LOG_LENGTH
        ? `${payload.slice(0, MAX_PAYLOAD_LOG_LENGTH)}…`
        : payload;
};

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
                this._emitStatus({ connection: 'connecting', message: 'Opening WebSocket' });
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
                    const instr = systemInstruction || this._buildSystemInstruction();
                    this.onStatus('WS open');
                    this._send({
                        type: 'start',
                        model,
                        responseModalities,
                        systemInstruction: instr,
                    });
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
        const log = getLogger();
        let payload;
        try {
            payload = JSON.stringify(obj);
        } catch (err) {
            const msg = `Unable to serialise payload for send: ${err?.message || err}`;
            log.error(msg, err);
            this.onError(msg);
            return;
        }

        const payloadPreview = describePayload(payload);

        if (!this.ws) {
            const msg = `Cannot send message, WebSocket not initialised. Payload: ${payloadPreview}`;
            log.warn(msg);
            this.onError(msg);
            return;
        }

        if (this.ws.readyState !== WebSocket.OPEN) {
            const msg = `Cannot send message, WebSocket state ${this.ws.readyState}. Payload: ${payloadPreview}`;
            log.warn(msg);
            this.onError(msg);
            return;
        }

        try {
            this.ws.send(payload);
        } catch (err) {
            const msg = `WebSocket send failed: ${err?.message || err}. Payload: ${payloadPreview}`;
            log.error(msg, err);
            this.onError(msg);
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
