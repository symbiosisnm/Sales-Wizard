const { ipcMain } = require('electron');
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
    if (!kt) return null;
    try {
        const v = await withTimeout(kt.getPassword(SERVICE, ACCOUNT));
        return v || null;
    } catch (_e) {
        return null;
    }
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

module.exports = { registerSecureStoreIpc, secureGetApiKey, secureSetApiKey };
