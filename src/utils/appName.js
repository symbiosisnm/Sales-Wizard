const DEFAULT_APP_NAME = 'Sales Wizard';

function normalizeAppName(name, fallback = DEFAULT_APP_NAME) {
    if (typeof name === 'string') {
        const trimmed = name.trim();
        if (trimmed.length > 0) {
            return trimmed;
        }
    }
    return fallback;
}

function getElectronApi() {
    if (typeof window !== 'undefined' && window?.electron) {
        return window.electron;
    }
    return null;
}

function fetchAppName(electronApi = getElectronApi(), fallback = DEFAULT_APP_NAME) {
    const safeFallback = normalizeAppName(fallback, DEFAULT_APP_NAME);
    if (!electronApi?.getAppName) {
        return Promise.resolve(safeFallback);
    }

    return Promise.resolve()
        .then(() => electronApi.getAppName())
        .then(name => normalizeAppName(name, safeFallback))
        .catch(() => safeFallback);
}

function subscribeToAppNameUpdates(electronApi = getElectronApi(), callback, fallback = DEFAULT_APP_NAME) {
    if (!electronApi?.onAppNameUpdated || typeof callback !== 'function') {
        return () => {};
    }

    const listener = (_event, name) => {
        callback(normalizeAppName(name, fallback));
    };

    electronApi.onAppNameUpdated(listener);

    return () => {
        if (electronApi?.removeAppNameUpdatedListener) {
            electronApi.removeAppNameUpdatedListener(listener);
        } else if (electronApi?.ipcRenderer?.removeListener) {
            electronApi.ipcRenderer.removeListener('app-name-updated', listener);
        }
    };
}

function computeHeaderTitle(view, appName, fallback = DEFAULT_APP_NAME) {
    const resolvedName = normalizeAppName(appName, fallback);
    const titles = {
        onboarding: `Welcome to ${resolvedName}`,
        main: resolvedName,
        customize: 'Customize',
        help: 'Help & Shortcuts',
        history: 'Conversation History',
        advanced: 'Advanced Tools',
        assistant: resolvedName,
    };

    return titles[view] || resolvedName;
}

module.exports = {
    DEFAULT_APP_NAME,
    normalizeAppName,
    fetchAppName,
    subscribeToAppNameUpdates,
    computeHeaderTitle,
    getElectronApi,
};
