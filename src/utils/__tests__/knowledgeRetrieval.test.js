const { test } = require('node:test');
const assert = require('node:assert');

const { rankKnowledgeItems } = require('../../../backend/knowledgeRetrieval');

test('selected guideline and session recency boost outrank stale unrelated items', () => {
  const now = Date.now();
  const results = rankKnowledgeItems({
    items: [
      {
        id: 'guideline_1',
        kind: 'guideline',
        scope: 'library',
        title: 'Sales call rules',
        summary: 'Open with the business impact, ask one clarifying question, then present the pricing anchor.',
        textContent: 'Business impact first. Clarify one blocker. Then pricing anchor.',
        tags: ['sales', 'call'],
        embedding: [1, 0, 0],
        updatedAt: now - 1_000,
      },
      {
        id: 'session_clip_1',
        kind: 'clip',
        scope: 'session',
        title: 'CAN bus clip',
        summary: 'Intermittent CAN arbitration error and termination issue shown in recent live clip.',
        textContent: 'CAN bus termination mismatch and arbitration fault.',
        tags: ['can', 'diagnostics'],
        embedding: [0.92, 0.08, 0],
        updatedAt: now - 5 * 60 * 1000,
      },
      {
        id: 'old_frontend_note',
        kind: 'guideline',
        scope: 'library',
        title: 'React memoization notes',
        summary: 'Frontend performance tuning advice for React dashboards.',
        textContent: 'memoization render performance useMemo useCallback',
        tags: ['frontend'],
        embedding: [0, 1, 0],
        updatedAt: now - 10 * 24 * 60 * 60 * 1000,
      },
    ],
    queryText: 'What should I say about this CAN bus fault during the support call?',
    queryEmbedding: [0.95, 0.05, 0],
    selectedKnowledgeIds: ['guideline_1'],
    limit: 3,
  });

  assert.ok(results.length >= 2);
  const topTwoIds = results.slice(0, 2).map(result => result.id);
  assert.ok(topTwoIds.includes('session_clip_1'));
  assert.ok(topTwoIds.includes('guideline_1'));
  const guidelineMatch = results.find(result => result.id === 'guideline_1');
  assert.match(guidelineMatch.reason, /selected for this task/i);
});
