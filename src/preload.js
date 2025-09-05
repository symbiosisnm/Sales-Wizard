const { contextBridge, ipcRenderer } = require('electron');

const ipc = {
    invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
    send: (channel, ...args) => ipcRenderer.send(channel, ...args),
    on: (channel, listener) => ipcRenderer.on(channel, listener),
    once: (channel, listener) => ipcRenderer.once(channel, listener),
    removeListener: (channel, listener) => ipcRenderer.removeListener(channel, listener),
    removeAllListeners: channel => ipcRenderer.removeAllListeners(channel),
};

contextBridge.exposeInMainWorld('electron', {
    ipcRenderer: ipc,
    history: {
        list: () => ipcRenderer.invoke('history:list'),
        get: id => ipcRenderer.invoke('history:get', id),
    },
    context: {
        get: () => ipcRenderer.invoke('context:get'),
        set: value => ipcRenderer.invoke('context:set', value),
    },
});
