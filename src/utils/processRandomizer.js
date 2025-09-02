// processRandomizer.js - Apply random process names at startup

const { getCurrentRandomName, getCurrentRandomDisplayName, generateRandomWindowTitle } = require('./processNames');

/**
 * Initialize random process names for the current session
 * This should be called early in the application startup
 */
function initializeRandomProcessNames() {
    logger.info('Initializing random process names for stealth...');

    const randomName = getCurrentRandomName();
    const randomDisplayName = getCurrentRandomDisplayName();
    const windowTitle = generateRandomWindowTitle();

    logger.info(`Process name: ${randomName}`);
    logger.info(`Display name: ${randomDisplayName}`);
    logger.info(`Window title: ${windowTitle}`);

    // Set process title to appear as a different process in task manager
    setRandomProcessTitle();

    return {
        processName: randomName,
        displayName: randomDisplayName,
        windowTitle: windowTitle,
    };
}

/**
 * Set a random process title for the current process
 * This changes how the process appears in task manager/process lists
 */
function setRandomProcessTitle() {
    try {
        const randomProcessName = getCurrentRandomName();
        process.title = randomProcessName;
        logger.info(`Set process title to: ${randomProcessName}`);
        return randomProcessName;
    } catch (error) {
        logger.warn('Could not set process title:', error.message);
        return null;
    }
}

module.exports = {
    initializeRandomProcessNames,
    setRandomProcessTitle,
};
