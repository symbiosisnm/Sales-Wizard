import React, { useEffect, useRef, useState } from 'react';
import { createLiveClient } from './lib/liveClient';
import { getMicStream, attachAudioProcessor } from './lib/capture';
import { getScreenStream, startScreenBursting } from './lib/screen';
import './styles.css';

const live = createLiveClient();

export default function App() {
  const [status, setStatus] = useState<'idle'|'listening'|'thinking'|'speaking'|'error'>('idle');
  const [log, setLog] = useState<string[]>([]);
  const stopMicRef = useRef<null | (() => void)>(null);
  const stopScreenRef = useRef<null | (() => void)>(null);

  useEffect(() => {
    live.onMessage((msg) => {
      try {
        const m = typeof msg === 'string' ? JSON.parse(msg) : msg;
        if (m?.setupComplete) {
          setStatus('listening');
        }
        if (m?.serverContent?.modelTurn) {
          const parts = m.serverContent.modelTurn.parts || [];
          const text = parts
          .map((p: { text?: string }) => p.text)
          .filter(Boolean)
          .join('');
          if (text) {
            setLog((l) => [...l.slice(-100), text]);
            setStatus('thinking');
          }
          if (m.serverContent.turnComplete) {
            setStatus('listening');
          }
        }
        if (m?.inputTranscription) {
          const t = m.inputTranscription.transcript || '';
          if (t) setLog((l) => [...l.slice(-100), `You: ${t}`]);
        }
      } catch (e) {
        // ignore parse errors
      }
    });

    (async () => {
      await live.setup();
    })();
  }, []);

  async function startMic() {
    const mic = await getMicStream();
    stopMicRef.current = attachAudioProcessor(mic, (b64) => live.sendAudioPCM16(b64));
    setStatus('listening');
  }

  function stopMic() {
    stopMicRef.current?.();
    live.endAudio();
    setStatus('idle');
  }

  async function startScreen() {
    const screen = await getScreenStream();
    stopScreenRef.current = startScreenBursting(screen, (b64) => live.sendFrame(b64), 1);
  }

  function stopScreen() {
    stopScreenRef.current?.();
  }

  function sendText(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const text = String(fd.get('q') || '');
    if (text.trim()) live.sendText(text, true);
    (e.currentTarget.elements.namedItem('q') as HTMLInputElement).value = '';
  }

  return (
    <div className="hud">
      <div className="status">{status.toUpperCase()}</div>
      <div className="buttons">
        <button onClick={startMic}>🎙️ Mic</button>
        <button onClick={stopMic}>⏹️ Stop Mic</button>
        <button onClick={startScreen}>🖥️ Screen</button>
        <button onClick={stopScreen}>⏹️ Stop Screen</button>
        <button onClick={() => live.interrupt()}>⛔ Interrupt</button>
      </div>
      <form onSubmit={sendText} className="bar">
        <input name="q" placeholder="Type to ask…" />
        <button>Send</button>
      </form>
      <div className="log">
        {log.map((l, i) => (
          <div key={i} className="line">
            {l}
          </div>
        ))}
      </div>
    </div>
  );
}
