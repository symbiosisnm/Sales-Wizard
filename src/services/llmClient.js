// Unified LLM client for live interactions over WebSocket.
// Mirrors the desktop implementation but with browser-friendly defaults.

const DEFAULT_WS = 'ws://localhost:8787/ws/live';

export class LLMClient {
    /** @type {WebSocket|null} */
    ws = null;
    /** @type {(txt:string)=>void} */
    onText = () => {};
    /** @type {(s:string)=>void} */
    onStatus = () => {};
    /** @type {(s:string)=>void} */
    onConnectionStatus = () => {};
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
                this.onConnectionStatus('connecting');
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
                    this._send({
                        type: 'start',
                        model,
                        responseModalities,
                        systemInstruction: instr,
                    });
                    this.onStatus('WS open');
                    this.onConnectionStatus('connected');
                    resolve(true);
                };
                this.ws.onclose = () => {
                    this.onStatus('WS closed');
                    this.onConnectionStatus('disconnected');
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
                    this.onConnectionStatus('error');
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
