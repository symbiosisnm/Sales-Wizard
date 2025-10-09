const { app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

let settingsCache = null;

function getSettingsFilePath() {
    const userDataPath = app.getPath('userData');
    return path.join(userDataPath, 'settings.json');
}

function loadSettings() {
    if (settingsCache) {
        return settingsCache;
    }

    const filePath = getSettingsFilePath();

    try {
        if (fs.existsSync(filePath)) {
            const raw = fs.readFileSync(filePath, 'utf8');
            settingsCache = JSON.parse(raw);
            return settingsCache;
        }
    } catch (error) {
        (globalThis.logger || console).warn('Failed to load settings, using defaults:', error);
    }

    settingsCache = {};
    return settingsCache;
}

function saveSettings() {
    const filePath = getSettingsFilePath();
    const directory = path.dirname(filePath);

    try {
        fs.mkdirSync(directory, { recursive: true });
        fs.writeFileSync(filePath, JSON.stringify(settingsCache ?? {}, null, 2), 'utf8');
    } catch (error) {
        (globalThis.logger || console).error('Failed to persist settings:', error);
    }
}

function getSetting(key, defaultValue = undefined) {
    const settings = loadSettings();
    if (Object.prototype.hasOwnProperty.call(settings, key)) {
        return settings[key];
    }
    return defaultValue;
}

function setSetting(key, value) {
    const settings = loadSettings();

    if (value === undefined) {
        delete settings[key];
    } else {
        settings[key] = value;
    }

    saveSettings();
    return settings[key];
}

module.exports = {
    getSetting,
    setSetting,
};
