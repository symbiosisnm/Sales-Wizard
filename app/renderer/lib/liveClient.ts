export type LiveClient = ReturnType<typeof createLiveClient>;

export function createLiveClient(url = 'ws://localhost:3001/live') {
  let ws: WebSocket | null = null;
  let listeners: Array<(msg: unknown) => void> = [];
  let openPromise: Promise<void> | null = null;

  function connect() {
    if (openPromise) return openPromise;
    openPromise = new Promise<void>((resolve, reject) => {
      ws = new WebSocket(url);
      ws.binaryType = 'arraybuffer';

      ws.onopen = () => resolve();
      ws.onmessage = (ev) => {
        try {
          const data = typeof ev.data === 'string' ? JSON.parse(ev.data) : ev.data;
          listeners.forEach((l) => l(data));
        } catch {
          listeners.forEach((l) => l(ev.data));
        }
      };
      ws.onerror = (e) => reject(e);
      ws.onclose = () => {
        openPromise = null;
        ws = null;
      };
    });
    return openPromise;
  }

  function onMessage(fn: (msg: unknown) => void) {
    listeners.push(fn);
    return () => {
      listeners = listeners.filter((x) => x !== fn);
    };
  }

  async function setup(systemInstruction?: string) {
    await connect();
    ws?.send(JSON.stringify({ type: 'setup', systemInstruction }));
  }

  function sendText(text: string, commit = true) {
    ws?.send(JSON.stringify({ type: 'client_content', text, turnComplete: commit }));
  }

  function sendAudioPCM16(base64: string) {
    ws?.send(JSON.stringify({ type: 'audio_chunk', base64 }));
  }

  function endAudio() {
    ws?.send(JSON.stringify({ type: 'audio_end' }));
  }

  function sendFrame(base64: string, mimeType = 'image/webp') {
    ws?.send(JSON.stringify({ type: 'video_chunk', base64, mimeType }));
  }

  function interrupt() {
    ws?.send(JSON.stringify({ type: 'interrupt' }));
  }

  return { connect, setup, onMessage, sendText, sendAudioPCM16, endAudio, sendFrame, interrupt };
}
