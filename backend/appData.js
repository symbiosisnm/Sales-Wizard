const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
  return dirPath;
}

function resolveAppDataRoot() {
  const explicit = String(process.env.SALES_WIZARD_DATA_DIR || '').trim();
  if (explicit) {
    return ensureDir(explicit);
  }

  const homeDir = os.homedir();
  if (process.platform === 'darwin') {
    return ensureDir(path.join(homeDir, 'Library', 'Application Support', 'Sales Wizard'));
  }
  if (process.platform === 'win32') {
    const appDataDir = process.env.APPDATA || path.join(homeDir, 'AppData', 'Roaming');
    return ensureDir(path.join(appDataDir, 'Sales Wizard'));
  }
  const xdgDataHome = process.env.XDG_DATA_HOME || path.join(homeDir, '.local', 'share');
  return ensureDir(path.join(xdgDataHome, 'sales-wizard'));
}

function resolveKnowledgePaths() {
  const rootDir = resolveAppDataRoot();
  const knowledgeDir = ensureDir(path.join(rootDir, 'knowledge'));
  const assetsDir = ensureDir(path.join(knowledgeDir, 'assets'));
  const clipsDir = ensureDir(path.join(knowledgeDir, 'clips'));
  const tempDir = ensureDir(path.join(knowledgeDir, 'tmp'));
  const dbFile = path.join(knowledgeDir, 'knowledge.json');

  return {
    rootDir,
    knowledgeDir,
    assetsDir,
    clipsDir,
    tempDir,
    dbFile,
  };
}

module.exports = {
  ensureDir,
  resolveAppDataRoot,
  resolveKnowledgePaths,
};
