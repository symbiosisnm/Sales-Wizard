function sendToRenderer(channel, data) {
    try {
        const { BrowserWindow } = require('electron');
        const windows = BrowserWindow.getAllWindows();
        if (windows.length > 0) {
            windows[0].webContents.send(channel, data);
        }
    } catch (e) {
        // Electron may not be available during tests
    }
}

module.exports = { sendToRenderer };
