import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../../utils/config.js', () => ({
  getAppName: () => 'Test App',
}));

import '../AppHeader.js';

function getShadowRoot(element) {
  const root = element.shadowRoot;
  if (!root) {
    throw new Error('Shadow root not available');
  }
  return root;
}

describe('AppHeader', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('renders streaming status indicators for assistant view', async () => {
    const element = document.createElement('app-header');
    document.body.appendChild(element);

    element.currentView = 'assistant';
    element.connectionState = 'connected';
    element.audioState = 'capturing';
    element.screenState = 'sharing';
    element.statusText = 'Live';
    element.onHideToggleClick = vi.fn();
    element.onCloseClick = vi.fn();

    await element.updateComplete;

    const root = getShadowRoot(element);
    const indicators = Array.from(root.querySelectorAll('.status-indicator'));
    expect(indicators).toHaveLength(3);
    expect(indicators.map(indicator => indicator.dataset.state)).toEqual([
      'connected',
      'capturing',
      'sharing',
    ]);

    const hideButton = root.querySelector('.button');
    hideButton.click();
    expect(element.onHideToggleClick).toHaveBeenCalled();
  });

  it('invokes navigation handlers in main view', async () => {
    const element = document.createElement('app-header');
    document.body.appendChild(element);

    element.currentView = 'main';
    element.advancedMode = false;
    element.onHistoryClick = vi.fn();
    element.onCustomizeClick = vi.fn();
    element.onHelpClick = vi.fn();
    element.onCloseClick = vi.fn();

    await element.updateComplete;
    const root = getShadowRoot(element);

    const buttons = Array.from(root.querySelectorAll('.icon-button'));
    buttons[0].click();
    expect(element.onHistoryClick).toHaveBeenCalled();

    buttons[1].click();
    expect(element.onCustomizeClick).toHaveBeenCalled();

    buttons[2].click();
    expect(element.onHelpClick).toHaveBeenCalled();
  });
});
