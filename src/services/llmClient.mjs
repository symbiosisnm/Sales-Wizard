// Browser-side client for the local `/live` WebSocket bridge.
// The backend owns the OpenAI Realtime connection so the browser never
// needs to hold a standard OpenAI API key directly.

function resolveDefaultWs() {
  if (typeof window !== 'undefined') {
    const host = window.location?.hostname || 'localhost';
    return `ws://${host}:3001/live`;
  }
  return 'ws://localhost:3001/live';
}

const DEFAULT_WS = resolveDefaultWs();

export class LLMClient {
    /** @type {WebSocket|null} */
    ws = null;
    intentionallyClosed = false;
    /** @type {(txt:string)=>void} */
    onText = () => {};
    /** @type {(s:string)=>void} */
    onStatus = () => {};
    /** @type {(e:string)=>void} */
    onError = () => {};
    /** @type {(data:string,mime:string)=>void} */
    onAudio = () => {};
    /** @type {(transcript:string)=>void} */
    onTranscript = () => {};
    /** @type {(payload:{cards:Array,primary_answer:string,should_surface:boolean})=>void} */
    onHelpCards = () => {};
    /** @type {(payload:{context?:object|null})=>void} */
    onVisualContext = () => {};
    /** @type {(payload:{focus?:object|null})=>void} */
    onFocusContext = () => {};
    /** @type {(payload:{intentional:boolean})=>void} */
    onClose = () => {};

    constructor({ url = DEFAULT_WS } = {}) {
        this.url = url;
    }

    connect({
        model = 'gpt-realtime-2',
        responseModalities = ['text'],
        profile,
        language,
        customPrompt,
        contextParams,
        focusConfig,
        sessionId,
        sessionOptions,
        apiKey
    } = {}) {
        return new Promise((resolve, reject) => {
            try {
                this.intentionallyClosed = false;
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
                    this._send({
                        type: 'start',
                        model,
                        responseModalities,
                        profile,
                        language,
                        customPrompt,
                        contextParams,
                        focusConfig,
                        sessionId,
                        sessionOptions,
                        apiKey,
                    });
                    this.onStatus('WS open');
                    resolve(true);
                };
                this.ws.onclose = () => {
                    const intentionallyClosed = this.intentionallyClosed;
                    if (!this.intentionallyClosed) {
                        this.onStatus('WS closed');
                    }
                    this.onClose({ intentional: intentionallyClosed });
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
                        else if (msg.type === 'model_text') this.onText(msg);
                        else if (msg.type === 'model_audio') this.onAudio(msg.data, msg.mime);
                        else if (msg.type === 'user_transcript') this.onTranscript(msg.transcript);
                        else if (msg.type === 'help_cards') this.onHelpCards(msg);
                        else if (msg.type === 'visual_context') this.onVisualContext(msg);
                        else if (msg.type === 'focus_context') this.onFocusContext(msg);
                    } catch (e) {
                        /* empty */
                    }
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

    refreshHelp(text) {
        this._send({ type: 'refresh_help', text });
    }

    refreshResponse(text, refreshHelp = false) {
        this._send({ type: 'refresh_response', text, refreshHelp });
    }

    sendVisualContext(context) {
        this._send({ type: 'visual_context', ...context });
    }

    sendClipFrames(payload) {
        this._send({ type: 'clip_frames', ...payload });
    }

    clearVisualContext() {
        this._send({ type: 'clear_visual_context' });
    }

    updateFocusConfig(config, profile) {
        this._send({ type: 'focus_config', config, profile });
    }

    updateSessionOptions(options) {
        this._send({ type: 'session_options', options });
    }

    end() {
        this.intentionallyClosed = true;
        this._send({ type: 'end' });
        try {
            this.ws?.close();
        } catch (e) {
            /* empty */
        }
    }
}
