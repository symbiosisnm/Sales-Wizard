if (require('electron-squirrel-startup')) {
    process.exit(0);
}
require("./utils/logger");

const { app, BrowserWindow, shell, ipcMain, screen } = require('electron');
const { createWindow, updateGlobalShortcuts } = require('./utils/window');
const { setupGeminiIpcHandlers, stopSystemAudioCapture, sendToRenderer } = require('./utils/gemini');
const { registerSecureStoreIpc } = require('./utils/secureStore');
const { initializeRandomProcessNames } = require('./utils/processRandomizer');
const { applyAntiAnalysisMeasures } = require('./utils/stealthFeatures');

const geminiSessionRef = { current: null };
let mainWindow = null;
let contextParams = {
    allowedSources: '',
    toneLength: '',
    disallowedTopics: '',
};

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
    stopSystemAudioCapture();
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('before-quit', () => {
    stopSystemAudioCapture();
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow();
    }
});

function setupGeneralIpcHandlers() {
    ipcMain.handle('quit-application', async () => {
        try {
            stopSystemAudioCapture();
            app.quit();
            return { success: true };
        } catch (error) {
            logger.error('Error quitting application:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('open-external', async (_event, url) => {
        try {
            await shell.openExternal(url);
            return { success: true };
        } catch (error) {
            logger.error('Error opening external URL:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.on('update-keybinds', (_event, newKeybinds) => {
        if (mainWindow) {
            updateGlobalShortcuts(newKeybinds, mainWindow, sendToRenderer, geminiSessionRef);
        }
    });

    ipcMain.handle('update-content-protection', async () => {
        try {
            if (mainWindow) {
                // Get content protection setting from localStorage via cheddar
                const contentProtection = await mainWindow.webContents.executeJavaScript('cheddar.getContentProtection()');
                mainWindow.setContentProtection(contentProtection);
                logger.info('Content protection updated:', contentProtection);
            }
            return { success: true };
        } catch (error) {
            logger.error('Error updating content protection:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('get-random-display-name', async () => {
        try {
            return randomNames ? randomNames.displayName : 'System Monitor';
        } catch (error) {
            logger.error('Error getting random display name:', error);
            return 'System Monitor';
        }
    });

    ipcMain.handle('set-context-params', async (_event, params) => {
        contextParams = { ...contextParams, ...params };
        return { success: true };
    });

    ipcMain.handle('get-context-params', async () => {
        return { success: true, data: contextParams };
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
