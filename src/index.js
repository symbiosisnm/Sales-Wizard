require('dotenv').config();
if (require('electron-squirrel-startup')) {
    process.exit(0);
}
require('dotenv').config();
require("./utils/logger");

const { app, BrowserWindow, shell, ipcMain, screen } = require('electron');
const { createWindow, updateGlobalShortcuts } = require('./utils/window');
const { setupGeminiIpcHandlers, stopMacOSAudioCapture, sendToRenderer } = require('./utils/gemini');
const { registerSecureStoreIpc } = require('./utils/secureStore');

const geminiSessionRef = { current: null };
let mainWindow = null;
let contextParams = {
    allowedSources: '',
    toneLength: '',
    disallowedTopics: '',
};

const APP_DISPLAY_NAME = 'Sales Wizard';

function createMainWindow() {
    mainWindow = createWindow(sendToRenderer, geminiSessionRef);
    return mainWindow;
}

app.whenReady().then(async () => {
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

    const resolveAppDisplayName = () => APP_DISPLAY_NAME;

    ipcMain.handle('get-app-display-name', async () => {
        try {
            return resolveAppDisplayName();
        } catch (error) {
            logger.error('Error getting application display name:', error);
            return APP_DISPLAY_NAME;
        }
    });

    // Backwards compatibility for older preload scripts still invoking the legacy channel
    ipcMain.handle('get-random-display-name', async () => {
        try {
            return resolveAppDisplayName();
        } catch (error) {
            logger.error('Error getting application display name:', error);
            return APP_DISPLAY_NAME;
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

    // Provide active window bounds for window-region screenshots
    ipcMain.handle('get-active-window', async () => {
        try {
            const aw = (await import('active-win')).default;
            const info = await aw();
            if (!info?.bounds) {
                return { success: false, error: 'No active window information' };
            }
            const display = screen.getDisplayMatching(info.bounds);
            return {
                success: true,
                bounds: info.bounds,
                displayBounds: display.bounds,
                scaleFactor: display.scaleFactor || 1,
            };
        } catch (e) {
            return { success: false, error: e.message };
        }
    });
}
