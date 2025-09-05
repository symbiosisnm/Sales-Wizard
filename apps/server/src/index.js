// apps/server/src/index.js
import 'dotenv/config';
import http from 'http';
import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import { GoogleGenAI } from '@google/genai';
import { attachLiveGateway } from './live.js';

const app = express();
const PORT = process.env.PORT || 8787;
const GOOGLE_GENAI_API_KEY = process.env.GOOGLE_GENAI_API_KEY;

if (!GOOGLE_GENAI_API_KEY) {
    console.error('[FATAL] GOOGLE_GENAI_API_KEY is not set in .env');
    process.exit(1);
}

app.use(cors());
app.use(express.json({ limit: '4mb' }));
app.use(morgan('dev'));

const client = new GoogleGenAI({ apiKey: GOOGLE_GENAI_API_KEY });

/**
 * Provision ephemeral token for client-side Live connections (if you want client→Gemini direct).
 * We also support a server-side /ws/live proxy for stricter control.
 */
app.post('/api/ephemeral-token', async (req, res) => {
    try {
        const { model = 'gemini-2.0-flash-live-001', responseModalities = ['TEXT'] } = req.body || {};
        const expireTime = new Date(Date.now() + 30 * 60 * 1000).toISOString();
        const newSessionExpireTime = new Date(Date.now() + 60 * 1000).toISOString();

        const token = await client.authTokens.create({
            config: {
                uses: 1,
                expireTime,
                newSessionExpireTime,
                liveConnectConstraints: {
                    model,
                    config: {
                        responseModalities,
                        temperature: 0.6,
                        sessionResumption: {},
                    },
                },
                httpOptions: { apiVersion: 'v1alpha' },
            },
        });

        res.json({ tokenName: token.name, expireTime });
    } catch (err) {
        console.error('Token error:', err);
        res.status(500).json({ error: 'Failed to create ephemeral token', details: String(err) });
    }
});

app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'cheating-daddy-server' }));

// Create HTTP server so we can handle WS upgrades.
const httpServer = http.createServer(app);

// Attach /ws/live gateway
attachLiveGateway(httpServer, { apiKey: GOOGLE_GENAI_API_KEY });

httpServer.listen(PORT, () => {
    console.log(`[server] listening on http://localhost:${PORT}`);
    console.log(`[server] live WS at ws://localhost:${PORT}/ws/live`);
});
