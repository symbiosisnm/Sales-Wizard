const { contextBridge, ipcRenderer } = require('electron');
const config = require('./utils/config');

const ipc = {
    invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
    send: (channel, ...args) => ipcRenderer.send(channel, ...args),
    on: (channel, listener) => ipcRenderer.on(channel, listener),
    once: (channel, listener) => ipcRenderer.once(channel, listener),
    removeListener: (channel, listener) => ipcRenderer.removeListener(channel, listener),
    removeAllListeners: channel => ipcRenderer.removeAllListeners(channel),
};

contextBridge.exposeInMainWorld('electron', { ipcRenderer: ipc });
contextBridge.exposeInMainWorld('config', config);
