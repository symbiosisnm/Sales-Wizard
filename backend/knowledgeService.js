const fs = require('node:fs/promises');
const path = require('node:path');

const Tesseract = require('tesseract.js');

const { resolveKnowledgePaths } = require('./appData');
const {
  cleanupPaths,
  createClipFromFrames,
  extractAudioTrack,
  extractFramesAtTimes,
  hasBundledFfmpeg,
} = require('./ffmpegUtils');
const {
  buildAssetUrl,
  copyFileIntoKnowledgeStore,
  createKnowledgeId,
  deleteKnowledgeItem,
  getKnowledgeItemsByIds,
  listKnowledgeItems,
  listKnowledgeRecords,
  serializeKnowledgeItem,
  updateKnowledgeItem,
  upsertKnowledgeItem,
} = require('./knowledgeStore');
const { rankKnowledgeItems } = require('./knowledgeRetrieval');

const RESPONSES_URL = 'https://api.openai.com/v1/responses';
const EMBEDDINGS_URL = 'https://api.openai.com/v1/embeddings';
const TRANSCRIPTIONS_URL = 'https://api.openai.com/v1/audio/transcriptions';
const DEFAULT_TEXT_MODEL = process.env.OPENAI_TEXT_MODEL || 'gpt-5.4-mini';
const DEFAULT_EMBEDDING_MODEL = process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small';
const DEFAULT_TRANSCRIPTION_MODEL =
  process.env.OPENAI_TRANSCRIPTION_MODEL || 'gpt-4o-mini-transcribe';

function cleanText(value = '') {
  return String(value || '').trim();
}

function normalizeTags(tags = []) {
  if (!Array.isArray(tags)) {
    return [];
  }
  return [...new Set(tags.map(tag => cleanText(tag).toLowerCase()).filter(Boolean))].slice(0, 16);
}

function detectFileKind(filePath, hint = '') {
  const extension = path.extname(filePath).toLowerCase();
  const hinted = cleanText(hint).toLowerCase();
  if (hinted === 'image' || /\.(png|jpe?g|webp|gif|bmp|svg)$/i.test(extension)) {
    return 'image';
  }
  if (hinted === 'video' || /\.(mp4|mov|m4v|avi|mkv|webm)$/i.test(extension)) {
    return 'video';
  }
  return 'guideline';
}

function htmlToText(html = '') {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractTitleFromHtml(html = '', fallback = '') {
  const match = String(html || '').match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return cleanText(match?.[1] || fallback || 'Linked reference');
}

function guessImageMime(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === '.png') return 'image/png';
  if (extension === '.webp') return 'image/webp';
  if (extension === '.gif') return 'image/gif';
  if (extension === '.svg') return 'image/svg+xml';
  return 'image/jpeg';
}

function buildDerivedAsset(kind, label, mimeType, relativePath) {
  const normalizedPath = cleanText(relativePath);
  return {
    kind: cleanText(kind),
    label: cleanText(label),
    mimeType: cleanText(mimeType),
    relativePath: normalizedPath,
    url: normalizedPath ? buildAssetUrl(normalizedPath) : '',
  };
}

async function postJson(apiKey, url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload?.error?.message || `Request failed for ${url}`);
  }
  return payload;
}

function extractResponseText(payload) {
  if (typeof payload?.output_text === 'string' && payload.output_text.trim()) {
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

async function createEmbedding(apiKey, text) {
  const normalizedText = cleanText(text);
  if (!normalizedText) {
    return [];
  }
  const payload = await postJson(apiKey, EMBEDDINGS_URL, {
    model: DEFAULT_EMBEDDING_MODEL,
    input: normalizedText.slice(0, 12000),
  });
  return Array.isArray(payload?.data?.[0]?.embedding) ? payload.data[0].embedding : [];
}

async function summarizeText(apiKey, { title, text, sourceContext }) {
  const payload = await postJson(apiKey, RESPONSES_URL, {
    model: DEFAULT_TEXT_MODEL,
    instructions: [
      'Summarize this knowledge source for a live assistant overlay.',
      'Return 2 to 4 short sentences.',
      'Emphasize the details that would help answer future user questions quickly.',
      sourceContext ? `Source context: ${sourceContext}` : '',
    ]
      .filter(Boolean)
      .join('\n'),
    input: [
      {
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: [`Title: ${title}`, '', text.slice(0, 16000)].join('\n'),
          },
        ],
      },
    ],
  });
  return extractResponseText(payload);
}

async function summarizeImages(apiKey, { title, images = [], sourceContext, extraText = '' }) {
  const payload = await postJson(apiKey, RESPONSES_URL, {
    model: DEFAULT_TEXT_MODEL,
    instructions: [
      'Summarize these visual materials for a live assistant overlay.',
      'Return 2 to 4 short sentences.',
      'Mention objects, diagrams, states, visible clues, or procedures that would help answer questions quickly.',
      sourceContext ? `Source context: ${sourceContext}` : '',
    ]
      .filter(Boolean)
      .join('\n'),
    input: [
      {
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: [`Visual title: ${title}`, extraText || ''].filter(Boolean).join('\n'),
          },
          ...images.slice(0, 6).map(imageUrl => ({
            type: 'input_image',
            image_url: imageUrl,
            detail: 'low',
          })),
        ],
      },
    ],
  });
  return extractResponseText(payload);
}

async function fileToDataUrl(filePath, mimeType) {
  const buffer = await fs.readFile(filePath);
  return `data:${mimeType};base64,${buffer.toString('base64')}`;
}

async function filterExistingFiles(filePaths = []) {
  const existing = [];
  for (const filePath of filePaths.filter(Boolean)) {
    try {
      await fs.access(filePath);
      existing.push(filePath);
    } catch (_error) {
      // Live clip extraction can skip a frame near the end of a very short clip.
    }
  }
  return existing;
}

async function tryOcrImage(filePath) {
  try {
    const result = await Promise.race([
      Tesseract.recognize(filePath, 'eng', { logger: () => {} }),
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error('OCR timeout')), 15000);
      }),
    ]);
    return cleanText(result?.data?.text || '');
  } catch (_error) {
    return '';
  }
}

async function tryTranscribeAudio(apiKey, audioPath) {
  try {
    const buffer = await fs.readFile(audioPath);
    const formData = new FormData();
    formData.append('model', DEFAULT_TRANSCRIPTION_MODEL);
    formData.append(
      'file',
      new Blob([buffer], { type: 'audio/wav' }),
      path.basename(audioPath) || 'audio.wav'
    );

    const response = await fetch(TRANSCRIPTIONS_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: formData,
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload?.error?.message || 'Audio transcription failed');
    }
    return cleanText(payload?.text || '');
  } catch (_error) {
    return '';
  }
}

async function persistClipAssets(itemId, clipPath) {
  const { assetsDir } = resolveKnowledgePaths();
  const clipDir = path.join(assetsDir, itemId);
  await fs.mkdir(clipDir, { recursive: true });
  const relativeAssetPath = path.join(itemId, 'source.mp4');
  await fs.copyFile(clipPath, path.join(assetsDir, relativeAssetPath));
  return relativeAssetPath;
}

async function persistExtractedFrames(itemId, extractedFramePaths = []) {
  const { assetsDir } = resolveKnowledgePaths();
  return extractedFramePaths.map((framePath, index) =>
    buildDerivedAsset(
      'frame',
      `Frame ${index + 1}`,
      'image/jpeg',
      path.relative(assetsDir, framePath)
    )
  );
}

async function ingestGuideline({ apiKey, text, title, tags = [], scope = 'library', sessionId = '' }) {
  const normalizedText = cleanText(text);
  const normalizedTitle = cleanText(title || 'Guideline');
  const summary = await summarizeText(apiKey, {
    title: normalizedTitle,
    text: normalizedText,
    sourceContext: 'User-authored guidelines and preferred wording',
  });
  const embedding = await createEmbedding(apiKey, `${normalizedTitle}\n${summary}\n${normalizedText}`);
  return upsertKnowledgeItem({
    kind: 'guideline',
    scope,
    sessionId,
    title: normalizedTitle,
    summary: summary || normalizedText,
    tags: normalizeTags(tags),
    sourceContext: 'guideline',
    textContent: normalizedText,
    embedding,
    embeddingModel: DEFAULT_EMBEDDING_MODEL,
  });
}

async function ingestUrl({ apiKey, url, title = '', tags = [], scope = 'library', sessionId = '' }) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Sales Wizard Knowledge Import',
    },
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`);
  }
  const html = await response.text();
  const text = htmlToText(html);
  const resolvedTitle = cleanText(title || extractTitleFromHtml(html, url));
  const summary = await summarizeText(apiKey, {
    title: resolvedTitle,
    text,
    sourceContext: `Imported web page from ${url}`,
  });
  const embedding = await createEmbedding(apiKey, `${resolvedTitle}\n${summary}\n${text.slice(0, 6000)}`);
  return upsertKnowledgeItem({
    kind: 'link',
    scope,
    sessionId,
    title: resolvedTitle,
    summary: summary || text.slice(0, 500),
    tags: normalizeTags(tags),
    sourceUrl: url,
    sourceContext: 'web page',
    textContent: text.slice(0, 24000),
    embedding,
    embeddingModel: DEFAULT_EMBEDDING_MODEL,
  });
}

async function ingestImageFile({
  apiKey,
  filePath,
  title = '',
  tags = [],
  scope = 'library',
  sessionId = '',
}) {
  const itemId = createKnowledgeId('image');
  const copied = await copyFileIntoKnowledgeStore({
    filePath,
    itemId,
  });
  const imageDataUrl = await fileToDataUrl(copied.destinationPath, guessImageMime(copied.destinationPath));
  const ocrText = await tryOcrImage(copied.destinationPath);
  const resolvedTitle = cleanText(title || copied.fileName || 'Image reference');
  const summary = await summarizeImages(apiKey, {
    title: resolvedTitle,
    images: [imageDataUrl],
    sourceContext: 'Imported image',
    extraText: ocrText ? `Visible text extracted with OCR:\n${ocrText.slice(0, 4000)}` : '',
  });
  const embedding = await createEmbedding(
    apiKey,
    [resolvedTitle, summary, ocrText].filter(Boolean).join('\n')
  );
  return upsertKnowledgeItem({
    id: itemId,
    kind: 'image',
    scope,
    sessionId,
    title: resolvedTitle,
    summary: summary || resolvedTitle,
    tags: normalizeTags(tags),
    sourceContext: 'image',
    relativeAssetPath: copied.relativeAssetPath,
    fileName: copied.fileName,
    textContent: ocrText,
    derivedAssets: [
      buildDerivedAsset('preview', 'Source image', guessImageMime(copied.destinationPath), copied.relativeAssetPath),
    ],
    embedding,
    embeddingModel: DEFAULT_EMBEDDING_MODEL,
  });
}

async function ingestVideoFile({
  apiKey,
  filePath,
  title = '',
  tags = [],
  scope = 'library',
  sessionId = '',
}) {
  if (!hasBundledFfmpeg()) {
    throw new Error('ffmpeg is not available for video analysis');
  }

  const itemId = createKnowledgeId('video');
  const copied = await copyFileIntoKnowledgeStore({
    filePath,
    itemId,
  });
  const { assetsDir, tempDir } = resolveKnowledgePaths();
  const extractedFrameDir = path.join(assetsDir, itemId, 'frames');
  const tempAudioPath = path.join(tempDir, `${itemId}.wav`);

  try {
    const extracted = await extractFramesAtTimes({
      inputPath: copied.destinationPath,
      outputDir: extractedFrameDir,
      maxFrames: 6,
      prefix: 'frame',
    });
    const frameDataUrls = await Promise.all(
      extracted.framePaths.map(framePath => fileToDataUrl(framePath, 'image/jpeg'))
    );

    let transcriptText = '';
    try {
      await extractAudioTrack({
        inputPath: copied.destinationPath,
        outputPath: tempAudioPath,
      });
      transcriptText = await tryTranscribeAudio(apiKey, tempAudioPath);
    } catch (_error) {
      transcriptText = '';
    }

    const resolvedTitle = cleanText(title || copied.fileName || 'Video reference');
    const summary = await summarizeImages(apiKey, {
      title: resolvedTitle,
      images: frameDataUrls,
      sourceContext: 'Imported video',
      extraText: transcriptText ? `Audio transcript:\n${transcriptText.slice(0, 5000)}` : '',
    });
    const embedding = await createEmbedding(
      apiKey,
      [resolvedTitle, summary, transcriptText].filter(Boolean).join('\n')
    );
    const derivedAssets = await persistExtractedFrames(itemId, extracted.framePaths);

    return upsertKnowledgeItem({
      id: itemId,
      kind: 'video',
      scope,
      sessionId,
      title: resolvedTitle,
      summary: summary || resolvedTitle,
      tags: normalizeTags(tags),
      sourceContext: 'video',
      relativeAssetPath: copied.relativeAssetPath,
      fileName: copied.fileName,
      textContent: transcriptText,
      derivedAssets,
      embedding,
      embeddingModel: DEFAULT_EMBEDDING_MODEL,
    });
  } finally {
    await cleanupPaths([tempAudioPath]);
  }
}

async function ingestFile({
  apiKey,
  filePath,
  title = '',
  tags = [],
  scope = 'library',
  sessionId = '',
  kindHint = '',
}) {
  const kind = detectFileKind(filePath, kindHint);
  if (kind === 'image') {
    return ingestImageFile({ apiKey, filePath, title, tags, scope, sessionId });
  }
  if (kind === 'video') {
    return ingestVideoFile({ apiKey, filePath, title, tags, scope, sessionId });
  }

  const fileContents = await fs.readFile(path.resolve(filePath), 'utf8');
  return ingestGuideline({
    apiKey,
    text: fileContents,
    title: cleanText(title || path.basename(filePath)),
    tags,
    scope,
    sessionId,
  });
}

async function ingestClipFrames({
  apiKey,
  title,
  frames = [],
  tags = [],
  sessionId = '',
}) {
  if (!hasBundledFfmpeg()) {
    throw new Error('ffmpeg is not available for clip analysis');
  }
  if (!Array.isArray(frames) || !frames.length) {
    throw new Error('No rolling clip frames were provided');
  }

  const itemId = createKnowledgeId('clip');
  const { assetsDir, tempDir } = resolveKnowledgePaths();
  const { clipPath, frameDir } = await createClipFromFrames({
    frames,
    clipName: itemId,
    outputDir: tempDir,
    fps: Math.max(1, Math.min(4, frames.length - 1 || 1)),
  });

  try {
    const relativeAssetPath = await persistClipAssets(itemId, clipPath);
    const frameOutputDir = path.join(assetsDir, itemId, 'frames');
    const extracted = await extractFramesAtTimes({
      inputPath: clipPath,
      outputDir: frameOutputDir,
      maxFrames: Math.min(6, frames.length),
      prefix: 'clip',
    });
    const extractedFramePaths = await filterExistingFiles(extracted.framePaths);

    const imageDataUrls = extractedFramePaths.length
      ? await Promise.all(extractedFramePaths.map(framePath => fileToDataUrl(framePath, 'image/jpeg')))
      : frames.slice(0, 6);
    const summary = await summarizeImages(apiKey, {
      title: cleanText(title || 'Rolling live clip'),
      images: imageDataUrls,
      sourceContext: 'Rolling live screen clip',
    });
    const embedding = await createEmbedding(apiKey, `${title}\n${summary}`);
    const derivedAssets = extractedFramePaths.length
      ? await persistExtractedFrames(itemId, extractedFramePaths)
      : [];
    const item = upsertKnowledgeItem({
      id: itemId,
      kind: 'clip',
      scope: 'session',
      sessionId,
      title: cleanText(title || 'Live clip'),
      summary,
      tags: normalizeTags(tags),
      sourceContext: 'rolling clip',
      relativeAssetPath,
      derivedAssets,
      embedding,
      embeddingModel: DEFAULT_EMBEDDING_MODEL,
    });

    return {
      ...item,
      inputImages: imageDataUrls,
      previewDataUrl: imageDataUrls[0] || '',
      videoAssetUrl: buildAssetUrl(relativeAssetPath),
    };
  } finally {
    await cleanupPaths([clipPath, frameDir]);
  }
}

async function retrieveKnowledgeMatches({
  apiKey,
  turnText,
  selectedKnowledgeIds = [],
  sessionId = '',
  limit = 6,
}) {
  const items = listKnowledgeRecords({ sessionId });
  if (!items.length) {
    return [];
  }

  let queryEmbedding = [];
  try {
    queryEmbedding = await createEmbedding(apiKey, turnText);
  } catch (_error) {
    queryEmbedding = [];
  }

  const ranked = rankKnowledgeItems({
    items,
    queryText: turnText,
    queryEmbedding,
    selectedKnowledgeIds,
    limit,
  });
  const byId = new Map(items.map(item => [item.id, serializeKnowledgeItem(item)]));

  return ranked.map(match => ({
    ...(byId.get(match.id) || {}),
    score: Number(match.score.toFixed(4)),
    reason: match.reason,
  }));
}

module.exports = {
  buildAssetUrl,
  deleteKnowledgeItem,
  getKnowledgeItemsByIds,
  hasBundledFfmpeg,
  ingestClipFrames,
  ingestFile,
  ingestGuideline,
  ingestUrl,
  listKnowledgeItems,
  retrieveKnowledgeMatches,
  summarizeImages,
  summarizeText,
  updateKnowledgeItem,
};
