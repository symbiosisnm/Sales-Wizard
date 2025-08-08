import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('cdBridge', {
  ping: () => ipcRenderer.invoke('ping')
});
