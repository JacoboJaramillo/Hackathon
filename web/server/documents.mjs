import { randomUUID } from 'node:crypto';
import { Worker } from 'node:worker_threads';

export const MAX_BYTES = 20 * 1024 * 1024;
export const MAX_CHARS = 20_000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const utf8 = new TextDecoder('utf-8', { fatal: true });

export function detectType(buf) {
  if (buf.length >= 5 && buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf';
  if (buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 3 && buf[3] === 4) {
    return buf.includes('word/document.xml') ? 'docx' : null;
  }
  if (buf.includes(0)) return null;
  try {
    utf8.decode(buf);
    return 'txt';
  } catch {
    return null;
  }
}

const WORKER_URL = new URL('./parse-worker.mjs', import.meta.url);
const WORKER_LIMITS = { maxOldGenerationSizeMb: 192, maxYoungGenerationSizeMb: 32 };
const WORKER_DEADLINE_MS = 10_000;

// PDF and DOCX parsing runs in a throwaway worker so a decompression bomb cannot
// block the event loop (live voice relays share it) or exhaust the instance memory.
function extractInWorker(tipo, buf) {
  return new Promise((resolve, reject) => {
    const u8 = new Uint8Array(buf);
    // Copy into a standalone ArrayBuffer so transferring never detaches a pooled Buffer.
    const copy = u8.slice();
    const worker = new Worker(WORKER_URL, {
      workerData: { tipo, buf: copy },
      transferList: [copy.buffer],
      resourceLimits: WORKER_LIMITS,
    });
    const timer = setTimeout(() => {
      worker.terminate();
      reject(new Error('timeout'));
    }, WORKER_DEADLINE_MS);
    const done = (fn, v) => {
      clearTimeout(timer);
      worker.terminate();
      fn(v);
    };
    worker.once('message', (m) => (m.error ? done(reject, new Error(m.error)) : done(resolve, m.text)));
    worker.once('error', (e) => done(reject, e));
    worker.once('exit', (code) => done(reject, new Error(`worker exit ${code}`)));
  });
}

async function extract(tipo, buf) {
  if (tipo === 'txt') return utf8.decode(buf);
  return extractInWorker(tipo, buf);
}

function normalize(s) {
  return s
    .replace(/^﻿/, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const fail = (status, error, mensaje) => ({ ok: false, status, error, mensaje });

export async function parseDocument(buf) {
  if (buf.length === 0) return fail(400, 'vacio', 'El archivo está vacío.');
  if (buf.length > MAX_BYTES) {
    return fail(413, 'demasiado_grande', 'El archivo supera el tamaño máximo de 20 MB.');
  }
  const tipo = detectType(buf);
  const unsupported = fail(
    415,
    'tipo_no_soportado',
    'No pude leer ese archivo. Sube un PDF, DOCX o TXT válido.',
  );
  if (!tipo) return unsupported;
  let raw;
  try {
    raw = await extract(tipo, buf);
  } catch {
    return unsupported;
  }
  let text = normalize(raw);
  if (!text) {
    return fail(422, 'sin_texto', 'No encontré texto en el documento. Si es un escaneo, prueba con otro archivo.');
  }
  const truncado = text.length > MAX_CHARS;
  if (truncado) text = text.slice(0, MAX_CHARS);
  return { ok: true, tipo, text, caracteres: text.length, truncado };
}

export function createDocumentStore({ ttlMs = 30 * 60_000, max = 100, now = Date.now } = {}) {
  // ponytail: in-memory per instance; session affinity keeps upload and voice on the same
  // instance. Move to Redis/Memorystore if instances grow.
  const entries = new Map();
  return {
    put(record) {
      const t = now();
      for (const [k, v] of entries) if (v.expires <= t) entries.delete(k);
      while (entries.size >= max) entries.delete(entries.keys().next().value);
      const id = randomUUID();
      entries.set(id, { record, expires: t + ttlMs });
      return id;
    },
    get(id) {
      if (typeof id !== 'string' || !UUID_RE.test(id)) return null;
      const e = entries.get(id);
      if (!e) return null;
      if (e.expires <= now()) {
        entries.delete(id);
        return null;
      }
      return e.record;
    },
    size: () => entries.size,
  };
}
