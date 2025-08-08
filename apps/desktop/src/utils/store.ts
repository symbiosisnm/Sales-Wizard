// apps/desktop/src/utils/store.ts
import create from 'zustand';

export type LogEntry = { kind: 'model' | 'status' | 'error'; text: string };

interface StoreState {
  logs: LogEntry[];
  addLog: (log: LogEntry) => void;
  ttsEnabled: boolean;
  localAsr: boolean;
  localOcr: boolean;
  responseModalities: string[];
  screenFrameFps: number;
  serverUrl: string;
  model: string;
  systemInstruction?: string;
  setTts: (v: boolean) => void;
  setLocalAsr: (v: boolean) => void;
  setLocalOcr: (v: boolean) => void;
  setResponseModalities: (m: string[]) => void;
  setScreenFps: (n: number) => void;
  setServerUrl: (s: string) => void;
}

export const useStore = create<StoreState>((set) => ({
  logs: [],
  addLog: (log) => set((s) => ({ logs: [...s.logs, log] })),
  ttsEnabled: true,
  localAsr: true,
  localOcr: true,
  responseModalities: ['TEXT'],
  screenFrameFps: 1,
  serverUrl: 'http://localhost:8787',
  model: 'gemini-2.0-flash-live-001',
  systemInstruction: undefined,
  setTts: (v) => set({ ttsEnabled: v }),
  setLocalAsr: (v) => set({ localAsr: v }),
  setLocalOcr: (v) => set({ localOcr: v }),
  setResponseModalities: (m) => set({ responseModalities: m }),
  setScreenFps: (n) => set({ screenFrameFps: n }),
  setServerUrl: (s) => set({ serverUrl: s }),
}));
