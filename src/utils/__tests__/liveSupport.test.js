const { test } = require('node:test');
const assert = require('node:assert');

const {
  buildFocusContextMessage,
  buildHelpPackHash,
  buildRealtimeSessionConfig,
  buildSessionInstruction,
  buildWebIntelRequest,
  contextIsRelevantToTurn,
  hasExplicitWebLookupIntent,
  hasProductLookupIntent,
  normalizeFocusConfig,
  normalizeHelpCardPayload,
  retrieveFocusSnippets,
  shouldAnswerWithWebFirst,
  shouldRunWebSearch,
} = require('../../../backend/liveSupport');

test('buildSessionInstruction uses the selected profile, context, and output language without non-OpenAI search guidance', () => {
  const instruction = buildSessionInstruction({
    profile: 'interview',
    language: 'de-DE',
    customPrompt: 'Candidate background: hardware engineering and embedded systems.',
    contextParams: {
      allowedSources: 'screen context only',
      toneLength: 'short and direct',
      disallowedTopics: 'salary expectations',
    },
    focusConfig: {
      jobTitle: 'Senior hardware engineer interview',
      objective: 'Demonstrate strong board bring-up depth',
      priorityTopics: 'oscilloscope, DDR timing, CAN bus',
      strictFocus: true,
      webSearchEnabled: true,
      webSearchHint: 'PCIe 7.0 roadmap',
    },
  });

  assert.match(instruction, /Always answer in German/i);
  assert.match(instruction, /hardware engineering and embedded systems/i);
  assert.match(instruction, /Allowed sources: screen context only/i);
  assert.match(instruction, /Senior hardware engineer interview/i);
  assert.match(instruction, /Demonstrate strong board bring-up depth/i);
  assert.match(instruction, /Current web search is enabled/i);
  assert.match(instruction, /Never ask the user to open a site/i);
  assert.doesNotMatch(instruction, /SEARCH TOOL USAGE/i);
  assert.doesNotMatch(instruction, /ask for the exact fact to verify/i);
});

test('buildRealtimeSessionConfig only sets transcription language when locale mapping is supported', () => {
  const mapped = buildRealtimeSessionConfig({
    instructions: 'hello',
    language: 'fr-FR',
    outputModalities: ['text'],
    transcriptionModel: 'gpt-4o-mini-transcribe',
    voice: 'marin',
  });
  const unmapped = buildRealtimeSessionConfig({
    instructions: 'hello',
    language: 'xx-YY',
    outputModalities: ['text'],
    transcriptionModel: 'gpt-4o-mini-transcribe',
    voice: 'marin',
  });

  assert.strictEqual(mapped.audio.input.transcription.language, 'fr');
  assert.ok(!('language' in unmapped.audio.input.transcription));
});

test('normalizeHelpCardPayload trims invalid fields and suppresses visuals without a preview', () => {
  const normalized = normalizeHelpCardPayload(
    {
      primary_answer: 'Ask about board bring-up experience.',
      should_surface: true,
      cards: [
        {
          id: 'a',
          title: 'Hardware bring-up',
          speak_now: 'Walk me through your last board bring-up.',
          supporting_points: ['mention debug tools', 'show signal-integrity experience', '', 'drop'],
          confidence: 'HIGH',
          source_context: 'transcript + profile',
          show_visual: true,
        },
      ],
    },
    { hasVisual: false }
  );

  assert.strictEqual(normalized.primary_answer, 'Ask about board bring-up experience.');
  assert.strictEqual(normalized.should_surface, true);
  assert.deepStrictEqual(normalized.cards, [
    {
      id: 'a',
      title: 'Hardware bring-up',
      speak_now: 'Walk me through your last board bring-up.',
      supporting_points: ['mention debug tools', 'show signal-integrity experience', 'drop'],
      confidence: 'high',
      source_context: 'transcript + profile',
      show_visual: false,
    },
  ]);
});

test('buildHelpPackHash dedupes equivalent turn text', () => {
  assert.strictEqual(buildHelpPackHash(' Tell me about DDR timing. '), buildHelpPackHash('tell me about ddr timing.'));
});

test('retrieveFocusSnippets ranks the most relevant reference text for the current turn', () => {
  const snippets = retrieveFocusSnippets({
    focusConfig: {
      jobTitle: 'Hardware interview',
      objective: 'Answer board bring-up questions with specifics',
      priorityTopics: 'DDR timing, oscilloscope, CAN bus',
      referenceText: [
        'Built a DDR4 bring-up checklist using oscilloscope captures and eye diagrams to debug timing margins.',
        'Led frontend performance tuning for a React dashboard with heavy memoization work.',
        'Diagnosed intermittent CAN bus faults by checking termination, ground offsets, and arbitration errors.',
      ].join('\n\n'),
      strictFocus: true,
    },
    turnText: 'How do you talk about DDR timing validation during board bring-up?',
    limit: 2,
  });

  assert.strictEqual(snippets.length, 2);
  assert.match(snippets[0].text, /DDR4 bring-up checklist/i);
  assert.match(snippets[1].text, /CAN bus faults/i);
});

test('buildFocusContextMessage packages objective, retrieved snippets, and strict focus rules', () => {
  const message = buildFocusContextMessage({
    focusConfig: normalizeFocusConfig({
      jobTitle: 'Auto diagnostics walkthrough',
      objective: 'Narrow the answer to the fault tree',
      priorityTopics: 'battery voltage, starter relay',
      strictFocus: true,
    }),
    retrievedSnippets: [
      { id: 'snippet_1', text: 'Check battery voltage under load before replacing the starter.' },
    ],
    turnText: 'What should I say first when the car only clicks once?',
    visualSummary: 'Imported video of the starter area and battery terminals.',
  });

  assert.match(message, /Most recent user turn/i);
  assert.match(message, /Auto diagnostics walkthrough/i);
  assert.match(message, /battery voltage under load/i);
  assert.match(message, /Strict focus mode is enabled/i);
});

test('shouldRunWebSearch fires for explicit or freshness-sensitive turns even without the toggle, and always when forced', () => {
  const focusConfig = normalizeFocusConfig({
    webSearchEnabled: false,
    webSearchHint: 'DDR5 JEDEC update',
  });

  assert.strictEqual(
    shouldRunWebSearch(focusConfig, 'What is the latest DDR5 JEDEC speed update?'),
    true
  );
  assert.strictEqual(
    shouldRunWebSearch(focusConfig, 'Search the internet for the latest OpenAI Realtime pricing.'),
    true
  );
  assert.strictEqual(
    shouldRunWebSearch(focusConfig, 'Give me a timeless elevator pitch for my experience.'),
    false
  );
  assert.strictEqual(
    shouldRunWebSearch(focusConfig, 'Give me a timeless elevator pitch for my experience.', { force: true }),
    true
  );
});

test('product and exact-link lookups use grounded web first', () => {
  const turn =
    'Please open the official HP US Store, apply filters for 32 GB RAM and a price under $1,500, and paste the exact product link for a preconfigured laptop.';
  const focusConfig = normalizeFocusConfig({
    webSearchEnabled: true,
  });

  assert.strictEqual(hasExplicitWebLookupIntent(turn), true);
  assert.strictEqual(hasProductLookupIntent(turn), true);
  assert.strictEqual(shouldRunWebSearch(focusConfig, turn), true);
  assert.strictEqual(shouldAnswerWithWebFirst(focusConfig, turn), true);
});

test('buildWebIntelRequest includes the web search tool and current focus context', () => {
  const request = buildWebIntelRequest({
    focusConfig: normalizeFocusConfig({
      jobTitle: 'Hardware interview',
      objective: 'Answer with current standards information',
      webSearchEnabled: true,
      webSearchHint: 'USB4 v2 adoption',
    }),
    retrievedFocusSnippets: [
      { id: 'snippet_1', text: 'Resume bullet about high-speed bus validation.' },
    ],
    turnText: 'What is the latest USB4 v2 rollout status?',
    visualContextSummary: 'Imported block diagram showing high-speed interfaces.',
    model: 'gpt-5.4-mini',
  });

  assert.strictEqual(request.model, 'gpt-5.4-mini');
  assert.deepStrictEqual(request.tools, [{ type: 'web_search' }]);
  assert.deepStrictEqual(request.include, ['web_search_call.action.sources']);
  assert.match(request.instructions, /Use the web search tool/i);
  assert.match(request.instructions, /Do the lookup yourself/i);
  assert.match(request.instructions, /Never tell the user to open a website/i);
  assert.match(request.instructions, /Only direct product detail pages count as exact product links/i);
  assert.match(request.instructions, /Do not say you cannot browse/i);
  assert.match(request.input[0].content[0].text, /USB4 v2 rollout status/i);
  assert.doesNotMatch(request.input[0].content[0].text, /Resume bullet about high-speed bus validation/i);
});

test('contextIsRelevantToTurn ignores stale unrelated background and respects explicit ignore terms', () => {
  assert.strictEqual(
    contextIsRelevantToTurn(
      'Search the internet for the latest OpenAI Realtime API pricing and web search support. Ignore HP.',
      'hp.com only and its products'
    ),
    false
  );
  assert.strictEqual(
    contextIsRelevantToTurn(
      'Search the internet for the latest OpenAI Realtime API pricing and web search support.',
      'OpenAI pricing and API capabilities'
    ),
    true
  );
});
