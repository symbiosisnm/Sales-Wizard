// apps/desktop/src/ui/App.tsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../utils/store';
import { AudioCapture } from '../utils/AudioCapture';
import { ScreenCapture } from '../utils/ScreenCapture';
import { LLMClient } from '../services/llmClient';
import { transcribePCM16 } from '../services/transcription';
import { ocrBytes } from '../services/ocr';

export function App() {
  const s = useStore();
  const [connected, setConnected] = useState(false);
  const [micActive, setMicActive] = useState(false);
  const [screenActive, setScreenActive] = useState(false);
  const [message, setMessage] = useState('');
  const client = useMemo(() => new LLMClient({
    url: (s.serverUrl || 'http://localhost:8787').replace('http', 'ws').replace('https', 'wss') + '/ws/live'
  }), [s.serverUrl]);
  const screenRef = useRef<ScreenCapture | null>(null);
  const audioRef = useRef<AudioCapture | null>(null);

  useEffect(() => {
    client.onText = (text) => {
      const store = useStore.getState();
      store.addLog({ kind: 'model', text });
      if (store.ttsEnabled) (window as any).electronAPI?.speak(text);
    };
    client.onStatus = (text) => useStore.getState().addLog({ kind: 'status', text });
    client.onError = (text) => useStore.getState().addLog({ kind: 'error', text });
    client.onAudio = (data, mime) => {
      const audio = new Audio(`data:${mime};base64,${data}`);
      audio.play().catch(() => {});
    };

    return () => {
      void audioRef.current?.stop();
      void screenRef.current?.stop();
      audioRef.current = null;
      screenRef.current = null;
      client.end();
    };
  }, [client]);

  async function connect() {
    try {
      await client.connect({
        model: s.model,
        responseModalities: s.responseModalities,
        systemInstruction: s.systemInstruction,
      });
      setConnected(true);
      s.addLog({ kind: 'status', text: 'Connected via WS' });
    } catch (err: any) {
      s.addLog({ kind: 'error', text: `Connect failed: ${String(err)}` });
    }
  }

  async function disconnect() {
    await stopMic();
    await stopScreen();
    client.end();
    setConnected(false);
    s.addLog({ kind: 'status', text: 'Disconnected' });
  }

  async function startMic() {
    if (!connected) {
      s.addLog({ kind: 'error', text: 'Connect before starting the microphone.' });
      return;
    }
    if (audioRef.current) return;

    audioRef.current = new AudioCapture({
      onPcm16Base64: (b64) => client.sendPcm16Base64(b64),
      onLocalPCM16: async (pcm16) => {
        if (!s.localAsr) return;
        try {
          const text = await transcribePCM16(pcm16);
          if (text) s.addLog({ kind: 'status', text: `[local ASR] ${text}` });
        } catch (e: any) {
          s.addLog({ kind: 'error', text: `Local ASR error: ${String(e)}` });
        }
      },
      onError: (e) => s.addLog({ kind: 'error', text: `Mic error: ${String(e)}` }),
    });

    try {
      await audioRef.current.start();
      setMicActive(true);
      s.addLog({ kind: 'status', text: 'Mic started' });
    } catch (e: any) {
      audioRef.current = null;
      s.addLog({ kind: 'error', text: `Could not start mic: ${String(e)}` });
    }
  }

  async function stopMic() {
    if (!audioRef.current) return;
    await audioRef.current.stop();
    audioRef.current = null;
    setMicActive(false);
    s.addLog({ kind: 'status', text: 'Mic stopped' });
  }

  async function shareScreen() {
    if (!connected) {
      s.addLog({ kind: 'error', text: 'Connect before sharing your screen.' });
      return;
    }
    if (screenRef.current) return;

    screenRef.current = new ScreenCapture({
      fps: s.screenFrameFps,
      onJpegBase64: (b64) => client.sendJpegBase64(b64),
      onLocalJpegBytes: async (bytes) => {
        if (!s.localOcr) return;
        try {
          const text = await ocrBytes(bytes);
          if (text) s.addLog({ kind: 'status', text: `[local OCR] ${text.slice(0, 200)}${text.length > 200 ? '…' : ''}` });
        } catch (e: any) {
          s.addLog({ kind: 'error', text: `Local OCR error: ${String(e)}` });
        }
      },
      onError: (e) => s.addLog({ kind: 'error', text: `Screen error: ${String(e)}` }),
    });

    try {
      await screenRef.current.start();
      setScreenActive(true);
      s.addLog({ kind: 'status', text: 'Screen sharing started' });
    } catch (e: any) {
      screenRef.current = null;
      s.addLog({ kind: 'error', text: `Could not share screen: ${String(e)}` });
    }
  }

  async function stopScreen() {
    if (!screenRef.current) return;
    await screenRef.current.stop();
    screenRef.current = null;
    setScreenActive(false);
    s.addLog({ kind: 'status', text: 'Screen sharing stopped' });
  }

  function sendText() {
    const text = message.trim();
    if (!text) return;
    if (!connected) {
      s.addLog({ kind: 'error', text: 'Connect before sending a message.' });
      return;
    }
    client.sendText(text);
    setMessage('');
  }

  return (
    <div>
      <div>
        <span role="status">{connected ? 'Connected' : 'Disconnected'}</span>
        {connected
          ? <button onClick={disconnect}>Disconnect</button>
          : <button onClick={connect}>Connect</button>}
        <button onClick={startMic} disabled={!connected || micActive}>Start Mic</button>
        <button onClick={stopMic} disabled={!micActive}>Stop Mic</button>
        <button onClick={shareScreen} disabled={!connected || screenActive}>Share Screen</button>
        <button onClick={stopScreen} disabled={!screenActive}>Stop Screen</button>
      </div>
      <div>
        <input
          type="text"
          value={message}
          aria-label="Message"
          placeholder="Send a message"
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') sendText(); }}
        />
        <button onClick={sendText} disabled={!connected || !message.trim()}>Send</button>
      </div>
      <div aria-live="polite" style={{ maxHeight: 200, overflow: 'auto', background: '#eee', padding: 8 }}>
        {s.logs.map((l, i) => (
          <div key={i}><b>[{l.kind}]</b> {l.text}</div>
        ))}
      </div>
    </div>
  );
}
