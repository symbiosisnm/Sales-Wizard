import WebSocket from 'ws';
import type { WebSocket as WS } from 'ws';

type GatewayOptions = {
  apiKey: string;
  model: string;
  systemInstruction: string;
};

const LIVE_WS_URL =
  'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';

type FromClient =
  | { type: 'setup'; generationConfig?: Record<string, unknown>; systemInstruction?: string }
  | { type: 'client_content'; text?: string; turnComplete?: boolean }
  | { type: 'audio_chunk'; base64: string }
  | { type: 'audio_end' }
  | { type: 'video_chunk'; base64: string; mimeType: string }
  | { type: 'interrupt' }
  | { type: 'close' };

export function createLiveGateway(clientWS: WS, opts: GatewayOptions) {
  let googleWS: WebSocket | null = null;
  let closed = false;

  const connectToGoogle = () => {
    googleWS = new WebSocket(LIVE_WS_URL, {
      headers: {
        'x-goog-api-key': opts.apiKey
      }
    });

    googleWS.on('open', () => {
      const setup = {
        setup: {
          model: opts.model,
          generationConfig: {
            responseModalities: ['TEXT', 'AUDIO']
          },
          systemInstruction: opts.systemInstruction
        }
      };
      googleWS!.send(JSON.stringify(setup));
      clientWS.send(JSON.stringify({ type: 'upstream_open' }));
    });

    googleWS.on('message', (raw) => {
      clientWS.send(raw as WebSocket.RawData);
    });

    googleWS.on('close', () => {
      if (!closed) {
        clientWS.send(JSON.stringify({ type: 'upstream_close' }));
      }
    });

    googleWS.on('error', (err) => {
      clientWS.send(JSON.stringify({ type: 'upstream_error', error: String(err) }));
    });
  };

  connectToGoogle();

  clientWS.on('message', (raw) => {
    if (!googleWS || googleWS.readyState !== WebSocket.OPEN) return;
    const msg = safeParse<FromClient>(raw.toString());
    if (!msg) return;

    switch (msg.type) {
      case 'setup': {
        const setup = {
          setup: {
            model: opts.model,
            generationConfig: msg.generationConfig ?? { responseModalities: ['TEXT', 'AUDIO'] },
            systemInstruction: msg.systemInstruction ?? opts.systemInstruction
          }
        };
        googleWS.send(JSON.stringify(setup));
        break;
      }
      case 'client_content': {
        const payload = {
          clientContent: {
            turns: msg.text ? [{ role: 'user', parts: [{ text: msg.text }] }] : [],
            turnComplete: !!msg.turnComplete
          }
        };
        googleWS.send(JSON.stringify(payload));
        break;
      }
      case 'audio_chunk': {
        const payload = {
          realtimeInput: {
            audio: {
              mimeType: 'audio/pcm;rate=16000',
              data: msg.base64
            }
          }
        };
        googleWS.send(JSON.stringify(payload));
        break;
      }
      case 'audio_end': {
        const payload = { realtimeInput: { audioStreamEnd: true } };
        googleWS.send(JSON.stringify(payload));
        break;
      }
      case 'video_chunk': {
        const payload = {
          realtimeInput: {
            video: {
              mimeType: msg.mimeType,
              data: msg.base64
            }
          }
        };
        googleWS.send(JSON.stringify(payload));
        break;
      }
      case 'interrupt': {
        googleWS.send(JSON.stringify({ clientContent: { turns: [], turnComplete: true } }));
        break;
      }
      case 'close': {
        clientWS.close();
        break;
      }
    }
  });

  clientWS.on('close', () => teardown());
  clientWS.on('error', () => teardown());

  async function teardown() {
    closed = true;
    try {
      googleWS?.close();
  } catch (e) {
    // no-op
  }
  }

  return { teardown };
}

function safeParse<T>(s: string): T | null {
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}
