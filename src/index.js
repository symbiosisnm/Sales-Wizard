if (require('electron-squirrel-startup')) {
    process.exit(0);
}

const { app, BrowserWindow, shell, ipcMain, screen } = require('electron');
const { createWindow, updateGlobalShortcuts } = require('./utils/window');
const { setupGeminiIpcHandlers, stopMacOSAudioCapture, sendToRenderer } = require('./utils/gemini');
const { registerSecureStoreIpc } = require('./utils/secureStore');
const { initializeRandomProcessNames } = require('./utils/processRandomizer');
const { applyAntiAnalysisMeasures } = require('./utils/stealthFeatures');

const geminiSessionRef = { current: null };
let mainWindow = null;

// Initialize random process names for stealth
const randomNames = initializeRandomProcessNames();

function createMainWindow() {
    mainWindow = createWindow(sendToRenderer, geminiSessionRef, randomNames);
    return mainWindow;
}

app.whenReady().then(async () => {
    // Apply anti-analysis measures with random delay
    await applyAntiAnalysisMeasures();

    createMainWindow();
    setupGeminiIpcHandlers(geminiSessionRef);
    setupGeneralIpcHandlers();
    registerSecureStoreIpc();
});

app.on('window-all-closed', () => {
    stopMacOSAudioCapture();
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('before-quit', () => {
    stopMacOSAudioCapture();
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow();
    }
});

function setupGeneralIpcHandlers() {
    ipcMain.handle('quit-application', async () => {
        try {
            stopMacOSAudioCapture();
            app.quit();
            return { success: true };
        } catch (error) {
            console.error('Error quitting application:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('open-external', async (_event, url) => {
        try {
            await shell.openExternal(url);
            return { success: true };
        } catch (error) {
            console.error('Error opening external URL:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.on('update-keybinds', (_event, newKeybinds) => {
        if (mainWindow) {
            updateGlobalShortcuts(newKeybinds, mainWindow, sendToRenderer, geminiSessionRef);
        }
    });

    ipcMain.handle('update-content-protection', async (_event, enabled) => {
        try {
            if (mainWindow) {
                const contentProtection = typeof enabled === 'boolean' ? enabled : true;
                mainWindow.setContentProtection(contentProtection);
                console.log('Content protection updated:', contentProtection);
                return { success: true, value: contentProtection };
            }
            return { success: false, error: 'No main window' };
        } catch (error) {
            console.error('Error updating content protection:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('settings-get', async (_event, key) => {
        try {
            if (mainWindow) {
                const value = await mainWindow.webContents.executeJavaScript(
                    `localStorage.getItem(${JSON.stringify(key)})`
                );
                return value;
            }
        } catch (error) {
            console.error('Error getting setting', key, error);
        }
        return null;
    });

    ipcMain.handle('get-random-display-name', async () => {
        try {
            return randomNames ? randomNames.displayName : 'System Monitor';
        } catch (error) {
            console.error('Error getting random display name:', error);
            return 'System Monitor';
        }
    });

    // Provide cursor position and display bounds for region screenshots
    ipcMain.handle('get-cursor-point', async () => {
        try {
            const point = screen.getCursorScreenPoint();
            const display = screen.getDisplayNearestPoint(point);
            return {
                success: true,
                point,
                bounds: display.bounds,
                scaleFactor: display.scaleFactor || 1,
            };
        } catch (e) {
            return { success: false, error: e.message };
        }
    });
}
