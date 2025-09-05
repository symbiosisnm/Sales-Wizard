// apps/desktop/electron/preload.js
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
    speak: text => ipcRenderer.invoke('speak', text),
});
