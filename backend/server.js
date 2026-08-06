require('dotenv').config();
require('../src/utils/logger');

const express = require('express');
const { WebSocketServer, WebSocket } = require('ws');
const historyStore = require('./historyStore');
const { resolveKnowledgePaths } = require('./appData');
const {
  deleteKnowledgeItem,
  hasBundledFfmpeg,
  ingestClipFrames,
  ingestFile,
  ingestGuideline,
  ingestUrl,
  listKnowledgeItems,
  retrieveKnowledgeMatches,
  updateKnowledgeItem,
} = require('./knowledgeService');
const {
  DEFAULT_FOCUS_CONFIG,
  DEFAULT_SESSION_OPTIONS,
  buildFocusContextMessage,
  buildFallbackHelpPackRequest,
  buildHelpPackHash,
  buildHelpPackRequest,
  buildRealtimeSessionConfig,
  buildSessionInstruction,
  buildWebIntelRequest,
  extractJsonObject,
  normalizeFocusConfig,
  normalizeHelpCardPayload,
  normalizeSessionOptions,
  normalizeWebIntelPayload,
  retrieveFocusSnippets,
  shouldRunWebSearch,
} = require('./liveSupport');

const app = express();
app.use(express.json({ limit: '25mb' }));
app.use('/knowledge-assets', express.static(resolveKnowledgePaths().assetsDir));

const DEFAULT_TEXT_MODEL = process.env.OPENAI_TEXT_MODEL || 'gpt-5.4-mini';
const DEFAULT_WEB_SEARCH_MODEL = process.env.OPENAI_WEB_SEARCH_MODEL || DEFAULT_TEXT_MODEL;
const DEFAULT_REALTIME_MODEL = process.env.OPENAI_REALTIME_MODEL || 'gpt-realtime-2';
const DEFAULT_TRANSCRIPTION_MODEL =
  process.env.OPENAI_TRANSCRIPTION_MODEL || 'gpt-4o-mini-transcribe';
const DEFAULT_VOICE = process.env.OPENAI_VOICE || 'marin';
const RESPONSES_URL = 'https://api.openai.com/v1/responses';
const REALTIME_URL = 'wss://api.openai.com/v1/realtime';

// In-memory state for conversation history and context parameters
const state = {
  history: [],
  contextParams: {
    allowedSources: '',
    toneLength: '',
    disallowedTopics: '',
  },
};

function buildSystemInstruction() {
  const parts = ['You are a helpful assistant.'];
  const { allowedSources, toneLength, disallowedTopics } = state.contextParams;
  if (allowedSources) parts.push(`Limit knowledge retrieval to: ${allowedSources}.`);
  if (toneLength) parts.push(`Maintain tone/length constraints: ${toneLength}.`);
  if (disallowedTopics) parts.push(`Avoid the following topics: ${disallowedTopics}.`);
  return parts.join(' ');
}

function resolveApiKey(...candidates) {
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
  }
  return process.env.OPENAI_API_KEY || '';
}

function extractResponseText(payload) {
  if (typeof payload?.output_text === 'string') {
    return payload.output_text.trim();
  }

  const outputs = Array.isArray(payload?.output) ? payload.output : [];
  for (const item of outputs) {
    const contents = Array.isArray(item?.content) ? item.content : [];
    for (const content of contents) {
      if (typeof content?.text === 'string' && content.text.trim()) {
        return content.text.trim();
      }
    }
  }

  return '';
}

function extractWebSearchSources(payload) {
  const outputs = Array.isArray(payload?.output) ? payload.output : [];
  const seen = new Set();
  const sources = [];

  const pushSource = candidate => {
    const title = String(candidate?.title || '').trim();
    const url = String(candidate?.url || '').trim();
    const source = String(candidate?.source || '').trim();
    if (!title || !url) {
      return;
    }
    const key = `${title}::${url}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    sources.push({ title, url, source });
  };

  for (const item of outputs) {
    const actionSources = Array.isArray(item?.action?.sources) ? item.action.sources : [];
    actionSources.forEach(pushSource);

    const contents = Array.isArray(item?.content) ? item.content : [];
    for (const content of contents) {
      const annotations = Array.isArray(content?.annotations) ? content.annotations : [];
      annotations
        .filter(annotation => annotation?.type === 'url_citation')
        .forEach(annotation => {
          pushSource({
            title: annotation?.title,
            url: annotation?.url,
            source: annotation?.title,
          });
        });
    }
  }

  return sources;
}

function parseTags(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return [...new Set(value.map(item => String(item || '').trim()).filter(Boolean))].slice(0, 16);
}

app.get('/knowledge', (req, res) => {
  try {
    const items = listKnowledgeItems({
      scope: typeof req.query.scope === 'string' ? req.query.scope : undefined,
      sessionId: typeof req.query.sessionId === 'string' ? req.query.sessionId : '',
    });
    res.json({ items, ffmpegAvailable: hasBundledFfmpeg() });
  } catch (err) {
    logger.error('Error listing knowledge items:', err);
    res.status(500).json({ error: 'Failed to list knowledge items' });
  }
});

app.post('/knowledge/guideline', async (req, res) => {
  const apiKey = resolveApiKey(req.body?.apiKey, req.get('x-openai-api-key'));
  if (!apiKey) {
    return res.status(400).json({ error: 'Missing OpenAI API key' });
  }

  try {
    const item = await ingestGuideline({
      apiKey,
      text: req.body?.text,
      title: req.body?.title,
      tags: parseTags(req.body?.tags),
      scope: req.body?.scope === 'session' ? 'session' : 'library',
      sessionId: req.body?.sessionId,
    });
    res.json({ item });
  } catch (err) {
    logger.error('Error ingesting guideline knowledge item:', err);
    res.status(500).json({ error: err.message || 'Failed to ingest guideline item' });
  }
});

app.post('/knowledge/url', async (req, res) => {
  const apiKey = resolveApiKey(req.body?.apiKey, req.get('x-openai-api-key'));
  const url = String(req.body?.url || '').trim();
  if (!apiKey) {
    return res.status(400).json({ error: 'Missing OpenAI API key' });
  }
  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  try {
    const item = await ingestUrl({
      apiKey,
      url,
      title: req.body?.title,
      tags: parseTags(req.body?.tags),
      scope: req.body?.scope === 'session' ? 'session' : 'library',
      sessionId: req.body?.sessionId,
    });
    res.json({ item });
  } catch (err) {
    logger.error('Error ingesting URL knowledge item:', err);
    res.status(500).json({ error: err.message || 'Failed to ingest URL item' });
  }
});

app.post('/knowledge/file', async (req, res) => {
  const apiKey = resolveApiKey(req.body?.apiKey, req.get('x-openai-api-key'));
  const filePath = String(req.body?.path || req.body?.filePath || '').trim();
  if (!apiKey) {
    return res.status(400).json({ error: 'Missing OpenAI API key' });
  }
  if (!filePath) {
    return res.status(400).json({ error: 'File path is required' });
  }

  try {
    const item = await ingestFile({
      apiKey,
      filePath,
      title: req.body?.title,
      tags: parseTags(req.body?.tags),
      scope: req.body?.scope === 'session' ? 'session' : 'library',
      sessionId: req.body?.sessionId,
      kindHint: req.body?.kindHint,
    });
    res.json({ item });
  } catch (err) {
    logger.error('Error ingesting file knowledge item:', err);
    res.status(500).json({ error: err.message || 'Failed to ingest file item' });
  }
});

app.patch('/knowledge/:id', (req, res) => {
  try {
    const item = updateKnowledgeItem(req.params.id, {
      title: req.body?.title,
      summary: req.body?.summary,
      tags: parseTags(req.body?.tags),
      scope: req.body?.scope,
    });
    if (!item) {
      return res.status(404).json({ error: 'Knowledge item not found' });
    }
    res.json({ item });
  } catch (err) {
    logger.error('Error updating knowledge item:', err);
    res.status(500).json({ error: err.message || 'Failed to update knowledge item' });
  }
});

app.delete('/knowledge/:id', async (req, res) => {
  try {
    const deleted = await deleteKnowledgeItem(req.params.id);
    if (!deleted) {
      return res.status(404).json({ error: 'Knowledge item not found' });
    }
    res.json({ ok: true });
  } catch (err) {
    logger.error('Error deleting knowledge item:', err);
    res.status(500).json({ error: err.message || 'Failed to delete knowledge item' });
  }
});

app.get('/context-params', (_req, res) => {
  res.json(state.contextParams);
});

app.get('/api-key-status', (_req, res) => {
  res.json({
    success: true,
    hasEnvKey: Boolean(process.env.OPENAI_API_KEY),
  });
});

app.put('/context-params', (req, res) => {
  state.contextParams = { ...state.contextParams, ...req.body };
  res.json({ success: true, data: state.contextParams });
});

app.post('/ask', async (req, res) => {
  const prompt = String(req.body?.prompt || '').trim();
  const apiKey = resolveApiKey(req.body?.apiKey, req.get('x-openai-api-key'));

  if (!apiKey) {
    return res.status(400).json({ error: 'Missing OpenAI API key' });
  }
  if (!prompt) {
    return res.status(400).json({ error: 'Prompt is required' });
  }

  try {
    const response = await fetch(RESPONSES_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: DEFAULT_TEXT_MODEL,
        instructions: buildSystemInstruction(),
        input: prompt,
      }),
    });
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload?.error?.message || 'Generation failed');
    }

    const reply = extractResponseText(payload);
    state.history.push({ prompt, reply });
    res.json({ reply });
  } catch (err) {
    logger.error('Error generating OpenAI response:', err);
    res.status(500).json({ error: err.message || 'Generation failed' });
  }
});

app.post('/history/:sessionId/turn', (req, res) => {
  const { sessionId } = req.params;
  try {
    historyStore.appendTurn(sessionId, req.body || {});
    res.json({ ok: true });
  } catch (err) {
    logger.error('Error saving history turn:', err);
    res.status(500).json({ error: 'Failed to save turn' });
  }
});

app.delete('/history', (_req, res) => {
  try {
    historyStore.clearHistory();
    res.json({ ok: true });
  } catch (err) {
    logger.error('Error clearing history:', err);
    res.status(500).json({ error: 'Failed to clear history' });
  }
});

app.get('/history', (_req, res) => {
  try {
    const sessions = historyStore.listSessions();
    res.json(sessions);
  } catch (err) {
    logger.error('Error listing history:', err);
    res.status(500).json({ error: 'Failed to list history' });
  }
});

app.get('/history/:sessionId', (req, res) => {
  try {
    const session = historyStore.getSession(req.params.sessionId);
    if (!session) {
      return res.status(404).json({ error: 'Not found' });
    }
    res.json(session);
  } catch (err) {
    logger.error('Error loading session:', err);
    res.status(500).json({ error: 'Failed to load session' });
  }
});

app.put('/history/limit', (req, res) => {
  try {
    historyStore.setMaxSessions(req.body?.limit);
    res.json({ ok: true, limit: req.body?.limit });
  } catch (err) {
    logger.error('Error updating history limit:', err);
    res.status(500).json({ error: 'Failed to update limit' });
  }
});

const server = app.listen(process.env.PORT || 3001);

const wss = new WebSocketServer({ server, path: '/live' });
wss.on('connection', ws => {
  let upstream = null;
  let upstreamReady = false;
  let pendingActions = [];
  let currentInstruction = buildSessionInstruction({
    contextParams: state.contextParams,
    language: 'en-US',
    profile: 'general',
  });
  let currentApiKey = '';
  let fatalSessionError = '';
  let fatalSessionErrorSent = false;
  let currentModel = DEFAULT_REALTIME_MODEL;
  let currentLanguage = 'en-US';
  let currentProfile = 'general';
  let currentCustomPrompt = '';
  let currentSessionId = '';
  let currentContextParams = { ...state.contextParams };
  let currentFocusConfig = { ...DEFAULT_FOCUS_CONFIG };
  let currentSessionOptions = { ...DEFAULT_SESSION_OPTIONS };
  let currentWebSearchModel = DEFAULT_WEB_SEARCH_MODEL;
  let latestImageItemId = null;
  let importedVisualItemId = null;
  let latestFocusContextItemId = null;
  let latestScreenImageDataUrl = '';
  let importedVisualContext = null;
  let latestClipContext = null;
  let lastClipHash = '';
  let lastTurnText = '';
  let lastHelpHash = '';
  let lastHelpStartedAt = 0;
  let queuedHelpRequest = null;
  let helpQueueTimer = null;
  let helpInFlight = false;
  let analysisRevision = 0;
  let visualSummaryRevision = 0;
  let responsePendingOrActive = false;
  let queuedResponseRequest = false;
  let lastRetrievalBaseHash = '';
  let lastRetrievalBase = null;
  let lastRetrievalPayload = {
    jobTitle: '',
    objective: '',
    priorityTopics: '',
    guidelineText: '',
    strictFocus: false,
    webSearchEnabled: false,
    webSearchHint: '',
    selectedKnowledgeIds: [],
    snippets: [],
    matchedKnowledgeItems: [],
    resources: [],
    visualMatches: [],
    retrieval_sources: [],
    visualSummary: '',
    webIntel: null,
  };
  let lastWebIntel = {
    should_search: false,
    summary: '',
    sources: [],
    turnHash: '',
  };
  const responseTextByItem = new Map();

  const sendJson = payload => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
    }
  };

  const sendStatus = message => sendJson({ type: 'status', msg: message });
  const sendError = (error, context = 'openai-realtime') => {
    logger.error(`[${context}]`, error);
    sendJson({ type: 'error', msg: error?.message || String(error) });
  };

  const sendFatalSessionError = (error, context = 'openai-realtime') => {
    const message = error?.message || String(error);
    fatalSessionError = message;
    pendingActions = [];
    responsePendingOrActive = false;
    queuedResponseRequest = false;

    if (!fatalSessionErrorSent) {
      fatalSessionErrorSent = true;
      sendError(error, context);
      sendStatus(`OpenAI Realtime stopped: ${message}`);
    } else {
      logger.error(`[${context}]`, error);
    }

    if (upstream) {
      try {
        upstream.close();
      } catch (err) {
        logger.warn('Error closing upstream OpenAI socket after fatal error:', err);
      }
    }

    setTimeout(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.close(1011, 'OpenAI Realtime fatal error');
      }
    }, 25);
  };

  const createEmptyRetrievalPayload = () => ({
    jobTitle: '',
    objective: '',
    priorityTopics: '',
    guidelineText: '',
    strictFocus: false,
    webSearchEnabled: false,
    webSearchHint: '',
    selectedKnowledgeIds: [],
    snippets: [],
    matchedKnowledgeItems: [],
    resources: [],
    visualMatches: [],
    retrieval_sources: [],
    visualSummary: '',
    webIntel: null,
  });

  const resetRetrievalCache = () => {
    lastRetrievalBaseHash = '';
    lastRetrievalBase = null;
  };

  const emitVisualContext = () => {
    sendJson({
      type: 'visual_context',
      context: importedVisualContext
        ? {
            fileName: importedVisualContext.fileName,
            frameCount: importedVisualContext.frameCount,
            kind: importedVisualContext.kind,
            label: importedVisualContext.label,
            previewDataUrl: importedVisualContext.previewDataUrl,
            processing: Boolean(importedVisualContext.processing),
            summary: importedVisualContext.summary,
          }
        : null,
    });
  };

  const flushQueue = () => {
    if (!upstreamReady || !upstream) return;
    const tasks = pendingActions;
    pendingActions = [];
    for (const task of tasks) {
      try {
        task();
      } catch (err) {
        sendError(err, 'flushQueue');
      }
    }
  };

  const queueOrRun = action => {
    if (upstreamReady && upstream) {
      try {
        action();
      } catch (err) {
        sendError(err, 'queueOrRun');
      }
    } else {
      pendingActions.push(action);
    }
  };

  const resolveOutputModalities = list => {
    if (!Array.isArray(list) || !list.length) return ['text'];
    const normalized = list.map(mod => String(mod || '').toLowerCase());
    return normalized.includes('audio') ? ['audio'] : ['text'];
  };

  const closeUpstream = () => {
    pendingActions = [];
    upstreamReady = false;
    responseTextByItem.clear();
    latestImageItemId = null;
    importedVisualItemId = null;
    latestFocusContextItemId = null;
    latestScreenImageDataUrl = '';
    importedVisualContext = null;
    latestClipContext = null;
    lastClipHash = '';
    visualSummaryRevision += 1;
    lastTurnText = '';
    currentSessionId = '';
    currentSessionOptions = { ...DEFAULT_SESSION_OPTIONS };
    lastWebIntel = {
      should_search: false,
      summary: '',
      sources: [],
      turnHash: '',
    };
    lastRetrievalPayload = createEmptyRetrievalPayload();
    resetRetrievalCache();
    queuedHelpRequest = null;
    helpInFlight = false;
    responsePendingOrActive = false;
    queuedResponseRequest = false;
    if (helpQueueTimer) {
      clearTimeout(helpQueueTimer);
      helpQueueTimer = null;
    }
    if (upstream) {
      try {
        upstream.close();
      } catch (err) {
        logger.warn('Error closing upstream OpenAI socket:', err);
      }
      upstream = null;
    }
  };

  const sendUpstream = event => {
    queueOrRun(() => {
      if (upstream?.readyState === WebSocket.OPEN) {
        upstream.send(JSON.stringify(event));
      }
    });
  };

  const postResponseRequest = async body => {
    const response = await fetch(RESPONSES_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${currentApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload?.error?.message || 'OpenAI response generation failed');
    }
    return payload;
  };

  const postWebSearchRequest = async body => {
    try {
      return await postResponseRequest(body);
    } catch (err) {
      const fallbackBody = JSON.parse(JSON.stringify(body));
      if (Array.isArray(fallbackBody.tools) && fallbackBody.tools.length) {
        fallbackBody.tools[0].type = 'web_search_preview';
        return postResponseRequest(fallbackBody);
      }
      throw err;
    }
  };

  const getActiveVisualContext = () => {
    if (importedVisualContext?.images?.length) {
      return importedVisualContext;
    }
    if (
      currentSessionOptions.videoAssistMode === 'rolling-clip' &&
      latestClipContext?.images?.length
    ) {
      const mergedImages = latestScreenImageDataUrl
        ? [latestScreenImageDataUrl, ...latestClipContext.images.slice(0, 3)]
        : latestClipContext.images.slice(0, 4);
      return {
        ...latestClipContext,
        frameCount: mergedImages.length,
        images: mergedImages,
        label: latestScreenImageDataUrl ? 'Live screen + rolling clip' : latestClipContext.label,
        previewDataUrl: latestScreenImageDataUrl || latestClipContext.previewDataUrl,
      };
    }
    if (latestScreenImageDataUrl) {
      return {
        frameCount: 1,
        images: [latestScreenImageDataUrl],
        kind: 'screen',
        label: 'Live screen',
        previewDataUrl: latestScreenImageDataUrl,
        summary: 'Live screen context',
      };
    }
    return null;
  };

  const collectVisualMatches = ({ activeVisualContext, matchedKnowledgeItems = [] }) => {
    const matches = [];
    const pushMatch = match => {
      if (!match?.url) {
        return;
      }
      const exists = matches.some(item => item.url === match.url && item.kind === match.kind);
      if (!exists) {
        matches.push(match);
      }
    };

    if (activeVisualContext?.previewDataUrl) {
      pushMatch({
        id: 'active_visual_preview',
        kind: activeVisualContext.kind || 'visual',
        title: activeVisualContext.label || activeVisualContext.fileName || 'Active visual context',
        subtitle: activeVisualContext.summary || 'Current visual context',
        reason: 'current visual context',
        url: activeVisualContext.previewDataUrl,
      });
    }

    if (Array.isArray(activeVisualContext?.images)) {
      activeVisualContext.images.slice(0, 4).forEach((url, index) => {
        pushMatch({
          id: `active_visual_frame_${index + 1}`,
          kind: activeVisualContext.kind === 'video' || activeVisualContext.kind === 'clip' ? 'frame' : activeVisualContext.kind || 'visual',
          title: `${activeVisualContext.label || 'Visual context'} frame ${index + 1}`,
          subtitle: activeVisualContext.summary || '',
          reason: activeVisualContext.kind === 'clip' ? 'rolling clip frame' : 'active visual frame',
          url,
        });
      });
    }

    for (const item of matchedKnowledgeItems) {
      if (item.assetUrl) {
        pushMatch({
          id: `${item.id}:asset`,
          kind: item.kind || 'asset',
          title: item.title,
          subtitle: item.summary,
          reason: item.reason || 'matched knowledge asset',
          url: item.assetUrl,
        });
      }
      const derivedAssets = Array.isArray(item.derivedAssets) ? item.derivedAssets : [];
      derivedAssets
        .filter(asset => asset?.url && String(asset.mimeType || '').startsWith('image/'))
        .slice(0, 4)
        .forEach(asset => {
          pushMatch({
            id: `${item.id}:${asset.relativePath}`,
            kind: asset.kind || 'frame',
            title: item.title,
            subtitle: asset.label || item.summary,
            reason: item.reason || 'matched knowledge frame',
            url: asset.url,
          });
        });
    }

    return matches.slice(0, 6);
  };

  const collectResourceTiles = ({ matchedKnowledgeItems = [], webIntel = null }) => {
    const resources = [];
    const seen = new Set();

    const pushResource = resource => {
      const title = String(resource?.title || '').trim();
      const url = String(resource?.url || '').trim();
      if (!title || !url) {
        return;
      }
      const key = `${title}::${url}`;
      if (seen.has(key)) {
        return;
      }
      seen.add(key);
      resources.push({
        id: String(resource?.id || key),
        kind: String(resource?.kind || 'link').trim() || 'link',
        title,
        subtitle: String(resource?.subtitle || '').trim(),
        reason: String(resource?.reason || '').trim(),
        url,
      });
    };

    for (const item of matchedKnowledgeItems) {
      if (item.sourceUrl) {
        pushResource({
          id: `${item.id}:source`,
          kind: item.kind || 'link',
          title: item.title,
          subtitle: item.summary,
          reason: item.reason || 'matched knowledge source',
          url: item.sourceUrl,
        });
      }
    }

    if (Array.isArray(webIntel?.sources)) {
      webIntel.sources.forEach(source => {
        pushResource({
          id: `web:${source.url}`,
          kind: 'web',
          title: source.title,
          subtitle: source.source || 'Web result',
          reason: 'web search result',
          url: source.url,
        });
      });
    }

    return resources.slice(0, 8);
  };

  const buildRetrievalSources = ({ snippets = [], matchedKnowledgeItems = [] }) => {
    const sources = [];
    snippets.forEach(snippet => {
      sources.push({
        id: snippet.id,
        kind: 'reference_text',
        title: `Reference snippet ${snippet.id}`,
        reason: `ranked snippet score ${Number(snippet.score || 0).toFixed(2)}`,
      });
    });
    matchedKnowledgeItems.forEach(item => {
      sources.push({
        id: item.id,
        kind: item.kind || 'knowledge',
        title: item.title,
        reason: item.reason || 'matched knowledge item',
      });
    });
    return sources.slice(0, 10);
  };

  const describeVisualContext = visualContext => {
    if (!visualContext) {
      return '';
    }
    if (visualContext.summary) {
      return String(visualContext.summary).trim();
    }
    const label = String(visualContext.label || visualContext.fileName || visualContext.kind || 'visual context').trim();
    const frameCount = Number.isFinite(Number(visualContext.frameCount))
      ? Number(visualContext.frameCount)
      : Array.isArray(visualContext.images)
        ? visualContext.images.length
        : 0;
    return `${label}${frameCount > 1 ? ` with ${frameCount} sampled frames` : ''}`;
  };

  const buildRetrievalBase = async (turnText = lastTurnText) => {
    const activeVisualContext = getActiveVisualContext();
    const normalizedFocus = normalizeFocusConfig(currentFocusConfig);
    const visualSummary = describeVisualContext(activeVisualContext);
    const turnHash = buildHelpPackHash(
      [
        turnText,
        visualSummary,
        normalizedFocus.jobTitle,
        normalizedFocus.objective,
        normalizedFocus.priorityTopics,
        normalizedFocus.guidelineText,
        normalizedFocus.referenceText,
        normalizedFocus.selectedKnowledgeIds.join(','),
      ].join('::')
    );
    if (turnHash && turnHash === lastRetrievalBaseHash && lastRetrievalBase) {
      return lastRetrievalBase;
    }

    const snippets = retrieveFocusSnippets({
      focusConfig: normalizedFocus,
      turnText,
      visualSummary,
      limit: 4,
    });
    let matchedKnowledgeItems = [];
    if (currentApiKey) {
      try {
        matchedKnowledgeItems = await retrieveKnowledgeMatches({
          apiKey: currentApiKey,
          turnText: [turnText, visualSummary, normalizedFocus.priorityTopics, normalizedFocus.objective]
            .filter(Boolean)
            .join('\n'),
          selectedKnowledgeIds: normalizedFocus.selectedKnowledgeIds,
          sessionId: currentSessionId,
          limit: 6,
        });
      } catch (err) {
        logger.warn('Knowledge retrieval failed:', err);
      }
    }

    lastRetrievalBaseHash = turnHash;
    lastRetrievalBase = {
      jobTitle: normalizedFocus.jobTitle,
      objective: normalizedFocus.objective,
      priorityTopics: normalizedFocus.priorityTopics,
      guidelineText: normalizedFocus.guidelineText,
      strictFocus: normalizedFocus.strictFocus,
      webSearchEnabled: normalizedFocus.webSearchEnabled,
      webSearchHint: normalizedFocus.webSearchHint,
      selectedKnowledgeIds: normalizedFocus.selectedKnowledgeIds,
      snippets,
      matchedKnowledgeItems,
      visualMatches: collectVisualMatches({
        activeVisualContext,
        matchedKnowledgeItems,
      }),
      retrieval_sources: buildRetrievalSources({
        snippets,
        matchedKnowledgeItems,
      }),
      visualSummary,
    };
    return lastRetrievalBase;
  };

  const syncRetrievalPayload = async (turnText = lastTurnText) => {
    const turnHash = buildHelpPackHash(turnText);
    const basePayload = await buildRetrievalBase(turnText);
    const webIntel =
      lastWebIntel?.turnHash === turnHash
        ? {
            summary: lastWebIntel.summary,
            sources: lastWebIntel.sources,
          }
        : null;
    lastRetrievalPayload = {
      ...createEmptyRetrievalPayload(),
      ...basePayload,
      resources: collectResourceTiles({
        matchedKnowledgeItems: basePayload.matchedKnowledgeItems,
        webIntel,
      }),
      webIntel,
    };
    return lastRetrievalPayload;
  };

  const broadcastFocusContext = async (turnText = lastTurnText) => {
    const payload = await syncRetrievalPayload(turnText);
    sendJson({
      type: 'focus_context',
      focus: payload,
    });
    return payload;
  };

  const syncImportedVisualItem = () => {
    if (importedVisualItemId) {
      sendUpstream({
        type: 'conversation.item.delete',
        item_id: importedVisualItemId,
      });
      importedVisualItemId = null;
    }

    if (!importedVisualContext?.images?.length) {
      return;
    }

    importedVisualItemId = `visual_${Date.now()}`;
    const content = [
      {
        type: 'input_text',
        text: [
          `Imported ${importedVisualContext.kind || 'visual'} context for future answers.`,
          importedVisualContext.label ? `Label: ${importedVisualContext.label}` : '',
          importedVisualContext.summary ? `Summary: ${importedVisualContext.summary}` : '',
          'Use the imported frames or image silently whenever they help answer the user.',
        ]
          .filter(Boolean)
          .join('\n'),
      },
      ...importedVisualContext.images.slice(0, 4).map(imageUrl => ({
        type: 'input_image',
        detail: 'low',
        image_url: imageUrl,
      })),
    ];

    sendUpstream({
      type: 'conversation.item.create',
      item: {
        id: importedVisualItemId,
        type: 'message',
        role: 'user',
        content,
      },
    });
  };

  const syncFocusContextItem = async turnText => {
    const payload = await broadcastFocusContext(turnText);
    const contextText = buildFocusContextMessage({
      focusConfig: currentFocusConfig,
      retrievedSnippets: payload.snippets,
      retrievedKnowledgeItems: payload.matchedKnowledgeItems,
      turnText,
      visualSummary: payload.visualSummary,
      webIntel: payload.webIntel,
    });

    if (latestFocusContextItemId) {
      sendUpstream({
        type: 'conversation.item.delete',
        item_id: latestFocusContextItemId,
      });
      latestFocusContextItemId = null;
    }

    if (!contextText) {
      return payload;
    }

    latestFocusContextItemId = `focus_${Date.now()}`;
    sendUpstream({
      type: 'conversation.item.create',
      item: {
        id: latestFocusContextItemId,
        type: 'message',
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: contextText,
          },
        ],
      },
    });

    return payload;
  };

  const formatGroundedWebAnswer = webIntel => {
    const summary = String(webIntel?.summary || '').trim();
    if (!summary) {
      return '';
    }

    const sources = Array.isArray(webIntel?.sources) ? webIntel.sources.filter(source => source?.title && source?.url) : [];
    if (!sources.length || /\[[^\]]+\]\(https?:\/\/[^)]+\)|https?:\/\/\S+/i.test(summary)) {
      return summary;
    }

    const sourceList = sources
      .slice(0, 5)
      .map(source => `- [${source.title}](${source.url})`)
      .join('\n');

    return `${summary}\n\n**Sources**\n${sourceList}`;
  };

  const emitGroundedWebAnswer = webIntel => {
    const text = formatGroundedWebAnswer(webIntel);
    if (!text) {
      return false;
    }
    sendJson({ type: 'model_text', text, final: true, grounded: true });
    sendStatus('Ready');
    return true;
  };

  const requestModelResponse = () => {
    if (responsePendingOrActive) {
      queuedResponseRequest = true;
      sendStatus('Waiting for current answer to finish...');
      return;
    }

    responsePendingOrActive = true;
    sendUpstream({
      type: 'response.create',
      response: {
        output_modalities: ['text'],
      },
    });
  };

  const maybeGenerateWebIntel = async (turnText, { force = false } = {}) => {
    const normalizedFocus = normalizeFocusConfig(currentFocusConfig);
    if (!shouldRunWebSearch(normalizedFocus, turnText, { force })) {
      lastWebIntel = {
        should_search: false,
        summary: '',
        sources: [],
        turnHash: buildHelpPackHash(turnText),
      };
      return lastWebIntel;
    }

    sendStatus(responsePendingOrActive ? 'Updating web help...' : 'Searching web...');
    const retrieval = await buildRetrievalBase(turnText);
    const requestBody = buildWebIntelRequest({
      focusConfig: normalizedFocus,
      retrievedFocusSnippets: retrieval.snippets,
      retrievedKnowledgeItems: retrieval.matchedKnowledgeItems,
      turnText,
      visualContextSummary: retrieval.visualSummary,
      model: currentWebSearchModel,
    });

    const payload = await postWebSearchRequest(requestBody);
    const parsed = payload?.output_parsed || extractJsonObject(extractResponseText(payload));
    const normalized = normalizeWebIntelPayload(parsed);
    const toolSources = extractWebSearchSources(payload);
    const mergedSources = [...normalized.sources];
    const sourceKeys = new Set(mergedSources.map(source => `${source.title}::${source.url}`));
    for (const source of toolSources) {
      const key = `${source.title}::${source.url}`;
      if (!sourceKeys.has(key)) {
        sourceKeys.add(key);
        mergedSources.push(source);
      }
    }
    lastWebIntel = {
      ...normalized,
      sources: mergedSources.slice(0, 5),
      turnHash: buildHelpPackHash(turnText),
    };
    return lastWebIntel;
  };

  const runDeepTurnAnalysis = async (
    turnText,
    { forceHelp = false, revision, allowGroundedAnswer = false } = {}
  ) => {
    let webIntel = null;

    try {
      await syncFocusContextItem(turnText);
    } catch (err) {
      sendError(err, 'focus-context');
    }

    try {
      webIntel = await maybeGenerateWebIntel(turnText, { force: forceHelp });
    } catch (err) {
      sendError(err, 'web-search');
    }

    if (revision !== analysisRevision) {
      return;
    }

    if (webIntel?.summary) {
      try {
        await syncFocusContextItem(turnText);
      } catch (err) {
        sendError(err, 'focus-context-web');
      }
    }

    if (allowGroundedAnswer && Boolean(webIntel?.summary) && !responsePendingOrActive) {
      emitGroundedWebAnswer(webIntel);
    }

    queueHelpPack({ force: forceHelp, turnText });
  };

  const generateVisualSummary = async (visualContext, turnText = lastTurnText) => {
    if (!visualContext?.images?.length) {
      return '';
    }

    const normalizedFocus = normalizeFocusConfig(currentFocusConfig);
    const content = [
      {
        type: 'input_text',
        text: [
          'Summarize the most relevant details in this imported visual context for a live assistant overlay.',
          normalizedFocus.jobTitle ? `Role or purpose: ${normalizedFocus.jobTitle}` : '',
          normalizedFocus.objective ? `Target outcome: ${normalizedFocus.objective}` : '',
          normalizedFocus.priorityTopics ? `Priority topics: ${normalizedFocus.priorityTopics}` : '',
          turnText ? `Latest turn: ${turnText}` : '',
          'Be concrete. Mention components, relationships, architecture, or visible failure clues. If the visual is generic, say that directly.',
          turnText
            ? 'Prioritize the details that help answer the latest turn or perform the current task.'
            : 'Prioritize the details that would help explain or act on this visual quickly.',
        ]
          .filter(Boolean)
          .join('\n'),
      },
      ...visualContext.images.slice(0, 4).map(imageUrl => ({
        type: 'input_image',
        detail: 'low',
        image_url: imageUrl,
      })),
    ];

    const payload = await postResponseRequest({
      model: DEFAULT_TEXT_MODEL,
      instructions: 'Return a concise visual summary in 2 to 4 short sentences.',
      input: [
        {
          role: 'user',
          content,
        },
      ],
    });

    return extractResponseText(payload);
  };

  const generateHelpPack = async ({ turnText, preferVisual = false }) => {
    const activeVisualContext = getActiveVisualContext();
    const retrieval = await syncRetrievalPayload(turnText);
    const requestBody = buildHelpPackRequest({
      model: DEFAULT_TEXT_MODEL,
      focusConfig: currentFocusConfig,
      retrievedFocusSnippets: retrieval.snippets,
      retrievedKnowledgeItems: retrieval.matchedKnowledgeItems,
      sessionInstruction: currentInstruction,
      turnText,
      visualInputImages: activeVisualContext?.images?.slice(0, 4) || [],
      visualContextSummary: retrieval.visualSummary,
      webIntel: retrieval.webIntel,
    });

    try {
      const payload = await postResponseRequest(requestBody);
      const parsed = payload?.output_parsed || extractJsonObject(extractResponseText(payload));
      const helpPayload = normalizeHelpCardPayload(parsed, {
        hasVisual: Boolean(activeVisualContext?.previewDataUrl),
        preferVisual,
      });
      return {
        ...helpPayload,
        resources: retrieval.resources,
        visual_matches: retrieval.visualMatches,
        retrieval_sources: retrieval.retrieval_sources,
        matched_knowledge: retrieval.matchedKnowledgeItems,
        retrieval,
        web_intel: retrieval.webIntel,
      };
    } catch (err) {
      logger.warn('Structured help-pack request failed, retrying with JSON fallback:', err);
      const fallbackPayload = await postResponseRequest(
        buildFallbackHelpPackRequest({
          model: DEFAULT_TEXT_MODEL,
          focusConfig: currentFocusConfig,
          retrievedFocusSnippets: retrieval.snippets,
          retrievedKnowledgeItems: retrieval.matchedKnowledgeItems,
          sessionInstruction: currentInstruction,
          turnText,
          visualInputImages: activeVisualContext?.images?.slice(0, 4) || [],
          visualContextSummary: retrieval.visualSummary,
          webIntel: retrieval.webIntel,
        })
      );
      const parsed = extractJsonObject(extractResponseText(fallbackPayload));
      const helpPayload = normalizeHelpCardPayload(parsed, {
        hasVisual: Boolean(activeVisualContext?.previewDataUrl),
        preferVisual,
      });
      return {
        ...helpPayload,
        resources: retrieval.resources,
        visual_matches: retrieval.visualMatches,
        retrieval_sources: retrieval.retrieval_sources,
        matched_knowledge: retrieval.matchedKnowledgeItems,
        retrieval,
        web_intel: retrieval.webIntel,
      };
    }
  };

  const flushHelpQueue = async () => {
    if (helpInFlight || !queuedHelpRequest) {
      return;
    }

    const request = queuedHelpRequest;
    queuedHelpRequest = null;

    if (!request.force && request.hash === lastHelpHash) {
      return;
    }

    helpInFlight = true;
    helpQueueTimer = null;
    lastHelpStartedAt = Date.now();

    try {
      const payload = await generateHelpPack({
        turnText: request.turnText,
        preferVisual: request.force,
      });
      lastHelpHash = request.hash;
      sendJson({ type: 'help_cards', ...payload });
      sendJson({ type: 'focus_context', focus: payload.retrieval });
    } catch (err) {
      sendError(err, 'help-pack');
    } finally {
      helpInFlight = false;
      if (queuedHelpRequest) {
        const remainingDelay = Math.max(0, 1200 - (Date.now() - lastHelpStartedAt));
        if (remainingDelay > 0) {
          helpQueueTimer = setTimeout(() => {
            helpQueueTimer = null;
            void flushHelpQueue();
          }, remainingDelay);
        } else {
          void flushHelpQueue();
        }
      }
    }
  };

  const queueHelpPack = ({ force = false, turnText }) => {
    const trimmed = String(turnText || '').trim();
    if (!trimmed) {
      return;
    }

    lastTurnText = trimmed;
    const hash = buildHelpPackHash(trimmed);
    if (!force && hash === lastHelpHash) {
      return;
    }

    queuedHelpRequest = { force, hash, turnText: trimmed };

    if (helpInFlight || helpQueueTimer) {
      return;
    }

    const remainingDelay = force ? 0 : Math.max(0, 1200 - (Date.now() - lastHelpStartedAt));
    if (remainingDelay > 0) {
      helpQueueTimer = setTimeout(() => {
        helpQueueTimer = null;
        void flushHelpQueue();
      }, remainingDelay);
      return;
    }

    void flushHelpQueue();
  };

  const ensureSession = async ({
    contextParams,
    customPrompt,
    focusConfig,
    language,
    profile,
    responseModalities,
    apiKey,
    model,
    sessionId,
    sessionOptions,
  } = {}) => {
    if (upstream) return;

    const providedApiKey = resolveApiKey(apiKey);
    if (fatalSessionError && !providedApiKey) {
      throw new Error(fatalSessionError);
    }
    if (providedApiKey) {
      fatalSessionError = '';
      fatalSessionErrorSent = false;
    }

    currentApiKey = resolveApiKey(providedApiKey, currentApiKey);
    if (!currentApiKey) {
      throw new Error('Missing OpenAI API key');
    }
    if (typeof model === 'string' && model.trim()) {
      currentModel = model.trim();
    }
    currentLanguage = typeof language === 'string' && language.trim() ? language.trim() : currentLanguage;
    currentProfile = typeof profile === 'string' && profile.trim() ? profile.trim() : currentProfile;
    currentCustomPrompt =
      typeof customPrompt === 'string' && customPrompt.trim()
        ? customPrompt.trim()
        : currentCustomPrompt;
    currentSessionId =
      typeof sessionId === 'string' && sessionId.trim() ? sessionId.trim() : currentSessionId;
    currentContextParams = {
      ...state.contextParams,
      ...(contextParams && typeof contextParams === 'object' ? contextParams : {}),
    };
    currentFocusConfig = normalizeFocusConfig({
      ...currentFocusConfig,
      ...(focusConfig && typeof focusConfig === 'object' ? focusConfig : {}),
    });
    currentSessionOptions = normalizeSessionOptions({
      ...currentSessionOptions,
      ...(sessionOptions && typeof sessionOptions === 'object' ? sessionOptions : {}),
    });
    resetRetrievalCache();
    currentInstruction = buildSessionInstruction({
      contextParams: currentContextParams,
      customPrompt: currentCustomPrompt,
      focusConfig: currentFocusConfig,
      language: currentLanguage,
      profile: currentProfile,
    });

    const sessionConfig = buildRealtimeSessionConfig({
      instructions: currentInstruction,
      language: currentLanguage,
      outputModalities: resolveOutputModalities(responseModalities),
      transcriptionModel: DEFAULT_TRANSCRIPTION_MODEL,
      turnDetectionCreateResponse: false,
      voice: DEFAULT_VOICE,
    });
    const url = `${REALTIME_URL}?model=${encodeURIComponent(currentModel)}`;

    await new Promise((resolve, reject) => {
      let settled = false;
      upstream = new WebSocket(url, {
        headers: {
          Authorization: `Bearer ${currentApiKey}`,
        },
      });

      upstream.on('open', () => {
        upstream.send(JSON.stringify({ type: 'session.update', session: sessionConfig }));
        if (!settled) {
          settled = true;
          resolve();
        }
      });

      upstream.on('message', raw => {
        let event;
        try {
          event = JSON.parse(raw.toString());
        } catch (err) {
          sendError(err, 'upstream-parse');
          return;
        }

        try {
          switch (event.type) {
            case 'session.created':
              sendStatus('OpenAI Realtime session created');
              break;
            case 'session.updated':
              upstreamReady = true;
              sendStatus('OpenAI Realtime ready');
              flushQueue();
              void broadcastFocusContext();
              break;
            case 'input_audio_buffer.speech_started':
              sendStatus('Listening...');
              break;
            case 'input_audio_buffer.speech_stopped':
              sendStatus('Processing...');
              break;
            case 'conversation.item.input_audio_transcription.completed':
              if (event.transcript) {
                sendJson({
                  type: 'user_transcript',
                  transcript: event.transcript,
                  itemId: event.item_id,
                });
                void refreshTurnAnalysis(event.transcript);
              }
              break;
            case 'response.created':
              responsePendingOrActive = true;
              sendStatus('Responding...');
              break;
            case 'response.output_text.delta': {
              const key = `${event.item_id}:${event.content_index}`;
              const nextText = `${responseTextByItem.get(key) || ''}${event.delta || ''}`;
              responseTextByItem.set(key, nextText);
              sendJson({ type: 'model_text', text: nextText });
              break;
            }
            case 'response.output_text.done': {
              const key = `${event.item_id}:${event.content_index}`;
              const text = event.text || responseTextByItem.get(key) || '';
              responseTextByItem.set(key, text);
              sendJson({ type: 'model_text', text, final: true });
              break;
            }
            case 'response.output_audio.delta':
              sendJson({ type: 'model_audio', data: event.delta, mime: 'audio/pcm;rate=24000' });
              break;
            case 'response.done':
              responsePendingOrActive = false;
              sendStatus('Ready');
              if (queuedResponseRequest) {
                queuedResponseRequest = false;
                requestModelResponse();
              }
              break;
            case 'rate_limits.updated':
              sendJson({ type: 'usage', metadata: event.rate_limits });
              break;
            case 'error':
              responsePendingOrActive = false;
              sendFatalSessionError(
                new Error(event?.error?.message || 'OpenAI Realtime error'),
                'upstream-event'
              );
              break;
            default:
              break;
          }
        } catch (err) {
          sendError(err, 'upstream-message');
        }
      });

      upstream.on('error', err => {
        sendError(err, 'upstream-socket');
        if (!settled) {
          settled = true;
          reject(err);
        }
      });

      upstream.on('close', () => {
        const wasReady = upstreamReady;
        upstreamReady = false;
        upstream = null;
        responseTextByItem.clear();
        latestImageItemId = null;
        importedVisualItemId = null;
        latestFocusContextItemId = null;
        responsePendingOrActive = false;
        queuedResponseRequest = false;
        if (ws.readyState === WebSocket.OPEN) {
          sendStatus(wasReady ? 'OpenAI Realtime session closed' : 'OpenAI Realtime connection closed');
        }
        if (!settled) {
          settled = true;
          reject(new Error('OpenAI Realtime connection closed before ready'));
        }
      });
    });
  };

  const refreshTurnAnalysis = async (
    turnText,
    { forceHelp = false, regenerateResponse = true } = {}
  ) => {
    const trimmed = String(turnText || '').trim();
    if (!trimmed) {
      return;
    }

    lastTurnText = trimmed;
    const revision = ++analysisRevision;

    if (regenerateResponse) {
      requestModelResponse();
    }

    void runDeepTurnAnalysis(trimmed, {
      allowGroundedAnswer: false,
      forceHelp,
      revision,
    });
  };

  const handleText = async text => {
    const trimmed = String(text || '').trim();
    if (!trimmed) return;

    sendUpstream({
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: trimmed,
          },
        ],
      },
    });
    await refreshTurnAnalysis(trimmed);
  };

  const handleAudio = payload => {
    if (!payload?.data) return;
    sendUpstream({
      type: 'input_audio_buffer.append',
      audio: payload.data,
    });
  };

  const handleImage = payload => {
    if (!payload?.data) return;
    const mimeType = payload.mime || payload.mimeType || 'image/jpeg';
    const nextItemId = `screen_${Date.now()}`;
    latestScreenImageDataUrl = `data:${mimeType};base64,${payload.data}`;
    resetRetrievalCache();

    if (latestImageItemId) {
      sendUpstream({
        type: 'conversation.item.delete',
        item_id: latestImageItemId,
      });
    }

    latestImageItemId = nextItemId;
    sendUpstream({
      type: 'conversation.item.create',
      item: {
        id: nextItemId,
        type: 'message',
        role: 'user',
        content: [
          {
            type: 'input_image',
            detail: 'low',
            image_url: latestScreenImageDataUrl,
          },
        ],
      },
    });
  };

  const handleVisualContext = async data => {
    const images = Array.isArray(data?.images)
      ? data.images
          .map(image => String(image || '').trim())
          .filter(Boolean)
          .slice(0, 6)
      : [];

    if (!images.length) {
      importedVisualContext = null;
      visualSummaryRevision += 1;
      resetRetrievalCache();
      syncImportedVisualItem();
      emitVisualContext();
      return;
    }

    const processing = Boolean(data?.processing);
    importedVisualContext = {
      fileName: String(data?.fileName || '').trim(),
      frameCount: Number.isFinite(Number(data?.frameCount)) ? Number(data.frameCount) : images.length,
      images,
      kind: data?.kind === 'video' ? 'video' : 'image',
      label: String(data?.label || 'Visual context').trim() || 'Visual context',
      processing,
      previewDataUrl: String(data?.previewDataUrl || images[0] || '').trim(),
      summary: String(data?.summary || '').trim(),
    };
    const summaryRevision = ++visualSummaryRevision;
    resetRetrievalCache();
    emitVisualContext();
    syncImportedVisualItem();
    void broadcastFocusContext(lastTurnText);

    if (processing) {
      sendStatus(`Loaded ${importedVisualContext.kind} preview`);
      return;
    }

    sendStatus(`Loaded ${importedVisualContext.kind} context`);

    void (async () => {
      try {
        const visualSummary = await generateVisualSummary(importedVisualContext, lastTurnText);
        if (
          summaryRevision !== visualSummaryRevision ||
          !importedVisualContext ||
          importedVisualContext.processing
        ) {
          return;
        }
        if (!visualSummary || visualSummary === importedVisualContext.summary) {
          return;
        }
        importedVisualContext = {
          ...importedVisualContext,
          summary: visualSummary,
        };
        resetRetrievalCache();
        emitVisualContext();
        void broadcastFocusContext(lastTurnText);
        if (lastTurnText) {
          queueHelpPack({ force: true, turnText: lastTurnText });
        }
      } catch (err) {
        logger.warn('Visual summary generation failed:', err);
      }
    })();
  };

  const handleClipFrames = async data => {
    if (currentSessionOptions.videoAssistMode !== 'rolling-clip' || !currentApiKey) {
      return;
    }

    const frames = Array.isArray(data?.frames)
      ? data.frames
          .map(frame => String(frame || '').trim())
          .filter(Boolean)
          .slice(0, 8)
      : [];
    if (!frames.length) {
      return;
    }

    const clipHash = buildHelpPackHash(
      `${data?.title || ''}::${frames.length}::${frames[0]}::${frames.at(-1) || ''}`
    );
    if (clipHash && clipHash === lastClipHash) {
      return;
    }
    lastClipHash = clipHash;

    try {
      sendStatus('Analyzing rolling clip...');
      const clipItem = await ingestClipFrames({
        apiKey: currentApiKey,
        title: String(data?.title || lastTurnText || 'Rolling live clip').trim(),
        frames,
        tags: parseTags(data?.tags),
        sessionId: currentSessionId,
      });
      latestClipContext = {
        ...clipItem,
        images: Array.isArray(clipItem.inputImages) ? clipItem.inputImages.slice(0, 6) : [],
        frameCount: Array.isArray(clipItem.inputImages) ? clipItem.inputImages.length : 0,
        kind: 'clip',
        label: clipItem.title || 'Rolling live clip',
        previewDataUrl: clipItem.previewDataUrl || '',
        processing: false,
        summary: clipItem.summary || '',
      };
      resetRetrievalCache();
      if (lastTurnText) {
        void broadcastFocusContext(lastTurnText);
        queueHelpPack({ force: true, turnText: lastTurnText });
      }
    } catch (err) {
      logger.warn('Rolling clip analysis failed:', err);
    }
  };

  ws.on('message', async raw => {
    let data;
    try {
      data = JSON.parse(raw.toString());
    } catch (err) {
      sendError(err, 'parse');
      return;
    }

    const { type } = data || {};

    try {
      if (fatalSessionError && type !== 'start' && type !== 'end') {
        return;
      }

      switch (type) {
        case 'start':
          await ensureSession({
            contextParams: data.contextParams,
            customPrompt: data.customPrompt,
            focusConfig: data.focusConfig,
            language: data.language,
            profile: data.profile,
            responseModalities: data.responseModalities,
            apiKey: data.apiKey,
            model: data.model,
            sessionId: data.sessionId,
            sessionOptions: data.sessionOptions,
          });
          sendStatus('Start command acknowledged');
          break;
        case 'text':
          await ensureSession();
          await handleText(data.text);
          break;
        case 'audio':
          await ensureSession();
          handleAudio(data);
          break;
        case 'image':
          await ensureSession();
          handleImage(data);
          break;
        case 'visual_context':
          await ensureSession();
          await handleVisualContext(data);
          break;
        case 'clip_frames':
          await ensureSession();
          void handleClipFrames(data);
          break;
        case 'clear_visual_context':
          importedVisualContext = null;
          visualSummaryRevision += 1;
          resetRetrievalCache();
          syncImportedVisualItem();
          emitVisualContext();
          void broadcastFocusContext(lastTurnText);
          if (lastTurnText) {
            await refreshTurnAnalysis(lastTurnText, { forceHelp: true, regenerateResponse: false });
          }
          break;
        case 'focus_config':
          await ensureSession();
          if (typeof data.profile === 'string' && data.profile.trim()) {
            currentProfile = data.profile.trim();
          }
          currentFocusConfig = normalizeFocusConfig({
            ...currentFocusConfig,
            ...(data.config && typeof data.config === 'object' ? data.config : {}),
          });
          resetRetrievalCache();
          currentInstruction = buildSessionInstruction({
            contextParams: currentContextParams,
            customPrompt: currentCustomPrompt,
            focusConfig: currentFocusConfig,
            language: currentLanguage,
            profile: currentProfile,
          });
          sendUpstream({
            type: 'session.update',
            session: buildRealtimeSessionConfig({
              instructions: currentInstruction,
              language: currentLanguage,
              outputModalities: ['text'],
              transcriptionModel: DEFAULT_TRANSCRIPTION_MODEL,
              turnDetectionCreateResponse: false,
              voice: DEFAULT_VOICE,
            }),
          });
          void broadcastFocusContext(lastTurnText);
          if (lastTurnText) {
            await refreshTurnAnalysis(lastTurnText, { forceHelp: true, regenerateResponse: false });
          }
          break;
        case 'session_options':
          await ensureSession();
          currentSessionOptions = normalizeSessionOptions({
            ...currentSessionOptions,
            ...(data.options && typeof data.options === 'object' ? data.options : {}),
          });
          if (currentSessionOptions.videoAssistMode !== 'rolling-clip') {
            latestClipContext = null;
            lastClipHash = '';
          }
          resetRetrievalCache();
          if (lastTurnText) {
            await refreshTurnAnalysis(lastTurnText, { forceHelp: true, regenerateResponse: false });
          }
          break;
        case 'refresh_help':
          await ensureSession();
          queueHelpPack({ force: true, turnText: data.text || lastTurnText });
          break;
        case 'refresh_response':
          await ensureSession();
          await refreshTurnAnalysis(data.text || lastTurnText, {
            forceHelp: Boolean(data.refreshHelp),
            regenerateResponse: true,
          });
          break;
        case 'end':
          closeUpstream();
          break;
        default:
          logger.warn('Unhandled live message type:', type);
      }
    } catch (err) {
      sendError(err, 'message-handler');
    }
  });

  ws.on('close', () => {
    closeUpstream();
  });

  ws.on('error', err => {
    sendError(err, 'ws');
  });
});
