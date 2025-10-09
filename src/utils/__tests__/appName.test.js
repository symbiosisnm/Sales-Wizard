const { test, mock } = require('node:test');
const assert = require('node:assert');

const {
    fetchAppName,
    subscribeToAppNameUpdates,
    computeHeaderTitle,
    DEFAULT_APP_NAME,
} = require('../appName.js');

test('custom application names propagate to header titles', async () => {
    let registeredHandler = null;
    const electronApi = {
        getAppName: mock.fn(async () => 'Custom Wizard'),
        onAppNameUpdated: mock.fn(handler => {
            registeredHandler = handler;
        }),
        removeAppNameUpdatedListener: mock.fn(() => {
            registeredHandler = null;
        }),
    };

    const resolvedName = await fetchAppName(electronApi, DEFAULT_APP_NAME);
    assert.strictEqual(resolvedName, 'Custom Wizard');
    assert.strictEqual(electronApi.getAppName.mock.callCount(), 1);

    let latestName = resolvedName;
    const unsubscribe = subscribeToAppNameUpdates(electronApi, name => {
        latestName = name;
    }, DEFAULT_APP_NAME);

    assert.strictEqual(typeof unsubscribe, 'function');
    assert.strictEqual(electronApi.onAppNameUpdated.mock.callCount(), 1);
    assert.ok(registeredHandler, 'handler should be registered');

    registeredHandler({}, 'Wizard Deluxe');
    assert.strictEqual(latestName, 'Wizard Deluxe');
    assert.strictEqual(computeHeaderTitle('onboarding', latestName, DEFAULT_APP_NAME), 'Welcome to Wizard Deluxe');
    assert.strictEqual(computeHeaderTitle('main', latestName, DEFAULT_APP_NAME), 'Wizard Deluxe');

    unsubscribe();
    assert.strictEqual(electronApi.removeAppNameUpdatedListener.mock.callCount(), 1);
    assert.strictEqual(registeredHandler, null);
});
