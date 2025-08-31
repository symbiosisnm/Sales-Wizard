const { test } = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');

test('AppHeader renders with default title', async () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
  global.window = dom.window;
  global.document = dom.window.document;
  global.customElements = dom.window.customElements;
  global.HTMLElement = dom.window.HTMLElement;
  global.Document = dom.window.Document;
  global.CSSStyleSheet = dom.window.CSSStyleSheet;
  global.navigator = dom.window.navigator;
  global.cheddar = { isMacOS: false };

  await import('../app/AppHeader.js');
  const el = document.createElement('app-header');
  document.body.appendChild(el);
  await el.updateComplete;
  const header = el.shadowRoot.querySelector('.header');
  assert.ok(header, 'header element should render');
  const title = el.shadowRoot.querySelector('.header-title');
  assert.strictEqual(title.textContent.trim(), 'Cheating Daddy');
});
