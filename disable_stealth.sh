#!/usr/bin/env bash
set -euo pipefail

# 1) Replace stealth modules with no-ops
cat > src/utils/stealthFeatures.js <<'JS'
/** Stealth disabled: no-ops **/
function applyStealthMeasures(_mainWindow) {}
function startTitleRandomization(_mainWindow) { return null; }
function applyAntiAnalysisMeasures() {}
module.exports = { applyStealthMeasures, startTitleRandomization, applyAntiAnalysisMeasures };
JS

cat > src/utils/processRandomizer.js <<'JS'
/** Randomization disabled: stable names **/
function initializeRandomProcessNames() {
  return {
    processName: 'SalesWizard',
    displayName: 'Sales Wizard',
    windowTitle: 'Sales Wizard'
  };
}
function setRandomProcessTitle() { return 'SalesWizard'; }
module.exports = { initializeRandomProcessNames, setRandomProcessTitle };
JS

# 2) Make the window visible and disable content protection/hiding
perl -0777 -i -pe "s/show:\\s*false/show: true/" src/utils/window.js
perl -0777 -i -pe "s/mainWindow\\.setContentProtection\\(true\\)/mainWindow.setContentProtection(false)/g" src/utils/window.js src/index.js
perl -0777 -i -pe "s/\\.setHiddenInMissionControl\\(true\\);//g" src/utils/stealthFeatures.js src/utils/window.js

# 3) Default content protection to false in renderer/UI settings
perl -0777 -i -pe "s/return contentProtection !== null \\? contentProtection === 'true' : true;/return contentProtection !== null ? contentProtection === 'true' : false;/" src/utils/renderer.js
perl -0777 -i -pe "s/this\\.contentProtection = true;/this.contentProtection = false;/" src/components/views/AdvancedView.js

# 4) Force STEALTH off in .env (adds it if missing)
if grep -q '^STEALTH=' .env 2>/dev/null; then
  perl -0777 -i -pe "s/^STEALTH=.*/STEALTH=0/m" .env
else
  printf "\\nSTEALTH=0\\n" >> .env
fi

