require('dotenv').config();
if (require('electron-squirrel-startup')) {
    process.exit(0);
}
require('dotenv').config();
require('./utils/logger');

const { app, BrowserWindow, shell, ipcMain, screen } = require('electron');
const { createWindow, updateGlobalShortcuts } = require('./utils/window');
const { setupGeminiIpcHandlers, stopMacOSAudioCapture, sendToRenderer } = require('./utils/gemini');
const { registerSecureStoreIpc } = require('./utils/secureStore');
const { initializeRandomProcessNames } = require('./utils/processRandomizer');
const { applyAntiAnalysisMeasures } = require('./utils/stealthFeatures');

const DEFAULT_APP_NAME = 'Sales Wizard';
const appNameOverride = (process.env.APP_NAME || '').trim();

function resolveAppName() {
    const loggerInstance = globalThis.logger || console;
    const currentAppName = typeof app.getName === 'function' ? app.getName() : '';

    const sanitize = name => {
        if (typeof name !== 'string') {
            return '';
        }
        const trimmed = name.trim();
        if (!trimmed) {
            return '';
        }
        if (trimmed.toLowerCase() === 'sales-wizard') {
            return DEFAULT_APP_NAME;
        }
        return trimmed;
    };

    const sanitizedCurrent = sanitize(currentAppName);
    const finalName = appNameOverride || sanitizedCurrent || DEFAULT_APP_NAME;

    if (typeof app.setName === 'function' && finalName && finalName !== currentAppName) {
        try {
            app.setName(finalName);
        } catch (error) {
            loggerInstance?.warn?.('Failed to set application name', error);
        }
    }

    return finalName || DEFAULT_APP_NAME;
}

const resolvedAppName = resolveAppName();

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

app.on('browser-window-created', (_event, window) => {
    window.webContents.once('dom-ready', () => {
        try {
            window.webContents.send('app-name-updated', resolvedAppName);
        } catch (error) {
            const loggerInstance = globalThis.logger || console;
            loggerInstance?.warn?.('Failed to send application name to renderer', error);
        }
    });
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
                // Get content protection setting from localStorage via Sales Wizard
                const contentProtection = await mainWindow.webContents.executeJavaScript('salesWizard.getContentProtection()');
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

    ipcMain.handle('get-app-name', async () => {
        try {
            return resolvedAppName;
        } catch (error) {
            logger.error('Error resolving app name:', error);
            return resolvedAppName;
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
