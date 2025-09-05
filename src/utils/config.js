/**
 * Utility helpers for accessing configuration values across
 * both the main and renderer processes.
 *
 * Environment variables are captured at module load time so that
 * renderer processes can safely access them without exposing the
 * entire `process.env` object.
 */

const env = (() => {
    if (typeof process !== 'undefined' && process.env) {
        return { ...process.env };
    }
    return {};
})();

function getEnvVar(key, defaultValue) {
    if (Object.prototype.hasOwnProperty.call(env, key)) {
        return env[key];
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

