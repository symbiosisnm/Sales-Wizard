// stealthFeatures.js - Additional stealth features for process hiding

const { getCurrentRandomDisplayName } = require('./processNames');
const { app } = require('electron');

const STEALTH = process.env.STEALTH === '1';

/**
 * Apply additional stealth measures to the Electron application
 * @param {BrowserWindow} mainWindow - The main application window
 */
function applyStealthMeasures(mainWindow) {
    if (!STEALTH) {
        return;
    }
    logger.info('Applying additional stealth measures...');

    // Hide from alt-tab on Windows
    if (process.platform === 'win32') {
        try {
            mainWindow.setSkipTaskbar(true);
            logger.info('Hidden from Windows taskbar');
        } catch (error) {
            logger.warn('Could not hide from taskbar:', error.message);
        }
    }

    // Hide from Dock and Mission Control on macOS
    if (process.platform === 'darwin') {
        try {
            app.dock?.hide?.();
            mainWindow.setHiddenInMissionControl(true);
            logger.info('Hidden from macOS Dock and Mission Control');
        } catch (error) {
            logger.warn('Could not hide from Dock/Mission Control:', error.message);
        }

        try {
            const randomName = getCurrentRandomDisplayName();
            app.setName(randomName);
            logger.info(`Set app name to: ${randomName}`);
        } catch (error) {
            logger.warn('Could not set app name:', error.message);
        }
    }

    // Randomize window user agent
    try {
        const userAgents = [
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
            'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36',
        ];
        const randomUA = userAgents[Math.floor(Math.random() * userAgents.length)];
        mainWindow.webContents.setUserAgent(randomUA);
        logger.info('Set random user agent');
    } catch (error) {
        logger.warn('Could not set user agent:', error.message);
    }
}

/**
 * Periodically randomize window title to avoid detection
 * @param {BrowserWindow} mainWindow - The main application window
 */
function startTitleRandomization(mainWindow) {
    const titles = [
        'System Configuration',
        'Audio Settings',
        'Network Monitor',
        'Performance Monitor',
        'System Information',
        'Device Manager',
        'Background Services',
        'System Updates',
        'Security Center',
        'Task Manager',
        'Resource Monitor',
        'System Properties',
        'Network Connections',
        'Audio Devices',
        'Display Settings',
        'Power Options',
        'System Tools',
        'Hardware Monitor',
    ];

    // Change title every 30-60 seconds
    const interval = setInterval(() => {
        try {
            if (!mainWindow.isDestroyed()) {
                const randomTitle = titles[Math.floor(Math.random() * titles.length)];
                mainWindow.setTitle(randomTitle);
            } else {
                clearInterval(interval);
            }
        } catch (error) {
            logger.warn('Could not update window title:', error.message);
            clearInterval(interval);
        }
    }, 30000 + Math.random() * 30000); // 30-60 seconds

    return interval;
}

/**
 * Anti-debugging and anti-analysis measures
 */
function applyAntiAnalysisMeasures() {
    logger.info('Applying anti-analysis measures...');

    // Clear console on production
    if (process.env.NODE_ENV === 'production') {
        logger.debug('Clearing console');
    }

    // Randomize startup delay to avoid pattern detection
    const delay = 1000 + Math.random() * 3000; // 1-4 seconds
    return new Promise(resolve => {
        setTimeout(resolve, delay);
    });
}

module.exports = {
    applyStealthMeasures,
    startTitleRandomization,
    applyAntiAnalysisMeasures,
};
