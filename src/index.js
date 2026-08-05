if (require('electron-squirrel-startup')) {
    process.exit(0);
}
require("./utils/logger");

const { app, BrowserWindow, shell, ipcMain, screen, dialog } = require('electron');
const { createWindow, updateGlobalShortcuts } = require('./utils/window');
const { sendToRenderer } = require('./utils/ipcUtils');
const { exportSession } = require('./utils/sessionExports');
const { registerSecureStoreIpc } = require('./utils/secureStore');
const { initializeRandomProcessNames } = require('./utils/processRandomizer');
const { applyAntiAnalysisMeasures } = require('./utils/stealthFeatures');

let mainWindow = null;
let contextParams = {
    allowedSources: '',
    toneLength: '',
    disallowedTopics: '',
};

const BACKEND_BASE_URL = process.env.LOCAL_BACKEND_URL || 'http://127.0.0.1:3001';

// Initialize random process names for stealth
const randomNames = initializeRandomProcessNames();

function createMainWindow() {
    mainWindow = createWindow(sendToRenderer, randomNames);
    return mainWindow;
}

app.whenReady().then(async () => {
    // Apply anti-analysis measures with random delay
    await applyAntiAnalysisMeasures();

    createMainWindow();
    setupGeneralIpcHandlers();
    registerSecureStoreIpc();
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow();
    }
});

function setupGeneralIpcHandlers() {
    const backendJsonRequest = async (requestPath, { method = 'GET', body } = {}) => {
        const response = await fetch(`${BACKEND_BASE_URL}${requestPath}`, {
            method,
            headers: body ? { 'Content-Type': 'application/json' } : undefined,
            body: body ? JSON.stringify(body) : undefined,
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(payload?.error || `Backend request failed: ${requestPath}`);
        }
        return payload;
    };

    ipcMain.handle('quit-application', async () => {
        try {
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
            updateGlobalShortcuts(newKeybinds, mainWindow, sendToRenderer);
        }
    });

    ipcMain.handle('update-content-protection', async () => {
        try {
            if (mainWindow) {
                const contentProtection = await mainWindow.webContents.executeJavaScript(`
                    (() => {
                        const value = localStorage.getItem('contentProtection');
                        return value !== null ? value === 'true' : false;
                    })()
                `);
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

    ipcMain.handle('export-session', async (_event, options) => {
        try {
            const { blob, filename } = exportSession(options);
            const buffer = Buffer.from(await blob.arrayBuffer());
            return {
                success: true,
                data: buffer.toString('base64'),
                filename,
                mimeType: blob.type,
            };
        } catch (error) {
            logger.error('Error exporting session:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('set-context-params', async (_event, params) => {
        contextParams = { ...contextParams, ...params };
        return { success: true };
    });

    ipcMain.handle('get-context-params', async () => {
        return { success: true, data: contextParams };
    });

    ipcMain.handle('knowledge-list', async (_event, options = {}) => {
        try {
            const searchParams = new URLSearchParams();
            if (options.scope) {
                searchParams.set('scope', options.scope);
            }
            if (options.sessionId) {
                searchParams.set('sessionId', options.sessionId);
            }
            const query = searchParams.toString();
            const payload = await backendJsonRequest(`/knowledge${query ? `?${query}` : ''}`);
            return { success: true, ...payload };
        } catch (error) {
            logger.error('Error listing knowledge:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('knowledge-import-guideline', async (_event, options = {}) => {
        try {
            const payload = await backendJsonRequest('/knowledge/guideline', {
                method: 'POST',
                body: options,
            });
            return { success: true, ...payload };
        } catch (error) {
            logger.error('Error importing guideline knowledge:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('knowledge-import-url', async (_event, options = {}) => {
        try {
            const payload = await backendJsonRequest('/knowledge/url', {
                method: 'POST',
                body: options,
            });
            return { success: true, ...payload };
        } catch (error) {
            logger.error('Error importing URL knowledge:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('knowledge-import-file', async (_event, options = {}) => {
        try {
            let filePath = typeof options.path === 'string' ? options.path.trim() : '';
            if (!filePath) {
                const dialogResult = await dialog.showOpenDialog(mainWindow || undefined, {
                    properties: ['openFile'],
                    filters: [
                        {
                            name: 'Knowledge Assets',
                            extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'svg', 'mp4', 'mov', 'm4v', 'avi', 'mkv', 'webm', 'txt', 'md'],
                        },
                    ],
                });
                if (dialogResult.canceled || !dialogResult.filePaths?.length) {
                    return { success: false, canceled: true };
                }
                filePath = dialogResult.filePaths[0];
            }
            const payload = await backendJsonRequest('/knowledge/file', {
                method: 'POST',
                body: {
                    ...options,
                    path: filePath,
                },
            });
            return { success: true, ...payload };
        } catch (error) {
            logger.error('Error importing file knowledge:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('knowledge-update', async (_event, options = {}) => {
        try {
            if (!options.id) {
                throw new Error('Knowledge item id is required');
            }
            const payload = await backendJsonRequest(`/knowledge/${encodeURIComponent(options.id)}`, {
                method: 'PATCH',
                body: options,
            });
            return { success: true, ...payload };
        } catch (error) {
            logger.error('Error updating knowledge:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('knowledge-delete', async (_event, options = {}) => {
        try {
            if (!options.id) {
                throw new Error('Knowledge item id is required');
            }
            const payload = await backendJsonRequest(`/knowledge/${encodeURIComponent(options.id)}`, {
                method: 'DELETE',
            });
            return { success: true, ...payload };
        } catch (error) {
            logger.error('Error deleting knowledge:', error);
            return { success: false, error: error.message };
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
