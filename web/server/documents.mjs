import { randomUUID } from 'node:crypto';
import { unzipSync } from 'fflate';
import { extractText } from 'unpdf';

export const MAX_BYTES = 20 * 1024 * 1024;
export const MAX_CHARS = 20_000;
// Declared uncompressed size allowed for word/document.xml (zip bomb guard).
const MAX_XML_BYTES = 50 * 1024 * 1024;

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

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function docxText(buf) {
  const files = unzipSync(new Uint8Array(buf), {
    filter: (f) => f.name === 'word/document.xml' && f.originalSize <= MAX_XML_BYTES,
  });
  const xml = files['word/document.xml'];
  if (!xml) throw new Error('no document.xml');
  return new TextDecoder()
    .decode(xml)
    .replace(/<w:tab\s*\/>/g, '\t')
    .replace(/<w:(?:br|cr)\s*\/>|<\/w:p>/g, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&(?:#(\d+)|#x([0-9a-f]+)|(amp|lt|gt|quot|apos));/gi, (_, d, h, n) =>
      n ? ENTITIES[n.toLowerCase()] : String.fromCodePoint(d ? +d : parseInt(h, 16)),
    );
}

async function extract(tipo, buf) {
  if (tipo === 'pdf') {
    const { text } = await extractText(new Uint8Array(buf), { mergePages: true });
    return text;
  }
  if (tipo === 'docx') return docxText(buf);
  return utf8.decode(buf);
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
    // ponytail: no decompression cap for DOCX beyond the 20 MB input cap and the
    // declared size of document.xml; stream with a hard limit if inputs become untrusted at scale.
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
