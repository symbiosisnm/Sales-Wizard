/**
 * Client for interacting with the backend `/live` WebSocket.
 * Handles connection lifecycle, buffers outbound frames until the socket
 * is ready and forwards server responses to consumer callbacks.
 */

const DEFAULT_URL = 'ws://localhost:3001/live';

export class LiveSession {
    /**
     * @param {Object} [opts]
     * @param {string} [opts.url] WebSocket endpoint
     * @param {(text:string)=>void} [opts.onText] callback for server text
     * @param {(status:string)=>void} [opts.onStatus] status updates
     * @param {(err:string)=>void} [opts.onError] error callback
     */
    constructor({ url = DEFAULT_URL, onText = () => {}, onStatus = () => {}, onError = () => {} } = {}) {
        this.url = url;
        this.onText = onText;
        this.onStatus = onStatus;
        this.onError = onError;
        /** @type {WebSocket|null} */
        this.ws = null;
        /** @type {string[]} */
        this.queue = [];
        this._connect();
    }

    _connect() {
        try {
            this.ws = new WebSocket(this.url);
            this.ws.onopen = () => {
                this.onStatus('connected');
                this._flush();
            };
            this.ws.onmessage = evt => {
                try {
                    const msg = JSON.parse(evt.data);
                    if (msg.text) this.onText(msg.text);
                } catch (err) {
                    this.onError('Invalid message: ' + err.message);
                }
            };
            this.ws.onerror = err => {
                this.onError(err?.message || String(err));
            };
            this.ws.onclose = () => {
                this.onStatus('closed');
            };
        } catch (err) {
            this.onError(err?.message || String(err));
        }
    }

    _flush() {
        while (this.queue.length && this.ws && this.ws.readyState === WebSocket.OPEN) {
            const msg = this.queue.shift();
            this.ws.send(msg);
        }
    }

    _enqueue(obj) {
        const msg = JSON.stringify(obj);
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(msg);
        } else {
            this.queue.push(msg);
        }
    }

    async _encode(data) {
        if (typeof data === 'string') {
            return data.includes(',') ? data.split(',')[1] : data;
        }
        if (data instanceof ArrayBuffer) {
            return this._toBase64(new Uint8Array(data));
        }
        if (ArrayBuffer.isView(data)) {
            return this._toBase64(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
        }
        if (typeof Blob !== 'undefined' && data instanceof Blob) {
            const buf = await data.arrayBuffer();
            return this._toBase64(new Uint8Array(buf));
        }
        throw new Error('Unsupported data type');
    }

    _toBase64(u8) {
        if (typeof Buffer !== 'undefined') {
            return Buffer.from(u8).toString('base64');
        }
        let binary = '';
        for (let i = 0; i < u8.length; i++) binary += String.fromCharCode(u8[i]);
        return btoa(binary);
    }

    /**
     * Send an audio frame to the backend.
     * @param {ArrayBuffer|TypedArray|Blob|string} data
     * @param {string} [mimeType='audio/pcm;rate=16000']
     */
    async sendAudio(data, mimeType = 'audio/pcm;rate=16000') {
        try {
            const base64 = await this._encode(data);
            this._enqueue({ audio: base64, mimeType });
        } catch (err) {
            this.onError('sendAudio failed: ' + err.message);
        }
    }

    /**
     * Send an image frame to the backend.
     * @param {ArrayBuffer|TypedArray|Blob|string} data
     * @param {string} [mimeType='image/jpeg']
     */
    async sendImage(data, mimeType = 'image/jpeg') {
        try {
            const base64 = await this._encode(data);
            this._enqueue({ image: base64, mimeType });
        } catch (err) {
            this.onError('sendImage failed: ' + err.message);
        }
    }

    /** Close the WebSocket session. */
    close() {
        try {
            this.ws?.close();
        } catch (err) {
            /* empty */
        }
        this.ws = null;
        this.queue = [];
        this.onStatus('closed');
    }
}

export default LiveSession;
