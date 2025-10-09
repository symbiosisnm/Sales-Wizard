const { mock } = require('node:test');

function setupRendererGlobals() {
  const previous = {
    window: global.window,
    document: global.document,
    customElements: global.customElements,
    localStorage: global.localStorage,
    logger: global.logger,
    crypto: global.crypto,
    self: global.self,
    navigator: global.navigator,
    HTMLElement: global.HTMLElement,
    DocumentFragment: global.DocumentFragment,
  };

  const storage = new Map();
  const localStorage = {
    getItem: key => (storage.has(key) ? storage.get(key) : null),
    setItem: (key, value) => {
      storage.set(key, String(value));
    },
    removeItem: key => {
      storage.delete(key);
    },
    clear: () => {
      storage.clear();
    },
  };

  const classList = {
    add: mock.fn(),
    remove: mock.fn(),
    contains: mock.fn(() => false),
  };

  global.localStorage = localStorage;
  global.self = global;
  global.crypto = { randomUUID: () => 'test-uuid' };
  global.HTMLElement = global.HTMLElement || class {};
  global.logger = {
    info: mock.fn(),
    warn: mock.fn(),
    error: mock.fn(),
  };
  const createElement = tag => ({
    nodeName: String(tag || '').toUpperCase(),
    style: {},
    childNodes: [],
    appendChild(node) {
      this.childNodes.push(node);
      return node;
    },
    removeChild(node) {
      this.childNodes = this.childNodes.filter(child => child !== node);
      return node;
    },
    setAttribute() {},
    removeAttribute() {},
  });

  global.document = {
    documentElement: { classList },
    body: {
      appendChild: () => {},
      removeChild: () => {},
    },
    createElement,
    createTextNode: text => ({ textContent: text }),
    createComment: text => ({ textContent: text }),
    createTreeWalker: () => ({
      currentNode: null,
      nextNode: () => null,
    }),
    importNode: node => node,
  };

  global.DocumentFragment = class {
    constructor() {
      this.childNodes = [];
    }
    appendChild(node) {
      this.childNodes.push(node);
      return node;
    }
  };

  const registry = new Map();
  global.customElements = {
    define: (name, ctor) => {
      registry.set(name, ctor);
    },
    get: name => registry.get(name),
  };

  const windowStub = previous.window || {};
  windowStub.localStorage = localStorage;
  windowStub.electron = windowStub.electron || {};
  windowStub.salesWizard = windowStub.salesWizard || {};
  windowStub.HTMLElement = global.HTMLElement;
  windowStub.document = global.document;
  windowStub.Node = windowStub.Node || class {};
  windowStub.NodeFilter = windowStub.NodeFilter || { SHOW_ELEMENT: 1 };
  windowStub.DocumentFragment = global.DocumentFragment;
  global.window = windowStub;
  global.navigator = global.navigator || { userAgent: 'node' };

  return {
    storage,
    localStorage,
    classList,
    cleanup: () => {
      if (previous.window === undefined) delete global.window;
      else global.window = previous.window;

      if (previous.document === undefined) delete global.document;
      else global.document = previous.document;

      if (previous.customElements === undefined) delete global.customElements;
      else global.customElements = previous.customElements;

      if (previous.localStorage === undefined) delete global.localStorage;
      else global.localStorage = previous.localStorage;

      if (previous.logger === undefined) delete global.logger;
      else global.logger = previous.logger;

      if (previous.crypto === undefined) delete global.crypto;
      else global.crypto = previous.crypto;

      if (previous.HTMLElement === undefined) delete global.HTMLElement;
      else global.HTMLElement = previous.HTMLElement;

      if (previous.DocumentFragment === undefined) delete global.DocumentFragment;
      else global.DocumentFragment = previous.DocumentFragment;

      if (previous.self === undefined) delete global.self;
      else global.self = previous.self;

      if (previous.navigator === undefined) delete global.navigator;
      else global.navigator = previous.navigator;
    },
  };
}

module.exports = { setupRendererGlobals };
