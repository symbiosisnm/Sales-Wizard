const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '../../..');

function readSource(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

test('first launch uses the API-key gate instead of onboarding', () => {
  const appSource = readSource('src/components/app/SalesWizardApp.js');
  const mainViewSource = readSource('src/components/views/MainView.js');

  assert.doesNotMatch(appSource, /OnboardingView/);
  assert.doesNotMatch(appSource, /case\s+['"]onboarding['"]/);
  assert.match(appSource, /this\.currentView\s*=\s*['"]main['"]/);
  assert.match(mainViewSource, /Enter your OpenAI API key/);
  assert.doesNotMatch(mainViewSource, /What Should I Focus On\?/);
});
