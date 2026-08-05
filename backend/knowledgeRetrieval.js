function cleanText(value = '') {
  return String(value || '').trim();
}

function tokenize(text = '') {
  return cleanText(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter(token => token.length > 2);
}

function cosineSimilarity(left = [], right = []) {
  if (!Array.isArray(left) || !Array.isArray(right) || !left.length || left.length !== right.length) {
    return 0;
  }

  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    const leftValue = Number(left[index]);
    const rightValue = Number(right[index]);
    dot += leftValue * rightValue;
    leftNorm += leftValue * leftValue;
    rightNorm += rightValue * rightValue;
  }

  if (!leftNorm || !rightNorm) {
    return 0;
  }
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

function scoreTokenOverlap(queryTokens = [], candidateTokens = []) {
  if (!queryTokens.length || !candidateTokens.length) {
    return 0;
  }
  const candidateSet = new Set(candidateTokens);
  let hits = 0;
  for (const token of queryTokens) {
    if (candidateSet.has(token)) {
      hits += 1;
    }
  }
  return hits / Math.max(queryTokens.length, 1);
}

function buildKnowledgeMatchReason(item, tokenScore, semanticScore, selectedIds) {
  const reasons = [];
  if (selectedIds.has(item.id)) {
    reasons.push('selected for this task');
  }
  if (item.kind === 'guideline') {
    reasons.push('guideline');
  }
  if (semanticScore >= 0.55) {
    reasons.push('semantic match');
  }
  if (tokenScore >= 0.25) {
    reasons.push('keyword overlap');
  }
  return reasons.join(', ') || 'context match';
}

function scoreKnowledgeItem({
  item,
  queryEmbedding = [],
  queryTokens = [],
  selectedIds = new Set(),
  now = Date.now(),
}) {
  const candidateText = [
    item.title,
    item.summary,
    item.textContent,
    Array.isArray(item.tags) ? item.tags.join(' ') : '',
  ]
    .filter(Boolean)
    .join(' ');
  const candidateTokens = tokenize(candidateText);
  const tokenScore = scoreTokenOverlap(queryTokens, candidateTokens);
  const semanticScore = cosineSimilarity(queryEmbedding, item.embedding || []);
  const recencyAgeHours = Math.max(0, (now - Number(item.updatedAt || now)) / (1000 * 60 * 60));
  const recencyBoost = item.scope === 'session' ? Math.max(0, 1 - recencyAgeHours / 12) : Math.max(0, 1 - recencyAgeHours / 168);
  const selectedBoost = selectedIds.has(item.id) ? 1.15 : 0;
  const guidelineBoost = item.kind === 'guideline' ? 0.35 : 0;
  const score = semanticScore * 5 + tokenScore * 3 + recencyBoost * 0.6 + selectedBoost + guidelineBoost;

  return {
    id: item.id,
    kind: item.kind,
    title: item.title,
    summary: item.summary,
    sourceUrl: item.sourceUrl || '',
    assetUrl: item.assetUrl || '',
    score,
    reason: buildKnowledgeMatchReason(item, tokenScore, semanticScore, selectedIds),
  };
}

function rankKnowledgeItems({
  items = [],
  queryText = '',
  queryEmbedding = [],
  selectedKnowledgeIds = [],
  limit = 6,
}) {
  const selectedIds = new Set((Array.isArray(selectedKnowledgeIds) ? selectedKnowledgeIds : []).map(id => cleanText(id)).filter(Boolean));
  const queryTokens = tokenize(queryText);
  const now = Date.now();

  return items
    .map(item =>
      scoreKnowledgeItem({
        item,
        queryEmbedding,
        queryTokens,
        selectedIds,
        now,
      })
    )
    .filter(item => item.score > 0.4 || selectedIds.has(item.id))
    .sort((left, right) => right.score - left.score)
    .slice(0, Math.max(1, Math.min(10, limit)));
}

module.exports = {
  cosineSimilarity,
  rankKnowledgeItems,
  tokenizeKnowledgeText: tokenize,
};
