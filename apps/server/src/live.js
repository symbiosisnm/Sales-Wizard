// apps/server/src/live.js
import { WebSocketServer } from 'ws';
import { GoogleGenAI, Modality } from '@google/genai';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';

/**
 * Message formats coming from the browser client.
 */
const StartSchema = z.object({
  type: z.literal('start'),
  model: z.string().default('gemini-2.0-flash-live-001'),
  responseModalities: z.array(z.enum(['TEXT', 'AUDIO'])).default(['TEXT']),
  systemInstruction: z.string().optional(),
});

const TextSchema = z.object({
  type: z.literal('text'),
  text: z.string().min(1),
});

const AudioSchema = z.object({
  type: z.literal('audio'),
  // base64 PCM16 @16k
  data: z.string().min(8),
  mime: z.string().default('audio/pcm;rate=16000').optional(),
});

const ImageSchema = z.object({
  type: z.literal('image'),
  // base64 JPEG
  data: z.string().min(8),
  mime: z.string().default('image/jpeg').optional(),
});

const FlushSchema = z.object({ type: z.literal('flush') });
const EndSchema = z.object({ type: z.literal('end') });

/**
 * Broadcast helper
 */
function sendJSON(ws, payload) {
  try {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(payload));
  } catch {}
}

/**
 * Attach /ws/live server to the existing HTTP server.
 * @param {import('http').Server} httpServer
 * @param {{ apiKey: string }} cfg
 */
export function attachLiveGateway(httpServer, cfg) {
  const wss = new WebSocketServer({ noServer: true });

  // Handle HTTP upgrade to /ws/live only
  httpServer.on('upgrade', (req, socket, head) => {
    const { url } = req;
    if (!url || !url.startsWith('/ws/live')) {
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  });

  wss.on('connection', async (clientWS) => {
    const clientId = uuidv4();
    const logPrefix = `[live:${clientId}]`;
    let genai = null;
    let live = null;
    let closed = false;

    const now = () => new Date().toISOString().split('T')[1].replace('Z','');

    function status(msg) { sendJSON(clientWS, { type: 'status', ts: now(), msg }); }
    function error(msg)  { sendJSON(clientWS, { type: 'error', ts: now(), msg }); }

    clientWS.on('message', async (raw) => {
      if (closed) return;
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return error('Bad JSON');
      }

      // START — create Live session with Gemini and wire callbacks
      if (StartSchema.safeParse(msg).success) {
        const { model, responseModalities, systemInstruction } = StartSchema.parse(msg);

        try {
          genai = new GoogleGenAI({ apiKey: cfg.apiKey });
          const config = {
            responseModalities: responseModalities.map((m) =>
              m === 'AUDIO' ? Modality.AUDIO : Modality.TEXT
            ),
            systemInstruction: systemInstruction
              ? { parts: [{ text: systemInstruction }] }
              : undefined,
            temperature: 0.6,
          };

          live = await genai.live.connect({
            model,
            config,
            httpOptions: { apiVersion: 'v1alpha' },
            callbacks: {
              onopen: () => status('Gemini live opened'),
              onmessage: (message) => {
                // Forward raw serverContent (careful to keep it small) OR extract text/audio
                try {
                  const sc = message?.serverContent;
                  const parts = sc?.modelTurn?.parts || [];

                  const text =
                    parts
                      .map((p) => p?.text)
                      .filter(Boolean)
                      .join('') || '';

                  if (text) {
                    sendJSON(clientWS, { type: 'model_text', text });
                  }

                  const audioParts = parts.filter(
                    (p) => p?.inlineData?.mimeType?.startsWith('audio/')
                  );
                  for (const p of audioParts) {
                    try {
                      const b64 = Buffer.from(p.inlineData.data).toString('base64');
                      sendJSON(clientWS, {
                        type: 'model_audio',
                        data: b64,
                        mime: p.inlineData.mimeType,
                      });
                    } catch {}
                  }
                } catch (e) {
                  // best effort
                }
              },
              onerror: (e) => error(`Gemini live error: ${e?.message || e}`),
              onclose: (e) => status(`Gemini live closed: ${e?.reason || ''}`),
            },
          });

          status(`Live session ready on model ${model}`);
        } catch (e) {
          console.error(logPrefix, 'start error', e);
          return error(`Failed to start live: ${String(e)}`);
        }
        return;
      }

      // TEXT
      if (TextSchema.safeParse(msg).success) {
        if (!live) return error('Not started');
        const { text } = TextSchema.parse(msg);
        try {
          await live.sendClientContent({
            turns: [{ parts: [{ text }] }],
          });
          return;
        } catch (e) {
          return error(`send text failed: ${String(e)}`);
        }
      }

      // AUDIO (base64 PCM16 @16k)
      if (AudioSchema.safeParse(msg).success) {
        if (!live) return error('Not started');
        const { data, mime } = AudioSchema.parse(msg);
        try {
          const bytes = Buffer.from(data, 'base64');
          const blob = new Blob([bytes], { type: mime || 'audio/pcm;rate=16000' });
          live.sendRealtimeInput({ media: blob });
          return;
        } catch (e) {
          return error(`send audio failed: ${String(e)}`);
        }
      }

      // IMAGE (base64 JPEG)
      if (ImageSchema.safeParse(msg).success) {
        if (!live) return error('Not started');
        const { data, mime } = ImageSchema.parse(msg);
        try {
          const bytes = Buffer.from(data, 'base64');
          const blob = new Blob([bytes], { type: mime || 'image/jpeg' });
          live.sendRealtimeInput({ media: blob });
          return;
        } catch (e) {
          return error(`send image failed: ${String(e)}`);
        }
      }

      // FLUSH – future use (e.g., to force a model turn)
      if (FlushSchema.safeParse(msg).success) {
        // No-op; the Live API emits as it generates
        return;
      }

      // END – close everything
      if (EndSchema.safeParse(msg).success) {
        try { await live?.close?.(); } catch {}
        try { clientWS.close(); } catch {}
      }
    });

    clientWS.on('close', async () => {
      closed = true;
      try { await live?.close?.(); } catch {}
    });
  });
}

