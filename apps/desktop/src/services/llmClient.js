const EventEmitter = require('events');
const WebSocket = require('ws');

class LiveClient extends EventEmitter {
  constructor({ reconnect = false } = {}) {
    super();
    this._reconnect = reconnect;
    this._ws = null;
    this._url = null;
    this._backoff = 1000;
    this._queue = [];
    this._closing = false;
  }

  connect(serverUrl) {
    this._url = `${serverUrl.replace(/\/$/, '')}/live`;
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this._url);
      this._ws = ws;
      ws.on('open', () => {
        this._flushQueue();
        this.emit('open');
        resolve();
      });
      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data);
          if (msg && msg.type) this.emit(msg.type, msg);
        } catch (err) {
          this.emit('error', err);
        }
      });
      ws.on('close', () => {
        this.emit('close');
        if (this._reconnect && !this._closing) {
          setTimeout(() => {
            this._backoff = Math.min(this._backoff * 2, 16000);
            this.connect(serverUrl).catch(() => {});
          }, this._backoff);
        }
      });
      ws.on('error', (err) => {
        this.emit('error', err);
        reject(err);
      });
    });
  }

  _flushQueue() {
    while (this._queue.length && this._ws && this._ws.readyState === WebSocket.OPEN) {
      const data = this._queue.shift();
      this._ws.send(data);
    }
  }

  _send(obj) {
    const data = JSON.stringify(obj);
    if (this._ws && this._ws.readyState === WebSocket.OPEN) {
      this._ws.send(data);
    } else {
      this._queue.push(data);
    }
  }

  start(apiKey, mode) {
    this._send({ type: 'start', apiKey, mode });
  }

  sendText(text) {
    this._send({ type: 'input_text', text });
  }

  sendAudioPcm16(buffer) {
    this._send({ type: 'input_audio_buffer', data: buffer.toString('base64') });
  }

  sendImage(base64) {
    this._send({ type: 'input_image', data: base64 });
  }

  end() {
    this._closing = true;
    this._send({ type: 'end' });
    if (this._ws) this._ws.close();
  }
}

let singleton = null;
function createLiveClient(opts) {
  if (!singleton) singleton = new LiveClient(opts);
  return singleton;
}

module.exports = {
  LiveClient,
  createLiveClient,
};
