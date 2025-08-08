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
  const client = useMemo(() => new LLMClient({
    url: (s.serverUrl || 'http://localhost:8787').replace('http','ws').replace('https','wss') + '/ws/live'
  }), [s.serverUrl]);
  const screenRef = useRef<ScreenCapture | null>(null);
  const audioRef = useRef<AudioCapture | null>(null);

  useEffect(() => {
    client.onText = (text) => {
      s.addLog({ kind: 'model', text });
      if (s.ttsEnabled) (window as any).electronAPI?.speak(text);
    };
    client.onStatus = (text) => s.addLog({ kind: 'status', text });
    client.onError = (text) => s.addLog({ kind: 'error', text });
    client.onAudio = (data, mime) => {
      const audio = new Audio(`data:${mime};base64,${data}`);
      audio.play().catch(() => {});
    };
  }, [client, s]);

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

  function disconnect() {
    client.end();
    setConnected(false);
  }

  async function startMic() {
    try {
      if (!audioRef.current) audioRef.current = new AudioCapture({
        onPcm16Base64: (b64) => client.sendPcm16Base64(b64),
        onLocalPCM16: async (pcm16) => {
          if (!s.localAsr) return;
          try {
            const text = await transcribePCM16(pcm16);
            if (text) s.addLog({ kind: 'status', text: `[local ASR] ${text}` });
          } catch (e:any) {
            s.addLog({ kind: 'error', text: `local ASR error: ${String(e)}` });
          }
        }
      });
      await audioRef.current.start();
      s.addLog({ kind: 'status', text: 'Mic started' });
    } catch (err: any) {
      s.addLog({ kind: 'error', text: `Mic error: ${String(err)}` });
    }
  }

  async function stopMic() {
    await audioRef.current?.stop();
    audioRef.current = null;
    s.addLog({ kind: 'status', text: 'Mic stopped' });
  }

  async function shareScreen() {
    try {
      if (!screenRef.current) screenRef.current = new ScreenCapture({
        fps: s.screenFrameFps,
        onJpegBase64: (b64) => client.sendJpegBase64(b64),
        onLocalJpegBytes: async (bytes) => {
          if (!s.localOcr) return;
          try {
            const text = await ocrBytes(bytes);
            if (text) s.addLog({ kind: 'status', text: `[local OCR] ${text.slice(0,200)}${text.length>200?'…':''}` });
          } catch (e:any) {
            s.addLog({ kind: 'error', text: `local OCR error: ${String(e)}` });
          }
        }
      });
      await screenRef.current.start();
      s.addLog({ kind: 'status', text: 'Screen sharing started' });
    } catch (err: any) {
      s.addLog({ kind: 'error', text: `Screen error: ${String(err)}` });
    }
  }

  async function stopScreen() {
    await screenRef.current?.stop();
    screenRef.current = null;
    s.addLog({ kind: 'status', text: 'Screen sharing stopped' });
  }

  function sendText(text: string) {
    client.sendText(text);
  }

  return (
    <div>
      <div>
        {connected ? <button onClick={disconnect}>Disconnect</button> : <button onClick={connect}>Connect</button>}
        <button onClick={startMic}>Start Mic</button>
        <button onClick={stopMic}>Stop Mic</button>
        <button onClick={shareScreen}>Share Screen</button>
        <button onClick={stopScreen}>Stop Screen</button>
      </div>
      <div>
        <input type="text" onKeyDown={e => { if (e.key === 'Enter') { sendText((e.target as HTMLInputElement).value); (e.target as HTMLInputElement).value=''; } }} />
      </div>
      <div style={{ maxHeight: 200, overflow: 'auto', background: '#eee', padding: 8 }}>
        {s.logs.map((l, i) => (
          <div key={i}><b>[{l.kind}]</b> {l.text}</div>
        ))}
      </div>
    </div>
  );
}
