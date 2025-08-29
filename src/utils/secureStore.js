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

const SERVICE = 'cheating-daddy';
const ACCOUNT = 'gemini_api_key';

async function secureGetApiKey() {
    const kt = getKeytar();
    if (!kt) return null;
    try {
        const v = await kt.getPassword(SERVICE, ACCOUNT);
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
            await kt.deletePassword(SERVICE, ACCOUNT);
            return true;
        }
        await kt.setPassword(SERVICE, ACCOUNT, value);
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
