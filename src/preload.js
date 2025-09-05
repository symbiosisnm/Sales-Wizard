const { contextBridge, ipcRenderer, ipcMain } = require('electron');
const { startAudioCapture, startScreenCapture } = require('./services/liveCapture');
const LiveSession = require('./services/liveSession');

// Maintain active live sessions for cleanup and data forwarding
const liveSessions = new Map();

ipcMain.handle('live-open', async (_event, sessionId) => {
    const id = sessionId || Date.now().toString();
    const session = new LiveSession(id);
    liveSessions.set(id, session);
    return { success: true, sessionId: id };
});

ipcMain.handle('audio-start', async (_event, sessionId, options) => {
    const session = sessionId ? liveSessions.get(sessionId) : liveSessions.values().next().value;
    if (!session) {
        return { success: false, error: 'Invalid session' };
    }
    return startAudioCapture(session, options);
});

ipcMain.handle('screen-start', async (_event, sessionId, options) => {
    const session = sessionId ? liveSessions.get(sessionId) : liveSessions.values().next().value;
    if (!session) {
        return { success: false, error: 'Invalid session' };
    }
    return startScreenCapture(session, options);
});

ipcMain.handle('live-send-audio', async (_event, sessionIdOrData, maybeData) => {
    let session;
    let data;
    if (maybeData === undefined && typeof sessionIdOrData === 'object') {
        data = sessionIdOrData;
        session = liveSessions.values().next().value;
    } else {
        session = sessionIdOrData ? liveSessions.get(sessionIdOrData) : liveSessions.values().next().value;
        data = maybeData;
    }
    if (!session) {
        return { success: false, error: 'Invalid session' };
    }
    await session.sendAudio(data);
    return { success: true };
});

ipcMain.handle('live-send-image', async (_event, sessionIdOrData, maybeData) => {
    let session;
    let data;
    if (maybeData === undefined && typeof sessionIdOrData === 'object') {
        data = sessionIdOrData;
        session = liveSessions.values().next().value;
    } else {
        session = sessionIdOrData ? liveSessions.get(sessionIdOrData) : liveSessions.values().next().value;
        data = maybeData;
    }
    if (!session) {
        return { success: false, error: 'Invalid session' };
    }
    await session.sendImage(data);
    return { success: true };
});

const ipc = {
    invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
    send: (channel, ...args) => ipcRenderer.send(channel, ...args),
    on: (channel, listener) => ipcRenderer.on(channel, listener),
    once: (channel, listener) => ipcRenderer.once(channel, listener),
    removeListener: (channel, listener) => ipcRenderer.removeListener(channel, listener),
    removeAllListeners: channel => ipcRenderer.removeAllListeners(channel),
};

contextBridge.exposeInMainWorld('electron', { ipcRenderer: ipc });
