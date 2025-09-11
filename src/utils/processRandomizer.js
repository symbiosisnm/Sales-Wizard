// processRandomizer.js - Return stable process names

const IDENTIFIERS = {
    processName: 'SalesWizard',
    displayName: 'Sales Wizard',
    windowTitle: 'Sales Wizard',
};

/**
 * Initialize process names for the current session.
 * Returns static identifiers used throughout the application.
 */
function initializeRandomProcessNames() {
    return { ...IDENTIFIERS };
}

/**
 * No-op setter for process title.
 * Maintains compatibility with previous API by returning a fixed process name.
 */
function setRandomProcessTitle() {
    return IDENTIFIERS.processName;
}

module.exports = {
    initializeRandomProcessNames,
    setRandomProcessTitle,
};
