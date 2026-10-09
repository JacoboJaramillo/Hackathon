import { parentPort, workerData } from 'node:worker_threads';
import { unzipSync } from 'fflate';
import { extractText } from 'unpdf';

// Declared uncompressed size allowed for word/document.xml (zip bomb guard).
const MAX_XML_BYTES = 8 * 1024 * 1024;
// 20 000 characters of text never needs more markup than this.
const XML_HEAD_BYTES = 2 * 1024 * 1024;

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function docxText(buf) {
  const files = unzipSync(buf, {
    filter: (f) => f.name === 'word/document.xml' && f.originalSize <= MAX_XML_BYTES,
  });
  const xml = files['word/document.xml'];
  if (!xml) throw new Error('no document.xml');
  return new TextDecoder()
    .decode(xml.subarray(0, XML_HEAD_BYTES))
    .replace(/<w:tab\s*\/>/g, '\t')
    .replace(/<w:(?:br|cr)\s*\/>|<\/w:p>/g, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&(?:#(\d+)|#x([0-9a-f]+)|(amp|lt|gt|quot|apos));/gi, (_, d, h, n) =>
      n ? ENTITIES[n.toLowerCase()] : String.fromCodePoint(d ? +d : parseInt(h, 16)),
    );
}

try {
  const { tipo, buf } = workerData;
  if (tipo === 'pdf') {
    const { text } = await extractText(buf, { mergePages: true });
    parentPort.postMessage({ text });
  } else {
    parentPort.postMessage({ text: docxText(buf) });
  }
} catch (e) {
  parentPort.postMessage({ error: String(e?.message ?? e) });
}
