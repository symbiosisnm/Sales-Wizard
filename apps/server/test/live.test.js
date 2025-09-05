// apps/server/test/live.test.js
import { describe, it, expect, vi, afterEach } from 'vitest';

// Mock the Google GenAI client used by the gateway
const liveMock = {
    sendClientContent: vi.fn(),
    sendRealtimeInput: vi.fn(),
    close: vi.fn(),
};

const connectMock = vi.fn(async opts => {
    opts.callbacks?.onopen?.(); // simulate Live API connection opening
    return liveMock;
});

vi.mock('@google/genai', () => ({
    GoogleGenAI: vi.fn(() => ({ live: { connect: connectMock } })),
    Modality: { AUDIO: 'AUDIO', TEXT: 'TEXT' },
}));

import { GoogleGenAI } from '@google/genai';
import { createServer } from 'http';
import WebSocket from 'ws';
import { once } from 'events';
import { attachLiveGateway } from '../src/live.js';

/** Wait until predicate returns true or timeout (ms) elapses */
async function waitFor(predicate, timeout = 1000) {
    const start = Date.now();
    return new Promise((resolve, reject) => {
        const check = () => {
            if (predicate()) return resolve();
            if (Date.now() - start > timeout) return reject(new Error('timeout'));
            setTimeout(check, 10);
        };
        check();
    });
}

/** Wait for a message on ws matching predicate */
function waitForMessage(ws, predicate, timeout = 1000) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            ws.off('message', handler);
            reject(new Error('timeout'));
        }, timeout);
        function handler(data) {
            const msg = JSON.parse(data.toString());
            if (predicate(msg)) {
                clearTimeout(timer);
                ws.off('message', handler);
                resolve(msg);
            }
        }
        ws.on('message', handler);
    });
}

async function setup(start = true) {
    const server = createServer();
    attachLiveGateway(server, { apiKey: 'test-key' });
    await new Promise(res => server.listen(0, res));
    const port = server.address().port;
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/live`);
    const messages = [];
    ws.on('message', d => messages.push(JSON.parse(d.toString())));
    await once(ws, 'open');
    if (start) {
        ws.send(JSON.stringify({ type: 'start' }));
        await waitFor(() => messages.some(m => m.type === 'status' && m.msg.includes('Live session ready')));
    }
    return { server, ws, messages };
}

async function cleanup(server, ws) {
    if (ws.readyState !== ws.CLOSED) {
        ws.close();
        await once(ws, 'close');
    }
    await new Promise(res => server.close(res));
}

afterEach(() => {
    vi.clearAllMocks();
});

describe('live WebSocket gateway', () => {
    it('performs start handshake', async () => {
        const { server, ws, messages } = await setup(true);
        try {
            expect(GoogleGenAI).toHaveBeenCalledWith({ apiKey: 'test-key' });
            expect(connectMock).toHaveBeenCalledTimes(1);
            const opened = messages.find(m => m.type === 'status' && m.msg.includes('Gemini live opened'));
            const ready = messages.find(m => m.type === 'status' && m.msg.includes('Live session ready'));
            expect(opened).toBeTruthy();
            expect(ready).toBeTruthy();
        } finally {
            await cleanup(server, ws);
        }
    });

    it('forwards text messages', async () => {
        const { server, ws } = await setup(true);
        try {
            ws.send(JSON.stringify({ type: 'text', text: 'hello' }));
            await waitFor(() => liveMock.sendClientContent.mock.calls.length > 0);
            expect(liveMock.sendClientContent).toHaveBeenCalledWith({
                turns: [{ parts: [{ text: 'hello' }] }],
            });
        } finally {
            await cleanup(server, ws);
        }
    });

    it('forwards audio messages', async () => {
        const { server, ws } = await setup(true);
        try {
            const b64 = Buffer.from('audio').toString('base64');
            ws.send(JSON.stringify({ type: 'audio', data: b64 }));
            await waitFor(() => liveMock.sendRealtimeInput.mock.calls.length > 0);
            const arg = liveMock.sendRealtimeInput.mock.calls[0][0];
            expect(arg.media).toBeInstanceOf(Blob);
            expect(arg.media.type).toBe('audio/pcm;rate=16000');
        } finally {
            await cleanup(server, ws);
        }
    });

    it('forwards image messages', async () => {
        const { server, ws } = await setup(true);
        try {
            const b64 = Buffer.from('image').toString('base64');
            ws.send(JSON.stringify({ type: 'image', data: b64 }));
            await waitFor(() => liveMock.sendRealtimeInput.mock.calls.length > 0);
            const arg = liveMock.sendRealtimeInput.mock.calls[0][0];
            expect(arg.media).toBeInstanceOf(Blob);
            expect(arg.media.type).toBe('image/jpeg');
        } finally {
            await cleanup(server, ws);
        }
    });

    it('errors when sending before start', async () => {
        const { server, ws } = await setup(false);
        try {
            ws.send(JSON.stringify({ type: 'text', text: 'hi' }));
            const err = await waitForMessage(ws, m => m.type === 'error');
            expect(err.msg).toBe('Not started');
        } finally {
            await cleanup(server, ws);
        }
    });

    it('reports bad JSON', async () => {
        const { server, ws } = await setup(false);
        try {
            ws.send('not json');
            const err = await waitForMessage(ws, m => m.type === 'error');
            expect(err.msg).toBe('Bad JSON');
        } finally {
            await cleanup(server, ws);
        }
    });

    it('cleans up on disconnect', async () => {
        const { server, ws } = await setup(true);
        try {
            ws.close();
            await once(ws, 'close');
            await waitFor(() => liveMock.close.mock.calls.length > 0);
        } finally {
            await cleanup(server, ws);
        }
    });
});
