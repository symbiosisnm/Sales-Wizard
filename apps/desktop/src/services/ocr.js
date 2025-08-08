import { createWorker } from 'tesseract.js';
import EventEmitter from 'events';
import eng from '@tesseract.js-data/eng';

const pool = [];
const queue = [];
let initialized = false;
let language = 'eng';
const emitter = new EventEmitter();

async function init(size = 2, lang = 'eng') {
  if (initialized) return;
  language = lang;
  for (let i = 0; i < size; i++) {
    const worker = await createWorker({ langPath: eng.langPath });
    await worker.load();
    await worker.loadLanguage(language);
    await worker.initialize(language);
    pool.push({ worker, busy: false });
  }
  initialized = true;
}

function getFreeWorker() {
  return pool.find(w => !w.busy);
}

async function processQueue() {
  const job = queue.shift();
  if (!job) return;
  const slot = getFreeWorker();
  if (!slot) {
    queue.unshift(job);
    return;
  }
  slot.busy = true;
  try {
    const { data } = await slot.worker.recognize(job.image, job.options);
    slot.busy = false;
    job.resolve({ text: data.text, confidence: data.confidence, bbox: data.words.map(w => w.bbox) });
  } catch (err) {
    slot.busy = false;
    job.reject(err);
  }
  processQueue();
}

async function recognize(image, options = {}) {
  if (!initialized) await init();
  return new Promise((resolve, reject) => {
    const job = { image, options, resolve, reject };
    queue.push(job);
    processQueue();
  });
}

function cancel(job) {
  const idx = queue.indexOf(job);
  if (idx >= 0) queue.splice(idx, 1);
}

export { init, recognize, cancel, emitter };
