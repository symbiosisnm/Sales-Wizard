const crypto = require('node:crypto');
const { getSystemPrompt } = require('../src/utils/prompts');

const OUTPUT_LANGUAGE_LABELS = {
  'ar-XA': 'Arabic',
  'bn-IN': 'Bengali',
  'cmn-CN': 'Mandarin Chinese',
  'de-DE': 'German',
  'en-AU': 'English (Australia)',
  'en-GB': 'English (UK)',
  'en-IN': 'English (India)',
  'en-US': 'English (US)',
  'es-ES': 'Spanish (Spain)',
  'es-US': 'Spanish (US)',
  'fr-CA': 'French (Canada)',
  'fr-FR': 'French (France)',
  'gu-IN': 'Gujarati',
  'hi-IN': 'Hindi',
  'id-ID': 'Indonesian',
  'it-IT': 'Italian',
  'ja-JP': 'Japanese',
  'kn-IN': 'Kannada',
  'ko-KR': 'Korean',
  'ml-IN': 'Malayalam',
  'mr-IN': 'Marathi',
  'nl-NL': 'Dutch',
  'pl-PL': 'Polish',
  'pt-BR': 'Portuguese (Brazil)',
  'ru-RU': 'Russian',
  'ta-IN': 'Tamil',
  'te-IN': 'Telugu',
  'th-TH': 'Thai',
  'tr-TR': 'Turkish',
  'vi-VN': 'Vietnamese',
};

const TRANSCRIPTION_LANGUAGE_BY_LOCALE = {
  'ar-XA': 'ar',
  'bn-IN': 'bn',
  'cmn-CN': 'zh',
  'de-DE': 'de',
  'en-AU': 'en',
  'en-GB': 'en',
  'en-IN': 'en',
  'en-US': 'en',
  'es-ES': 'es',
  'es-US': 'es',
  'fr-CA': 'fr',
  'fr-FR': 'fr',
  'gu-IN': 'gu',
  'hi-IN': 'hi',
  'id-ID': 'id',
  'it-IT': 'it',
  'ja-JP': 'ja',
  'kn-IN': 'kn',
  'ko-KR': 'ko',
  'ml-IN': 'ml',
  'mr-IN': 'mr',
  'nl-NL': 'nl',
  'pl-PL': 'pl',
  'pt-BR': 'pt',
  'ru-RU': 'ru',
  'ta-IN': 'ta',
  'te-IN': 'te',
  'th-TH': 'th',
  'tr-TR': 'tr',
  'vi-VN': 'vi',
};

const HELP_CARD_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['primary_answer', 'should_surface', 'cards'],
  properties: {
    primary_answer: { type: 'string' },
    should_surface: { type: 'boolean' },
    cards: {
      type: 'array',
      maxItems: 6,
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'id',
          'title',
          'speak_now',
          'supporting_points',
          'confidence',
          'source_context',
          'show_visual',
        ],
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          speak_now: { type: 'string' },
          supporting_points: {
            type: 'array',
            maxItems: 5,
            items: { type: 'string' },
          },
          confidence: {
            type: 'string',
            enum: ['high', 'medium', 'low'],
          },
          source_context: { type: 'string' },
          show_visual: { type: 'boolean' },
        },
      },
    },
  },
};

const DEFAULT_FOCUS_CONFIG = Object.freeze({
  jobTitle: '',
  objective: '',
  priorityTopics: '',
  guidelineText: '',
  referenceText: '',
  selectedKnowledgeIds: [],
  strictFocus: false,
  webSearchEnabled: false,
  webSearchHint: '',
});

const DEFAULT_SESSION_OPTIONS = Object.freeze({
  captureSystemAudio: false,
  rememberImports: false,
  videoAssistMode: 'rolling-clip',
  clipWindowSeconds: 8,
});

const WEB_INTEL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['should_search', 'summary', 'sources'],
  properties: {
    should_search: { type: 'boolean' },
    summary: { type: 'string' },
    sources: {
      type: 'array',
      maxItems: 5,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'url', 'source'],
        properties: {
          title: { type: 'string' },
          url: { type: 'string' },
          source: { type: 'string' },
        },
      },
    },
  },
};

function cleanText(value = '') {
  return String(value || '').replace(/\r\n/g, '\n').trim();
}

function normalizeFocusConfig(focusConfig = {}) {
  return {
    jobTitle: cleanText(focusConfig.jobTitle || focusConfig.role || ''),
    objective: cleanText(focusConfig.objective || focusConfig.goal || ''),
    priorityTopics: cleanText(focusConfig.priorityTopics || focusConfig.keywords || ''),
    guidelineText: cleanText(focusConfig.guidelineText || focusConfig.guidelines || ''),
    referenceText: cleanText(focusConfig.referenceText || focusConfig.referenceNotes || ''),
    selectedKnowledgeIds: Array.isArray(focusConfig.selectedKnowledgeIds)
      ? [...new Set(focusConfig.selectedKnowledgeIds.map(id => cleanText(id)).filter(Boolean))].slice(0, 24)
      : [],
    strictFocus: Boolean(focusConfig.strictFocus),
    webSearchEnabled: Boolean(focusConfig.webSearchEnabled),
    webSearchHint: cleanText(focusConfig.webSearchHint || ''),
  };
}

function normalizeSessionOptions(sessionOptions = {}) {
  const videoAssistMode = String(sessionOptions.videoAssistMode || '').trim().toLowerCase();
  return {
    captureSystemAudio: Boolean(sessionOptions.captureSystemAudio),
    rememberImports: Boolean(sessionOptions.rememberImports),
    videoAssistMode:
      videoAssistMode === 'off' || videoAssistMode === 'imported' || videoAssistMode === 'rolling-clip'
        ? videoAssistMode
        : DEFAULT_SESSION_OPTIONS.videoAssistMode,
    clipWindowSeconds: Math.max(
      4,
      Math.min(12, Number.parseInt(sessionOptions.clipWindowSeconds, 10) || DEFAULT_SESSION_OPTIONS.clipWindowSeconds)
    ),
  };
}

function hasFocusConfig(focusConfig = {}) {
  const normalized = normalizeFocusConfig(focusConfig);
  return Boolean(
      normalized.jobTitle ||
      normalized.objective ||
      normalized.priorityTopics ||
      normalized.guidelineText ||
      normalized.referenceText ||
      normalized.selectedKnowledgeIds.length ||
      normalized.webSearchEnabled ||
      normalized.webSearchHint
  );
}

function hasExplicitWebLookupIntent(text = '') {
  const normalized = cleanText(text).toLowerCase();
  return (
    /\b(search( the)? (internet|web|online)|web search|look( it)? up|find online|check online|browse( the web)|google( it| search)?)\b/.test(normalized) ||
    /\b(find|get|give|provide|show|pull up|open)\b.{0,80}\b(exact )?(link|url|page|source|product)\b/.test(normalized) ||
    /\b(exact|official|current|available|in[-\s]?stock)\b.{0,80}\b(link|url|page|product|store|sku|model)\b/.test(normalized)
  );
}

function hasProductLookupIntent(text = '') {
  const normalized = cleanText(text).toLowerCase();
  if (!normalized) return false;

  const hasCommerceConstraint =
    /\$\s?\d|under\s+\$?\d|below\s+\$?\d|less than\s+\$?\d|price|pricing|availability|available|in[-\s]?stock|preconfigured|configuration|sku|product number|model number/.test(normalized);
  const hasProductTerm =
    /\b(product|store|shop|laptop|desktop|workstation|monitor|printer|server|phone|tablet|ram|memory|gb|tb|cpu|gpu|ssd|hdd)\b/.test(normalized);
  const hasBrandOrOfficial =
    /\b(official|manufacturer|store|hp|dell|lenovo|apple|microsoft|best buy|amazon|walmart|newegg|b&h)\b/.test(normalized);

  return (hasCommerceConstraint && hasProductTerm) || (hasBrandOrOfficial && hasProductTerm && /\b(link|url|page|find|show|get|provide)\b/.test(normalized));
}

function shouldRunWebSearch(focusConfig = DEFAULT_FOCUS_CONFIG, turnText = '', { force = false } = {}) {
  const normalizedFocus = normalizeFocusConfig(focusConfig);
  const text = cleanText(`${turnText} ${normalizedFocus.webSearchHint}`).toLowerCase();
  if (!text) {
    return false;
  }

  const explicitlyRequested = hasExplicitWebLookupIntent(turnText);
  const productLookup = hasProductLookupIntent(turnText);
  const freshnessSensitive = /\b(latest|today|current|recent|new|news|release|shipping|compare|version|price|pricing|market|trend|who is|what happened|202[5-9]|2026)\b|\$\s?\d/.test(text);

  if (force || explicitlyRequested || productLookup || freshnessSensitive) {
    return true;
  }

  return (
    normalizedFocus.webSearchEnabled &&
    /\b(company|competitor|standard|product|policy|incident|status|documentation|docs|version|release|roadmap|pricing|availability|stock|spec|specification)\b/.test(text)
  );
}

function shouldAnswerWithWebFirst(focusConfig = DEFAULT_FOCUS_CONFIG, turnText = '', { force = false } = {}) {
  const normalizedFocus = normalizeFocusConfig(focusConfig);
  if (!shouldRunWebSearch(normalizedFocus, turnText, { force })) {
    return false;
  }

  return force || hasExplicitWebLookupIntent(turnText) || hasProductLookupIntent(turnText);
}

function tokenizeText(text = '') {
  return cleanText(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter(token => token.length >= 2);
}

const WEB_CONTEXT_STOPWORDS = new Set([
  'a',
  'about',
  'an',
  'and',
  'answer',
  'are',
  'be',
  'by',
  'check',
  'com',
  'do',
  'does',
  'for',
  'from',
  'get',
  'current',
  'find',
  'help',
  'how',
  'http',
  'https',
  'ignore',
  'in',
  'internet',
  'is',
  'it',
  'its',
  'latest',
  'look',
  'me',
  'my',
  'net',
  'of',
  'online',
  'only',
  'or',
  'org',
  'page',
  'please',
  'question',
  'search',
  'site',
  'sources',
  'support',
  'tell',
  'that',
  'the',
  'this',
  'to',
  'today',
  'use',
  'using',
  'web',
  'with',
  'www',
  'you',
  'your',
]);

function getIgnoredContextTokens(turnText = '') {
  const ignored = new Set();
  const matches = cleanText(turnText).toLowerCase().matchAll(/\bignore\s+([a-z0-9.\- ]{1,80})/g);
  for (const match of matches) {
    const tokens = tokenizeText(match[1] || '').filter(token => !WEB_CONTEXT_STOPWORDS.has(token));
    tokens.forEach(token => ignored.add(token));
  }
  return ignored;
}

function tokenizeForWebContext(text = '', ignoredTokens = new Set()) {
  return tokenizeText(text).filter(
    token => token.length > 2 && !WEB_CONTEXT_STOPWORDS.has(token) && !ignoredTokens.has(token)
  );
}

function contextIsRelevantToTurn(turnText = '', contextText = '') {
  const ignoredTokens = getIgnoredContextTokens(turnText);
  const turnTokens = tokenizeForWebContext(turnText, ignoredTokens);
  const contextTokens = tokenizeForWebContext(contextText, ignoredTokens);
  if (!turnTokens.length || !contextTokens.length) {
    return false;
  }

  const turnTokenSet = new Set(turnTokens);
  return contextTokens.some(token => turnTokenSet.has(token));
}

function chunkReferenceText(referenceText = '') {
  const normalized = cleanText(referenceText);
  if (!normalized) return [];

  const rawBlocks = normalized
    .split(/\n{2,}/)
    .flatMap(block => block.split(/\n(?=(?:[-*]\s|\d+\.\s))/))
    .map(block => cleanText(block))
    .filter(Boolean);

  const chunks = [];
  for (const block of rawBlocks) {
    if (block.length <= 460) {
      chunks.push(block);
      continue;
    }

    const sentences = block.split(/(?<=[.!?])\s+/).map(sentence => cleanText(sentence)).filter(Boolean);
    if (!sentences.length) {
      for (let i = 0; i < block.length; i += 420) {
        chunks.push(cleanText(block.slice(i, i + 420)));
      }
      continue;
    }

    let current = '';
    for (const sentence of sentences) {
      if (!current) {
        current = sentence;
        continue;
      }
      if (`${current} ${sentence}`.length <= 460) {
        current = `${current} ${sentence}`;
      } else {
        chunks.push(current);
        current = sentence;
      }
    }
    if (current) {
      chunks.push(current);
    }
  }

  return chunks.filter(Boolean).slice(0, 80);
}

function scoreReferenceChunk(
  chunkText,
  {
    queryTokens = [],
    priorityTokens = [],
    objectiveTokens = [],
    jobTokens = [],
  } = {}
) {
  const chunkTokens = tokenizeText(chunkText);
  if (!chunkTokens.length) return 0;

  const frequencies = new Map();
  for (const token of chunkTokens) {
    frequencies.set(token, (frequencies.get(token) || 0) + 1);
  }

  const scoreTokenSet = (tokens, weight) => {
    let score = 0;
    for (const token of tokens) {
      if (frequencies.has(token)) {
        score += weight + Math.min(2, frequencies.get(token) - 1);
      }
    }
    return score;
  };

  let score = 0;
  score += scoreTokenSet(queryTokens, 4);
  score += scoreTokenSet(priorityTokens, 3);
  score += scoreTokenSet(objectiveTokens, 2);
  score += scoreTokenSet(jobTokens, 1);

  const lowered = chunkText.toLowerCase();
  if (priorityTokens.length && priorityTokens.some(token => lowered.includes(token))) {
    score += 3;
  }
  if (queryTokens.length && queryTokens.some(token => lowered.includes(token))) {
    score += 2;
  }

  return score;
}

function retrieveFocusSnippets({
  focusConfig = DEFAULT_FOCUS_CONFIG,
  turnText = '',
  visualSummary = '',
  limit = 4,
} = {}) {
  const normalizedFocus = normalizeFocusConfig(focusConfig);
  const chunks = chunkReferenceText(normalizedFocus.referenceText);
  if (!chunks.length) {
    return [];
  }

  const queryTokens = tokenizeText(`${turnText} ${visualSummary}`);
  const priorityTokens = tokenizeText(normalizedFocus.priorityTopics);
  const objectiveTokens = tokenizeText(normalizedFocus.objective);
  const jobTokens = tokenizeText(normalizedFocus.jobTitle);

  const fallbackMode =
    !queryTokens.length && !priorityTokens.length && !objectiveTokens.length && !jobTokens.length;

  const scored = chunks
    .map((chunk, index) => ({
      id: `snippet_${index + 1}`,
      score: scoreReferenceChunk(chunk, {
        queryTokens,
        priorityTokens,
        objectiveTokens,
        jobTokens,
      }),
      text: chunk,
    }))
    .filter((item, index) => fallbackMode || item.score > 0 || index < 2)
    .sort((a, b) => b.score - a.score || a.text.length - b.text.length)
    .slice(0, Math.max(1, Math.min(6, limit)));

  return scored.map(({ id, score, text }) => ({ id, score, text }));
}

function buildFocusInstructionBlock(focusConfig = DEFAULT_FOCUS_CONFIG) {
  const normalizedFocus = normalizeFocusConfig(focusConfig);
  if (!hasFocusConfig(normalizedFocus)) {
    return '';
  }

  const lines = ['**FOCUS TARGET:**'];
  lines.push('- The latest spoken or typed user turn always has priority over older focus hints when they conflict.');
  if (normalizedFocus.jobTitle) {
    lines.push(`- Current job, role, or purpose: ${normalizedFocus.jobTitle}`);
  }
  if (normalizedFocus.objective) {
    lines.push(`- Desired outcome: ${normalizedFocus.objective}`);
  }
  if (normalizedFocus.priorityTopics) {
    lines.push(`- Prioritize these topics: ${normalizedFocus.priorityTopics}`);
  }
  if (normalizedFocus.guidelineText) {
    lines.push(`- Follow these wording/principle guidelines: ${normalizedFocus.guidelineText}`);
  }
  if (normalizedFocus.referenceText) {
    lines.push(
      '- A user-provided reference pack is available. Use the retrieved parts of it before falling back to general knowledge.'
    );
  }
  if (normalizedFocus.selectedKnowledgeIds.length) {
    lines.push('- User-selected knowledge items are attached to this task. Prefer them when they are relevant.');
  }
  if (normalizedFocus.webSearchEnabled) {
    lines.push(
      `- Current web search is enabled${normalizedFocus.webSearchHint ? ` with this search hint: ${normalizedFocus.webSearchHint}` : ''}. Use grounded current information when it is relevant.`
    );
  }
  if (normalizedFocus.strictFocus) {
    lines.push(
      '- Stay tightly within the live conversation, retrieved references, and visible/imported visuals. If evidence is missing, keep the answer cautious.'
    );
  }
  return lines.join('\n');
}

function buildFocusContextMessage({
  focusConfig = DEFAULT_FOCUS_CONFIG,
  retrievedSnippets = [],
  retrievedKnowledgeItems = [],
  turnText = '',
  visualSummary = '',
  webIntel = null,
} = {}) {
  const normalizedFocus = normalizeFocusConfig(focusConfig);
  if (!hasFocusConfig(normalizedFocus) && !retrievedSnippets.length && !retrievedKnowledgeItems.length && !visualSummary) {
    return '';
  }

  const lines = [
    'Focus context for the most recent user turn.',
    `Most recent user turn: ${cleanText(turnText) || 'No turn text provided.'}`,
    'The most recent user turn overrides stale assumptions from earlier turns, older focus text, or unrelated visuals.',
  ];

  if (normalizedFocus.jobTitle) {
    lines.push(`Role or purpose: ${normalizedFocus.jobTitle}`);
  }
  if (normalizedFocus.objective) {
    lines.push(`Target outcome: ${normalizedFocus.objective}`);
  }
  if (normalizedFocus.priorityTopics) {
    lines.push(`Priority topics: ${normalizedFocus.priorityTopics}`);
  }
  if (normalizedFocus.guidelineText) {
    lines.push(`Guidelines: ${normalizedFocus.guidelineText}`);
  }
  if (visualSummary) {
    lines.push(`Visual context summary: ${cleanText(visualSummary)}`);
  }
  if (retrievedSnippets.length) {
    lines.push('Retrieved reference snippets:');
    retrievedSnippets.forEach((snippet, index) => {
      lines.push(`${index + 1}. ${snippet.text}`);
    });
  }
  if (retrievedKnowledgeItems.length) {
    lines.push('Matched knowledge items:');
    retrievedKnowledgeItems.forEach((item, index) => {
      lines.push(`${index + 1}. ${item.title}: ${item.summary}`);
    });
  }
  if (webIntel?.summary) {
    lines.push(`Web search summary: ${cleanText(webIntel.summary)}`);
    lines.push(
      'Treat that summary as grounded live internet research. Use it directly and do not say you cannot browse or search the web.'
    );
    if (Array.isArray(webIntel.sources) && webIntel.sources.length) {
      lines.push('Web sources:');
      webIntel.sources.forEach((source, index) => {
        lines.push(`${index + 1}. ${source.source || source.title} - ${source.title} (${source.url})`);
      });
    }
  }
  if (normalizedFocus.strictFocus) {
    lines.push(
      'Strict focus mode is enabled. Prefer only the retrieved references, live turn, and visible/imported visuals. If support is weak, answer cautiously.'
    );
  }
  lines.push(
    'Use this context silently. Answer the most recent user turn directly with exact words to say now, and ignore any visual or focus detail that is not relevant to that turn.'
  );

  return lines.join('\n');
}

function resolveOutputLanguage(locale = '') {
  return OUTPUT_LANGUAGE_LABELS[locale] || locale || 'English';
}

function resolveTranscriptionLanguage(locale = '') {
  return TRANSCRIPTION_LANGUAGE_BY_LOCALE[locale] || null;
}

function buildSessionInstruction({
  profile = 'general',
  customPrompt = '',
  contextParams = {},
  focusConfig = DEFAULT_FOCUS_CONFIG,
  language = 'en-US',
} = {}) {
  const basePrompt = getSystemPrompt(profile, customPrompt, false, contextParams);
  const outputLanguage = resolveOutputLanguage(language);
  const focusBlock = buildFocusInstructionBlock(focusConfig);
  const liveRules = [
    '**REALTIME SESSION RULES:**',
    `- Always answer in ${outputLanguage}.`,
    '- Lead with the exact words the user can say right now.',
    '- Give enough substance to be useful: after the lead answer, add compact supporting bullets when the topic needs depth.',
    '- The latest user turn overrides stale earlier turns, old examples, older focus hints, and unrelated screen context.',
    '- Use visible screen context and any imported image or video context silently only when it is directly relevant to the latest user turn.',
    '- Never say you cannot browse or search the internet.',
    '- Never ask the user to open a site, apply filters, paste a link, provide a SKU, or do the lookup when the user is asking you to find current information.',
    '- If a current lookup is needed and grounded web context has not arrived yet, keep the answer brief and wait for backend web context instead of delegating the search to the user.',
    '- Do not mention browsing mechanics or any non-OpenAI tools.',
  ];

  const sections = [basePrompt];
  if (focusBlock) {
    sections.push(focusBlock);
  }
  sections.push(liveRules.join('\n'));
  return sections.join('\n\n');
}

function buildRealtimeSessionConfig({
  instructions,
  language,
  outputModalities = ['text'],
  transcriptionModel,
  turnDetectionCreateResponse = false,
  voice,
} = {}) {
  const transcription = { model: transcriptionModel };
  const transcriptionLanguage = resolveTranscriptionLanguage(language);
  if (transcriptionLanguage) {
    transcription.language = transcriptionLanguage;
  }

  return {
    type: 'realtime',
    instructions,
    output_modalities: outputModalities,
    max_output_tokens: 1024,
    audio: {
      input: {
        format: {
          type: 'audio/pcm',
          rate: 24000,
        },
        noise_reduction: { type: 'near_field' },
        transcription,
        turn_detection: {
          type: 'server_vad',
          create_response: turnDetectionCreateResponse,
          interrupt_response: true,
          silence_duration_ms: 250,
        },
      },
      output: {
        format: {
          type: 'audio/pcm',
          rate: 24000,
        },
        voice,
      },
    },
  };
}

function buildHelpPackHash(turnText = '') {
  return crypto.createHash('sha1').update(String(turnText).trim().toLowerCase()).digest('hex');
}

function buildHelpPackRequest({
  sessionInstruction,
  turnText,
  visualInputImages = [],
  visualContextSummary = '',
  focusConfig = DEFAULT_FOCUS_CONFIG,
  retrievedFocusSnippets = [],
  retrievedKnowledgeItems = [],
  webIntel = null,
  model,
} = {}) {
  const content = [
    {
      type: 'input_text',
      text: [
        'Generate popup help for a live overlay from the latest turn below.',
        '',
        `Latest turn: ${turnText}`,
        '',
        'Return only JSON matching the requested schema.',
      ].join('\n'),
    },
  ];

  const normalizedFocus = normalizeFocusConfig(focusConfig);
  if (hasFocusConfig(normalizedFocus) || retrievedFocusSnippets.length || retrievedKnowledgeItems.length || visualContextSummary || webIntel?.summary) {
    const focusLines = ['Live focus context:'];
    if (normalizedFocus.jobTitle) {
      focusLines.push(`- Role or purpose: ${normalizedFocus.jobTitle}`);
    }
    if (normalizedFocus.objective) {
      focusLines.push(`- Desired outcome: ${normalizedFocus.objective}`);
    }
    if (normalizedFocus.priorityTopics) {
      focusLines.push(`- Priority topics: ${normalizedFocus.priorityTopics}`);
    }
    if (normalizedFocus.guidelineText) {
      focusLines.push(`- Guidelines: ${normalizedFocus.guidelineText}`);
    }
    if (visualContextSummary) {
      focusLines.push(`- Visual summary: ${cleanText(visualContextSummary)}`);
    }
    if (retrievedFocusSnippets.length) {
      focusLines.push('- Retrieved references:');
      retrievedFocusSnippets.forEach((snippet, index) => {
        focusLines.push(`  ${index + 1}. ${snippet.text}`);
      });
    }
    if (retrievedKnowledgeItems.length) {
      focusLines.push('- Matched knowledge items:');
      retrievedKnowledgeItems.forEach((item, index) => {
        focusLines.push(`  ${index + 1}. ${item.title}: ${item.summary}`);
      });
    }
    if (webIntel?.summary) {
      focusLines.push(`- Web search summary: ${cleanText(webIntel.summary)}`);
      if (Array.isArray(webIntel.sources) && webIntel.sources.length) {
        focusLines.push('- Web sources:');
        webIntel.sources.forEach((source, index) => {
          focusLines.push(`  ${index + 1}. ${source.source || source.title} - ${source.title} (${source.url})`);
        });
      }
    }
    if (normalizedFocus.strictFocus) {
      focusLines.push('- Strict focus mode is enabled. Stay close to retrieved references and visuals.');
    }
    content.unshift({
      type: 'input_text',
      text: focusLines.join('\n'),
    });
  }

  for (const imageUrl of visualInputImages) {
    if (!imageUrl) continue;
    content.push({
      type: 'input_image',
      image_url: imageUrl,
      detail: 'low',
    });
  }

  return {
    model,
    instructions: [
      sessionInstruction,
      'You are producing structured popup help cards for the right rail of a live overlay.',
      'Return short, high-signal guidance only.',
      'If web search context is present, treat it as already-completed research and use it directly.',
      'Never tell the user to open a website, apply filters, paste a link, provide a SKU, or perform the search themselves.',
      'Use 1 to 6 cards.',
      'Each card must contain a short title, exact words to say now, up to 5 supporting points, confidence, source_context, and show_visual.',
      'Do not be too sparse when the topic is technical or the user asked for more detail.',
      'Set should_surface to false and cards to [] when no useful popup should be shown.',
      'Do not wrap the JSON in markdown fences.',
    ].join('\n\n'),
    input: [
      {
        role: 'user',
        content,
      },
    ],
    text: {
      format: {
        type: 'json_schema',
        name: 'overlay_help_cards',
        strict: true,
        schema: HELP_CARD_SCHEMA,
      },
    },
  };
}

function buildFallbackHelpPackRequest({
  sessionInstruction,
  turnText,
  visualInputImages = [],
  visualContextSummary = '',
  focusConfig = DEFAULT_FOCUS_CONFIG,
  retrievedFocusSnippets = [],
  retrievedKnowledgeItems = [],
  webIntel = null,
  model,
} = {}) {
  const content = [
    {
      type: 'input_text',
      text: [
        'Return valid JSON with this exact shape:',
        '{"primary_answer":"string","should_surface":true,"cards":[{"id":"string","title":"string","speak_now":"string","supporting_points":["string"],"confidence":"high|medium|low","source_context":"string","show_visual":true}]}',
        '',
        `Latest turn: ${turnText}`,
      ].join('\n'),
    },
  ];

  const normalizedFocus = normalizeFocusConfig(focusConfig);
  if (hasFocusConfig(normalizedFocus) || retrievedFocusSnippets.length || retrievedKnowledgeItems.length || visualContextSummary || webIntel?.summary) {
    const focusLines = ['Focus context:'];
    if (normalizedFocus.jobTitle) focusLines.push(`Role or purpose: ${normalizedFocus.jobTitle}`);
    if (normalizedFocus.objective) focusLines.push(`Desired outcome: ${normalizedFocus.objective}`);
    if (normalizedFocus.priorityTopics) {
      focusLines.push(`Priority topics: ${normalizedFocus.priorityTopics}`);
    }
    if (normalizedFocus.guidelineText) {
      focusLines.push(`Guidelines: ${normalizedFocus.guidelineText}`);
    }
    if (visualContextSummary) focusLines.push(`Visual summary: ${cleanText(visualContextSummary)}`);
    if (retrievedFocusSnippets.length) {
      focusLines.push('Retrieved references:');
      retrievedFocusSnippets.forEach((snippet, index) => {
        focusLines.push(`${index + 1}. ${snippet.text}`);
      });
    }
    if (retrievedKnowledgeItems.length) {
      focusLines.push('Matched knowledge items:');
      retrievedKnowledgeItems.forEach((item, index) => {
        focusLines.push(`${index + 1}. ${item.title}: ${item.summary}`);
      });
    }
    if (webIntel?.summary) {
      focusLines.push(`Web search summary: ${cleanText(webIntel.summary)}`);
      if (Array.isArray(webIntel.sources) && webIntel.sources.length) {
        focusLines.push('Web sources:');
        webIntel.sources.forEach((source, index) => {
          focusLines.push(`${index + 1}. ${source.source || source.title} - ${source.title} (${source.url})`);
        });
      }
    }
    if (normalizedFocus.strictFocus) {
      focusLines.push('Strict focus mode is enabled.');
    }
    content.unshift({
      type: 'input_text',
      text: focusLines.join('\n'),
    });
  }

  for (const imageUrl of visualInputImages) {
    if (!imageUrl) continue;
    content.push({
      type: 'input_image',
      image_url: imageUrl,
      detail: 'low',
    });
  }

  return {
    model,
    instructions: [
      sessionInstruction,
      'You are producing structured popup help cards for a live overlay.',
      'If web search context is present, use it as completed research and never ask the user to perform that search.',
      'Never tell the user to open a website, apply filters, paste a link, provide a SKU, or perform the search themselves.',
      'Return only JSON.',
    ].join('\n\n'),
    input: [
      {
        role: 'user',
        content,
      },
    ],
  };
}

function extractJsonObject(text = '') {
  const trimmed = String(text || '').trim();
  if (!trimmed) return null;

  try {
    return JSON.parse(trimmed);
  } catch (_err) {
    const fenced = trimmed.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/, '');
    try {
      return JSON.parse(fenced);
    } catch (_innerErr) {
      const start = fenced.indexOf('{');
      const end = fenced.lastIndexOf('}');
      if (start === -1 || end === -1 || end <= start) {
        return null;
      }
      try {
        return JSON.parse(fenced.slice(start, end + 1));
      } catch (_finalErr) {
        return null;
      }
    }
  }
}

function normalizeConfidence(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'high' || normalized === 'low') {
    return normalized;
  }
  return 'medium';
}

function normalizeSupportingPoints(points) {
  if (!Array.isArray(points)) return [];
  return points
    .map(point => String(point || '').trim())
    .filter(Boolean)
    .slice(0, 5);
}

function normalizeHelpCardPayload(payload, { hasVisual = false, preferVisual = false } = {}) {
  const rawCards = Array.isArray(payload?.cards) ? payload.cards : [];
  const cards = rawCards
    .map((card, index) => {
      const title = String(card?.title || '').trim();
      const speakNow = String(card?.speak_now || '').trim();
      if (!title && !speakNow) {
        return null;
      }
      return {
        id: String(card?.id || `card_${index + 1}`).trim() || `card_${index + 1}`,
        title: title || `Suggestion ${index + 1}`,
        speak_now: speakNow || title,
        supporting_points: normalizeSupportingPoints(card?.supporting_points),
        confidence: normalizeConfidence(card?.confidence),
        source_context: String(card?.source_context || 'context').trim() || 'context',
        show_visual: Boolean(card?.show_visual) && hasVisual,
      };
    })
    .filter(Boolean)
    .slice(0, 6);

  if (preferVisual && hasVisual && cards.length && !cards.some(card => card.show_visual)) {
    cards[0] = {
      ...cards[0],
      show_visual: true,
    };
  }

  const primaryAnswer = String(payload?.primary_answer || '').trim();
  return {
    primary_answer: primaryAnswer,
    should_surface: Boolean(payload?.should_surface) && cards.length > 0,
    cards,
  };
}

function normalizeWebIntelPayload(payload) {
  const sources = Array.isArray(payload?.sources)
    ? payload.sources
        .map(source => ({
          source: cleanText(source?.source || ''),
          title: cleanText(source?.title || ''),
          url: cleanText(source?.url || ''),
        }))
        .filter(source => source.title && source.url)
        .slice(0, 5)
    : [];

  return {
    should_search: Boolean(payload?.should_search),
    summary: cleanText(payload?.summary || ''),
    sources,
  };
}

function buildWebIntelRequest({
  focusConfig = DEFAULT_FOCUS_CONFIG,
  retrievedFocusSnippets = [],
  retrievedKnowledgeItems = [],
  turnText = '',
  visualContextSummary = '',
  model,
} = {}) {
  const normalizedFocus = normalizeFocusConfig(focusConfig);
  const lines = [
    'Answer the latest user turn with fresh, current, web-grounded information.',
    'You are responsible for doing the lookup. Do not delegate lookup steps back to the user.',
    'The latest user turn is the primary task.',
    'If older focus text, prior examples, or visual context are on a different topic, ignore them completely.',
    `User turn: ${turnText}`,
  ];

  if (normalizedFocus.jobTitle && contextIsRelevantToTurn(turnText, normalizedFocus.jobTitle)) {
    lines.push(`Potential background context, only if relevant: role or purpose = ${normalizedFocus.jobTitle}`);
  }
  if (normalizedFocus.objective && contextIsRelevantToTurn(turnText, normalizedFocus.objective)) {
    lines.push(`Potential background context, only if relevant: target outcome = ${normalizedFocus.objective}`);
  }
  if (normalizedFocus.priorityTopics && contextIsRelevantToTurn(turnText, normalizedFocus.priorityTopics)) {
    lines.push(`Potential background context, only if relevant: priority topics = ${normalizedFocus.priorityTopics}`);
  }
  if (normalizedFocus.guidelineText && contextIsRelevantToTurn(turnText, normalizedFocus.guidelineText)) {
    lines.push(`Potential background context, only if relevant: guidelines = ${normalizedFocus.guidelineText}`);
  }
  if (normalizedFocus.webSearchHint && contextIsRelevantToTurn(turnText, normalizedFocus.webSearchHint)) {
    lines.push(`Optional search hint: ${normalizedFocus.webSearchHint}`);
  }
  if (visualContextSummary && contextIsRelevantToTurn(turnText, visualContextSummary)) {
    lines.push(`Potential visual context, only if relevant: ${cleanText(visualContextSummary)}`);
  }
  if (retrievedFocusSnippets.length) {
    const relevantSnippets = retrievedFocusSnippets.filter(snippet => contextIsRelevantToTurn(turnText, snippet?.text || ''));
    if (relevantSnippets.length) {
      lines.push('Potential retrieved references, only if relevant:');
      relevantSnippets.forEach((snippet, index) => {
        lines.push(`${index + 1}. ${snippet.text}`);
      });
    }
  }
  if (retrievedKnowledgeItems.length) {
    const relevantKnowledge = retrievedKnowledgeItems.filter(item =>
      contextIsRelevantToTurn(turnText, `${item?.title || ''} ${item?.summary || ''}`)
    );
    if (relevantKnowledge.length) {
      lines.push('Potential matched knowledge items, only if relevant:');
      relevantKnowledge.forEach((item, index) => {
        lines.push(`${index + 1}. ${item.title}: ${item.summary}`);
      });
    }
  }

  return {
    model,
    tools: [{ type: 'web_search' }],
    include: ['web_search_call.action.sources'],
    instructions: [
      'Use the web search tool for this request.',
      'Do the lookup yourself. Never tell the user to open a website, apply filters, paste a link, provide a SKU, search Google, or browse manually.',
      'For product, price, availability, SKU, RAM, configuration, or exact-link requests: search official manufacturer/store pages first, then reputable retailers only if official sources do not provide a direct match.',
      'For product lookups, the summary must name concrete matching candidates or say no exact match was found after searching; include direct product/category URLs in sources.',
      'Do not call a category, filtered listing, search result, or collection page an exact product link. Only direct product detail pages count as exact product links.',
      'If the first result is a category/listing page but reveals a product name or SKU, search again for that product name/SKU and return the direct product page if available.',
      'Set should_search to true when web results were used.',
      'Write summary as the direct user-facing answer in 2 to 8 concise sentences.',
      'Do not say you cannot browse, search, or access the internet.',
      'Return only sources that were actually useful to the answer.',
    ].join('\n'),
    input: [
      {
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: lines.join('\n'),
          },
        ],
      },
    ],
    text: {
      format: {
        type: 'json_schema',
        name: 'overlay_web_intel',
        strict: true,
        schema: WEB_INTEL_SCHEMA,
      },
    },
  };
}

module.exports = {
  DEFAULT_FOCUS_CONFIG,
  DEFAULT_SESSION_OPTIONS,
  HELP_CARD_SCHEMA,
  WEB_INTEL_SCHEMA,
  buildFallbackHelpPackRequest,
  buildFocusContextMessage,
  buildFocusInstructionBlock,
  buildHelpPackHash,
  buildHelpPackRequest,
  buildRealtimeSessionConfig,
  buildSessionInstruction,
  buildWebIntelRequest,
  chunkReferenceText,
  extractJsonObject,
  hasExplicitWebLookupIntent,
  hasFocusConfig,
  hasProductLookupIntent,
  normalizeFocusConfig,
  normalizeSessionOptions,
  normalizeHelpCardPayload,
  normalizeWebIntelPayload,
  contextIsRelevantToTurn,
  retrieveFocusSnippets,
  resolveOutputLanguage,
  resolveTranscriptionLanguage,
  shouldAnswerWithWebFirst,
  shouldRunWebSearch,
};
