const DEFAULT_BACKEND_PORT = 3001;

const stripTrailingSlash = value => (typeof value === 'string' ? value.replace(/\/+$/, '') : value);

const getGlobalOverride = key => {
  if (typeof globalThis !== 'undefined' && globalThis[key]) {
    return String(globalThis[key]);
  }
  return undefined;
};

const getProcessEnv = key => {
  if (typeof process !== 'undefined' && process?.env && process.env[key]) {
    return process.env[key];
  }
  return undefined;
};

const getBackendOverride = () =>
  getProcessEnv('BACKEND_URL') ||
  getProcessEnv('SALES_WIZARD_BACKEND_URL') ||
  getGlobalOverride('SALES_WIZARD_BACKEND_URL');

const getLiveWsOverride = () =>
  getProcessEnv('LIVE_WS_URL') ||
  getProcessEnv('SALES_WIZARD_LIVE_WS_URL') ||
  getGlobalOverride('SALES_WIZARD_LIVE_WS_URL');

const normaliseUrl = url => {
  if (!url) return url;
  try {
    const parsed = new URL(url);
    if (!parsed.pathname || parsed.pathname === '/') {
      parsed.pathname = '';
    }
    parsed.hash = '';
    return stripTrailingSlash(parsed.toString());
  } catch (err) {
    return stripTrailingSlash(url);
  }
};

function resolveBackendOrigin() {
  const override = normaliseUrl(getBackendOverride());
  if (override) {
    return override;
  }

  if (typeof window !== 'undefined' && window.location) {
    const protocol = window.location.protocol === 'https:' ? 'https:' : 'http:';
    const hostname = window.location.hostname || 'localhost';
    return `${protocol}//${hostname}:${DEFAULT_BACKEND_PORT}`;
  }

  return `http://localhost:${DEFAULT_BACKEND_PORT}`;
}

function resolveLiveWsUrl() {
  const override = stripTrailingSlash(getLiveWsOverride());
  if (override) {
    return override;
  }

  try {
    const origin = resolveBackendOrigin();
    const parsed = new URL(origin);
    const protocol = parsed.protocol === 'https:' ? 'wss:' : 'ws:';
    const hostname = parsed.hostname || 'localhost';
    const port = parsed.port || String(DEFAULT_BACKEND_PORT);
    return `${protocol}//${hostname}:${port}/live`;
  } catch (err) {
    const origin = resolveBackendOrigin();
    const protocol = origin.startsWith('https') ? 'wss:' : 'ws:';
    const stripped = origin.replace(/^https?:\/\//, '');
    const withPort = stripped.includes(':') ? stripped : `${stripped}:${DEFAULT_BACKEND_PORT}`;
    return `${protocol}//${withPort}/live`;
  }
}

const api = {
  DEFAULT_BACKEND_PORT,
  resolveBackendOrigin,
  resolveLiveWsUrl,
};

export { DEFAULT_BACKEND_PORT, resolveBackendOrigin, resolveLiveWsUrl };
export default api;

if (typeof module !== 'undefined') {
  module.exports = api;
}
