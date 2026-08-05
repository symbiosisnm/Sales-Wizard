const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const { ensureDir, resolveKnowledgePaths } = require('./appData');

const SESSION_ITEM_TTL_MS = 12 * 60 * 60 * 1000;
const KNOWLEDGE_ASSET_BASE_URL = process.env.LOCAL_BACKEND_URL || 'http://127.0.0.1:3001';

const VALID_KINDS = new Set(['guideline', 'link', 'image', 'video', 'clip']);
const VALID_SCOPES = new Set(['session', 'library']);

function cleanText(value = '') {
  return String(value || '').trim();
}

function normalizeTags(tags = []) {
  if (!Array.isArray(tags)) {
    return [];
  }
  return [...new Set(tags.map(tag => cleanText(tag).toLowerCase()).filter(Boolean))].slice(0, 16);
}

function normalizeScope(scope = 'library') {
  return VALID_SCOPES.has(scope) ? scope : 'library';
}

function normalizeKind(kind = 'guideline') {
  return VALID_KINDS.has(kind) ? kind : 'guideline';
}

function createKnowledgeId(prefix = 'knowledge') {
  return `${prefix}_${crypto.randomUUID()}`;
}

function buildAssetUrl(relativePath = '') {
  return `${KNOWLEDGE_ASSET_BASE_URL}/knowledge-assets/${relativePath.split(path.sep).map(encodeURIComponent).join('/')}`;
}

function ensureKnowledgeDb() {
  const { dbFile } = resolveKnowledgePaths();
  if (!fs.existsSync(dbFile)) {
    fs.writeFileSync(dbFile, JSON.stringify({ items: [] }, null, 2));
  }
}

function loadKnowledgeDb() {
  ensureKnowledgeDb();
  const { dbFile } = resolveKnowledgePaths();
  try {
    const raw = fs.readFileSync(dbFile, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      items: Array.isArray(parsed.items) ? parsed.items : [],
    };
  } catch (_error) {
    return { items: [] };
  }
}

function saveKnowledgeDb(db) {
  const { dbFile } = resolveKnowledgePaths();
  fs.writeFileSync(dbFile, JSON.stringify(db, null, 2));
}

function cleanupExpiredItems(db) {
  const now = Date.now();
  const activeItems = [];
  let removed = false;

  for (const item of db.items || []) {
    if (item.scope === 'session' && Number(item.expiresAt || 0) > 0 && Number(item.expiresAt) < now) {
      removed = true;
      continue;
    }
    activeItems.push(item);
  }

  if (removed) {
    db.items = activeItems;
    saveKnowledgeDb(db);
  }
  return activeItems;
}

function serializeAsset(asset = {}) {
  const relativePath = cleanText(asset.relativePath || '');
  return {
    kind: cleanText(asset.kind || ''),
    label: cleanText(asset.label || ''),
    mimeType: cleanText(asset.mimeType || ''),
    relativePath,
    url: relativePath ? buildAssetUrl(relativePath) : '',
  };
}

function serializeKnowledgeItem(item = {}) {
  const relativeAssetPath = cleanText(item.relativeAssetPath || '');
  return {
    id: cleanText(item.id || ''),
    kind: normalizeKind(item.kind),
    scope: normalizeScope(item.scope),
    title: cleanText(item.title || ''),
    summary: cleanText(item.summary || ''),
    tags: normalizeTags(item.tags),
    sourceUrl: cleanText(item.sourceUrl || ''),
    sourceContext: cleanText(item.sourceContext || ''),
    sessionId: cleanText(item.sessionId || ''),
    createdAt: Number(item.createdAt || 0),
    updatedAt: Number(item.updatedAt || 0),
    relativeAssetPath,
    assetUrl: relativeAssetPath ? buildAssetUrl(relativeAssetPath) : '',
    derivedAssets: Array.isArray(item.derivedAssets) ? item.derivedAssets.map(serializeAsset) : [],
    textContent: cleanText(item.textContent || ''),
    fileName: cleanText(item.fileName || ''),
    expiresAt: Number(item.expiresAt || 0) || null,
  };
}

function listKnowledgeRecords({ scope, sessionId } = {}) {
  const db = loadKnowledgeDb();
  const items = cleanupExpiredItems(db);
  return items
    .filter(item => {
      if (scope && item.scope !== scope) {
        return false;
      }
      if (item.scope === 'session' && sessionId && item.sessionId && item.sessionId !== sessionId) {
        return false;
      }
      return true;
    })
    .sort((left, right) => Number(right.updatedAt || 0) - Number(left.updatedAt || 0));
}

function listKnowledgeItems({ scope, sessionId } = {}) {
  return listKnowledgeRecords({ scope, sessionId }).map(serializeKnowledgeItem);
}

function getKnowledgeItem(id) {
  const db = loadKnowledgeDb();
  const items = cleanupExpiredItems(db);
  const match = items.find(item => item.id === id);
  return match ? serializeKnowledgeItem(match) : null;
}

function getKnowledgeItemsByIds(ids = [], { sessionId } = {}) {
  const idSet = new Set((Array.isArray(ids) ? ids : []).map(id => cleanText(id)).filter(Boolean));
  if (!idSet.size) {
    return [];
  }

  const db = loadKnowledgeDb();
  const items = cleanupExpiredItems(db);
  return items
    .filter(item => idSet.has(item.id))
    .filter(item => item.scope !== 'session' || !sessionId || !item.sessionId || item.sessionId === sessionId)
    .map(serializeKnowledgeItem);
}

function getKnowledgeRecordsByIds(ids = [], { sessionId } = {}) {
  const idSet = new Set((Array.isArray(ids) ? ids : []).map(id => cleanText(id)).filter(Boolean));
  if (!idSet.size) {
    return [];
  }

  const db = loadKnowledgeDb();
  const items = cleanupExpiredItems(db);
  return items.filter(item => {
    if (!idSet.has(item.id)) {
      return false;
    }
    return item.scope !== 'session' || !sessionId || !item.sessionId || item.sessionId === sessionId;
  });
}

async function copyFileIntoKnowledgeStore({ filePath, itemId }) {
  const absolutePath = path.resolve(cleanText(filePath));
  const stat = await fsp.stat(absolutePath);
  if (!stat.isFile()) {
    throw new Error('Knowledge import path must be a file');
  }

  const { assetsDir } = resolveKnowledgePaths();
  ensureDir(path.join(assetsDir, itemId));
  const extension = path.extname(absolutePath) || '.bin';
  const fileName = path.basename(absolutePath);
  const relativeAssetPath = path.join(itemId, `source${extension}`);
  const destinationPath = path.join(assetsDir, relativeAssetPath);
  await fsp.copyFile(absolutePath, destinationPath);

  return {
    absolutePath,
    destinationPath,
    fileName,
    relativeAssetPath,
    sizeBytes: stat.size,
  };
}

function normalizeKnowledgeRecord(record = {}) {
  const scope = normalizeScope(record.scope);
  const now = Date.now();
  const id = cleanText(record.id || '') || createKnowledgeId(scope === 'library' ? 'library' : 'session');
  return {
    id,
    kind: normalizeKind(record.kind),
    scope,
    title: cleanText(record.title || '') || 'Untitled knowledge',
    summary: cleanText(record.summary || ''),
    tags: normalizeTags(record.tags),
    sourceUrl: cleanText(record.sourceUrl || ''),
    sourceContext: cleanText(record.sourceContext || ''),
    sessionId: cleanText(record.sessionId || ''),
    relativeAssetPath: cleanText(record.relativeAssetPath || ''),
    fileName: cleanText(record.fileName || ''),
    derivedAssets: Array.isArray(record.derivedAssets) ? record.derivedAssets.map(asset => ({
      kind: cleanText(asset.kind || ''),
      label: cleanText(asset.label || ''),
      mimeType: cleanText(asset.mimeType || ''),
      relativePath: cleanText(asset.relativePath || ''),
    })) : [],
    textContent: cleanText(record.textContent || ''),
    embedding: Array.isArray(record.embedding) ? record.embedding.map(value => Number(value)).filter(Number.isFinite) : [],
    embeddingModel: cleanText(record.embeddingModel || ''),
    createdAt: Number(record.createdAt || now),
    updatedAt: now,
    expiresAt:
      scope === 'session'
        ? Number(record.expiresAt || now + SESSION_ITEM_TTL_MS)
        : null,
  };
}

function upsertKnowledgeItem(record = {}) {
  const db = loadKnowledgeDb();
  cleanupExpiredItems(db);
  const normalized = normalizeKnowledgeRecord(record);
  const existingIndex = db.items.findIndex(item => item.id === normalized.id);
  if (existingIndex >= 0) {
    db.items[existingIndex] = {
      ...db.items[existingIndex],
      ...normalized,
      createdAt: Number(db.items[existingIndex].createdAt || normalized.createdAt),
    };
  } else {
    db.items.push(normalized);
  }
  saveKnowledgeDb(db);
  return serializeKnowledgeItem(normalized);
}

function updateKnowledgeItem(id, patch = {}) {
  const db = loadKnowledgeDb();
  cleanupExpiredItems(db);
  const index = db.items.findIndex(item => item.id === id);
  if (index === -1) {
    return null;
  }

  const current = db.items[index];
  const updated = normalizeKnowledgeRecord({
    ...current,
    ...patch,
    id: current.id,
    createdAt: current.createdAt,
    scope: patch.scope || current.scope,
  });
  db.items[index] = updated;
  saveKnowledgeDb(db);
  return serializeKnowledgeItem(updated);
}

async function deleteKnowledgeItem(id) {
  const db = loadKnowledgeDb();
  cleanupExpiredItems(db);
  const index = db.items.findIndex(item => item.id === id);
  if (index === -1) {
    return false;
  }
  const [removed] = db.items.splice(index, 1);
  saveKnowledgeDb(db);

  if (removed.relativeAssetPath) {
    const { assetsDir } = resolveKnowledgePaths();
    const assetRoot = path.join(assetsDir, removed.id);
    try {
      await fsp.rm(assetRoot, { recursive: true, force: true });
    } catch (_error) {
      /* empty */
    }
  }
  return true;
}

module.exports = {
  buildAssetUrl,
  copyFileIntoKnowledgeStore,
  createKnowledgeId,
  deleteKnowledgeItem,
  getKnowledgeItem,
  getKnowledgeItemsByIds,
  getKnowledgeRecordsByIds,
  listKnowledgeItems,
  listKnowledgeRecords,
  normalizeKnowledgeRecord,
  serializeKnowledgeItem,
  updateKnowledgeItem,
  upsertKnowledgeItem,
};
