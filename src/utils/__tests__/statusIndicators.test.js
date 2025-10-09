const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

function setupDom() {
    const registry = new Map();

    class MockShadowRoot {
        appendChild() {}
        querySelector() {
            return null;
        }
    }

    class MockHTMLElement {
        constructor() {
            this.shadowRoot = null;
        }

        attachShadow() {
            this.shadowRoot = new MockShadowRoot();
            return this.shadowRoot;
        }

        addEventListener() {}
        removeEventListener() {}
        dispatchEvent() {
            return true;
        }
    }

    const customElements = {
        define(name, ctor) {
            registry.set(name, ctor);
        },
        get(name) {
            return registry.get(name);
        },
    };

    const docEl = {
        classList: {
            add() {},
            remove() {},
        },
    };

    const document = {
        documentElement: docEl,
        body: {
            appendChild() {},
        },
        createElement: () => ({ style: {} }),
        createTreeWalker: () => ({ currentNode: null, nextNode: () => null }),
        importNode: node => node,
    };

    globalThis.window = {
        customElements,
        HTMLElement: MockHTMLElement,
        navigator: {},
        document,
    };
    globalThis.document = document;
    globalThis.HTMLElement = MockHTMLElement;
    globalThis.customElements = customElements;
    globalThis.ShadowRoot = MockShadowRoot;
    globalThis.navigator = {};
    globalThis.localStorage = {
        _data: new Map(),
        getItem(key) {
            return this._data.has(key) ? this._data.get(key) : null;
        },
        setItem(key, value) {
            this._data.set(key, String(value));
        },
        removeItem(key) {
            this._data.delete(key);
        },
        clear() {
            this._data.clear();
        },
    };

    const raf = cb => setTimeout(() => cb(Date.now()), 16);
    globalThis.requestAnimationFrame = raf;
    window.requestAnimationFrame = raf;
    globalThis.performance = { now: () => Date.now() };

    return { registry };
}

function moduleUrl(relativePath) {
    return pathToFileURL(path.join(__dirname, '..', '..', relativePath));
}

test('SalesWizardApp setStatus maps structured events to state flags', async () => {
    setupDom();
    const { SalesWizardApp } = await import(moduleUrl('components/app/SalesWizardApp.js'));
    const app = new SalesWizardApp();

    app.setStatus({ connection: 'connected', message: 'Live session connected' });
    assert.strictEqual(app.connectionState, 'connected');
    assert.strictEqual(app.connectionMessage, 'Live session connected');

    app.setStatus({ audio: { state: 'capturing' } });
    assert.strictEqual(app.audioState, 'capturing');
    assert.strictEqual(app.audioMessage, 'Microphone streaming');

    app.setStatus({ screen: { state: 'sharing', message: 'Screen capture active' } });
    assert.strictEqual(app.screenState, 'sharing');
    assert.strictEqual(app.screenMessage, 'Screen capture active');

    app.setStatus('Screen capture ended');
    assert.strictEqual(app.screenState, 'idle');
    assert.strictEqual(app.statusText, 'Screen capture ended');

    app.setStatus('WS error: timeout');
    assert.strictEqual(app.connectionState, 'error');
    assert.ok(app.connectionMessage.includes('WS error'));
});

test('AppHeader renders indicator templates with state attributes', async () => {
    setupDom();
    const { AppHeader } = await import(moduleUrl('components/app/AppHeader.js'));
    const header = new AppHeader();

    const connectionTemplate = header.renderIndicator({
        type: 'connection',
        state: 'connecting',
        message: 'Opening WebSocket',
    });
    assert.strictEqual(connectionTemplate.values[0], 'connecting');
    assert.strictEqual(connectionTemplate.values[1], 'connection');
    assert.strictEqual(connectionTemplate.values[2], 'connecting');
    assert.strictEqual(connectionTemplate.values[3], 'Opening WebSocket');

    header.connectionState = 'connected';
    header.connectionMessage = 'WS open';
    header.audioState = 'capturing';
    header.audioMessage = 'Listening';
    header.screenState = 'sharing';
    header.screenMessage = 'Screen active';

    const groupTemplate = header.renderStatusIndicators();
    const indicators = groupTemplate.values[0];
    assert.strictEqual(indicators.length, 3);
    const [connectionIndicator, audioIndicator, screenIndicator] = indicators;
    assert.strictEqual(connectionIndicator.values[0], 'connected');
    assert.strictEqual(audioIndicator.values[0], 'capturing');
    assert.strictEqual(screenIndicator.values[0], 'sharing');
});
