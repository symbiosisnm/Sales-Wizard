// apps/desktop/src/ui/Settings.tsx
import React from 'react';
import { useStore } from '../utils/store';

export function Settings() {
  const s = useStore();
  return (
    <div>
      <h3>Settings</h3>
      <label>
        <input type="checkbox" checked={s.ttsEnabled} onChange={e => s.setTts(e.target.checked)} /> TTS
      </label>
      <br />
      <label>
        <input type="checkbox" checked={s.localAsr} onChange={e => s.setLocalAsr(e.target.checked)} /> Local ASR
      </label>
      <br />
      <label>
        <input type="checkbox" checked={s.localOcr} onChange={e => s.setLocalOcr(e.target.checked)} /> Local OCR
      </label>
      <br />
      <div>
        Response Modalities:
        <label style={{ marginLeft: 8 }}>
          <input
            type="checkbox"
            checked={s.responseModalities.includes('TEXT')}
            onChange={e => {
              const mods = e.target.checked
                ? Array.from(new Set([...s.responseModalities, 'TEXT']))
                : s.responseModalities.filter(m => m !== 'TEXT');
              s.setResponseModalities(mods);
            }}
          /> TEXT
        </label>
        <label style={{ marginLeft: 8 }}>
          <input
            type="checkbox"
            checked={s.responseModalities.includes('AUDIO')}
            onChange={e => {
              const mods = e.target.checked
                ? Array.from(new Set([...s.responseModalities, 'AUDIO']))
                : s.responseModalities.filter(m => m !== 'AUDIO');
              s.setResponseModalities(mods);
            }}
          /> AUDIO
        </label>
      </div>
      <br />
      <label>
        Screen FPS
        <input type="number" value={s.screenFrameFps} onChange={e => s.setScreenFps(parseInt(e.target.value) || 1)} />
      </label>
    </div>
  );
}
