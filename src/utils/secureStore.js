const { ipcMain } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
let keytar;

// Lazily require keytar to avoid issues if native module missing
function getKeytar() {
    if (keytar) return keytar;
    try {
        // eslint-disable-next-line global-require
        keytar = require('keytar');
        return keytar;
    } catch (e) {
        return null;
    }
}

const SERVICE = 'sales-wizard';
const ACCOUNT = 'openai_api_key';
const KEYCHAIN_TIMEOUT_MS = 1500;
const OPENAI_KEY_PATTERN = /sk-[A-Za-z0-9_-]{20,}/g;
const LOCAL_STORAGE_APP_NAMES = ['Sales Wizard', 'sales-wizard', 'cheating-daddy'];

function withTimeout(promise) {
    let timeoutId;
    const timeout = new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error('Keychain request timed out')), KEYCHAIN_TIMEOUT_MS);
    });
    return Promise.race([promise, timeout]).finally(() => {
        clearTimeout(timeoutId);
    });
}

async function secureGetApiKey() {
    const kt = getKeytar();
    if (kt) {
        try {
            const v = await withTimeout(kt.getPassword(SERVICE, ACCOUNT));
            if (v) return v;
        } catch (_e) {
            /* fall through to legacy localStorage migration */
        }
    }

    const migrated = readLegacyLocalStorageApiKey();
    if (!migrated) return null;

    if (kt) {
        try {
            await withTimeout(kt.setPassword(SERVICE, ACCOUNT, migrated));
        } catch (_e) {
            /* returning the migrated key still unblocks this launch */
        }
    }

    return migrated;
}

async function secureSetApiKey(value) {
    const kt = getKeytar();
    if (!kt) return false;
    try {
        if (!value) {
            await withTimeout(kt.deletePassword(SERVICE, ACCOUNT));
            return true;
        }
        await withTimeout(kt.setPassword(SERVICE, ACCOUNT, value));
        return true;
    } catch (_e) {
        return false;
    }
}

function registerSecureStoreIpc() {
    ipcMain.handle('secure-get-api-key', async () => {
        const v = await secureGetApiKey();
        return { success: true, value: v };
    });
    ipcMain.handle('secure-set-api-key', async (_event, value) => {
        const ok = await secureSetApiKey(value);
        return { success: ok };
    });
}

function getApplicationSupportDir() {
    const home = os.homedir();
    if (process.platform === 'darwin') {
        return path.join(home, 'Library', 'Application Support');
    }
    if (process.platform === 'win32') {
        return process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
    }
    return process.env.XDG_CONFIG_HOME || path.join(home, '.config');
}

function findOpenAiApiKeyInText(text) {
    const matches = String(text || '').match(OPENAI_KEY_PATTERN) || [];
    return matches.find(value => value.length > 40) || '';
}

function readLegacyLocalStorageApiKey() {
    const appSupportDir = getApplicationSupportDir();
    for (const appName of LOCAL_STORAGE_APP_NAMES) {
        const levelDbDir = path.join(appSupportDir, appName, 'Local Storage', 'leveldb');
        if (!fs.existsSync(levelDbDir)) continue;

        let files = [];
        try {
            files = fs.readdirSync(levelDbDir);
        } catch (_e) {
            continue;
        }

        for (const file of files) {
            const filePath = path.join(levelDbDir, file);
            try {
                const stat = fs.statSync(filePath);
                if (!stat.isFile() || stat.size > 25 * 1024 * 1024) continue;
                const value = findOpenAiApiKeyInText(fs.readFileSync(filePath, 'latin1'));
                if (value) return value;
            } catch (_e) {
                /* keep scanning other storage files */
            }
        }
    }

    return '';
}

module.exports = {
    findOpenAiApiKeyInText,
    readLegacyLocalStorageApiKey,
    registerSecureStoreIpc,
    secureGetApiKey,
    secureSetApiKey,
};
