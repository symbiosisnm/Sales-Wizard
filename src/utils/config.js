/**
 * Utility helpers for accessing configuration values across
 * both the main and renderer processes.
 */

function getEnvVar(key, defaultValue) {
    if (
        typeof process !== 'undefined' &&
        process.env &&
        Object.prototype.hasOwnProperty.call(process.env, key)
    ) {
        return process.env[key];
    }
    if (
        typeof window !== 'undefined' &&
        window.env &&
        Object.prototype.hasOwnProperty.call(window.env, key)
    ) {
        return window.env[key];
    }
    return defaultValue;
}

function getAppName() {
    return getEnvVar('APP_NAME', 'Sales Wizard');
}

function getPort() {
    const port = getEnvVar('PORT', '3001');
    return Number(port);
}

function getGeminiApiKey() {
    return getEnvVar('GEMINI_API_KEY');
}

module.exports = {
    getEnvVar,
    getAppName,
    getPort,
    getGeminiApiKey,
};

