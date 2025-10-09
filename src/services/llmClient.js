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
                    this.onStatus('WS open');
                    this._send({
                        type: 'start',
                        model,
                        responseModalities,
                        systemInstruction: instr,
                    });
                    resolve(true);
                };
                this.ws.onclose = () => {
                    this.onStatus('WS closed');
                    if (!opened) {
                        clearTimeout(timeout);
                        const msg = 'WS closed before open';
                        this.onError(msg);
                        reject(new Error(msg));
                    }
                };
                this.ws.onerror = e => {
                    const msg = `WS error: ${e?.message || String(e)}`;
                    this.onError(msg);
                    if (!opened) {
                        clearTimeout(timeout);
                        reject(new Error(msg));
                    }
                };
                this.ws.onmessage = evt => {
                    try {
                        const msg = JSON.parse(evt.data);
                        if (msg.type === 'status') this.onStatus(msg.msg);
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
