import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zipSync, strToU8 } from 'fflate';
import {
  MAX_BYTES,
  MAX_CHARS,
  detectType,
  parseDocument,
  createDocumentStore,
} from './documents.mjs';

function makePdf(content) {
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 100] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offs = [];
  objs.forEach((o, i) => {
    offs.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const o of offs) out += `${String(o).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

const docx = (paras) =>
  Buffer.from(
    zipSync({
      '[Content_Types].xml': strToU8('<Types/>'),
      'word/document.xml': strToU8(
        `<w:document><w:body>${paras.map((p) => `<w:p><w:r><w:t>${p}</w:t></w:r></w:p>`).join('')}</w:body></w:document>`,
      ),
    }),
  );

test('RF-001 detectType recognizes pdf, docx and txt', () => {
  assert.equal(detectType(Buffer.from('%PDF-1.7 x')), 'pdf');
  assert.equal(detectType(docx(['hola'])), 'docx');
  assert.equal(detectType(Buffer.from('hola ñandú')), 'txt');
  assert.equal(detectType(Buffer.from('﻿hola')), 'txt');
});

test('RF-001 detectType rejects png, non-docx zip, invalid utf8 and NUL bytes', () => {
  assert.equal(detectType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), null);
  assert.equal(detectType(Buffer.from(zipSync({ 'a.txt': strToU8('x') }))), null);
  assert.equal(detectType(Buffer.from([0xff, 0xfe, 0xfa])), null);
  assert.equal(detectType(Buffer.from('ab\0cd')), null);
});

test('RF-001 parseDocument empty -> 400 vacio', async () => {
  const r = await parseDocument(Buffer.alloc(0));
  assert.deepEqual([r.ok, r.status, r.error], [false, 400, 'vacio']);
});

test('RF-001 parseDocument oversized -> 413 demasiado_grande', async () => {
  const r = await parseDocument(Buffer.alloc(MAX_BYTES + 1, 97));
  assert.deepEqual([r.ok, r.status, r.error], [false, 413, 'demasiado_grande']);
});

test('RF-001 parseDocument unknown type and corrupt files -> 415', async () => {
  const bad = [
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0]),
    Buffer.from('%PDF-garbage\x01\x02 no structure'),
    Buffer.from('PK\x03\x04word/document.xml junk'),
  ];
  for (const b of bad) {
    const r = await parseDocument(b);
    assert.deepEqual([r.ok, r.status, r.error], [false, 415, 'tipo_no_soportado']);
    assert.ok(!r.mensaje.includes('garbage'));
  }
});

test('RF-001 parseDocument extracts text from a valid pdf', async () => {
  const r = await parseDocument(makePdf('BT /F1 18 Tf 20 50 Td (Hola mundo IPS) Tj ET'));
  assert.equal(r.ok, true);
  assert.equal(r.tipo, 'pdf');
  assert.match(r.text, /Hola mundo IPS/);
  assert.equal(r.caracteres, r.text.length);
  assert.equal(r.truncado, false);
});

test('RF-001 parseDocument pdf without text -> 422 sin_texto', async () => {
  const r = await parseDocument(makePdf('0 0 10 10 re f'));
  assert.deepEqual([r.ok, r.status, r.error], [false, 422, 'sin_texto']);
});

test('RF-001 parseDocument extracts text from a docx', async () => {
  const r = await parseDocument(docx(['Primer &amp; parrafo', 'Segundo']));
  assert.equal(r.ok, true);
  assert.equal(r.tipo, 'docx');
  assert.equal(r.text, 'Primer & parrafo\nSegundo');
});

test('RF-001 parseDocument txt with BOM and normalization', async () => {
  const r = await parseDocument(Buffer.from('﻿  a \t\t b\r\n\n\n\n\nc  '));
  assert.equal(r.ok, true);
  assert.equal(r.text, 'a b\n\nc');
});

test('RF-001 parseDocument whitespace-only txt -> 422', async () => {
  const r = await parseDocument(Buffer.from(' \n\t '));
  assert.equal(r.status, 422);
});

test('RF-001 parseDocument truncates over MAX_CHARS', async () => {
  const r = await parseDocument(Buffer.from('x'.repeat(MAX_CHARS + 500)));
  assert.equal(r.ok, true);
  assert.equal(r.truncado, true);
  assert.equal(r.caracteres, MAX_CHARS);
});

test('RF-003 store put/get returns the same record', () => {
  const s = createDocumentStore();
  const rec = { text: 'hola' };
  const id = s.put(rec);
  assert.equal(s.get(id), rec);
  assert.equal(s.size(), 1);
});

test('RF-003 store expires entries by injected clock', () => {
  let t = 1000;
  const s = createDocumentStore({ ttlMs: 100, now: () => t });
  const id = s.put({});
  t += 99;
  assert.ok(s.get(id));
  t += 1;
  assert.equal(s.get(id), null);
  assert.equal(s.size(), 0);
});

test('RF-003 store evicts expired then oldest at max', () => {
  let t = 0;
  const s = createDocumentStore({ ttlMs: 100, max: 2, now: () => t });
  const a = s.put({ n: 1 });
  t = 10;
  const b = s.put({ n: 2 });
  t = 20;
  const c = s.put({ n: 3 });
  assert.equal(s.get(a), null);
  assert.ok(s.get(b) && s.get(c));
  t = 500;
  s.put({ n: 4 });
  assert.equal(s.size(), 1);
});

test('RF-003 store rejects non-uuid ids', () => {
  const s = createDocumentStore();
  s.put({});
  const ids = [undefined, null, 5, {}, '', 'abc', '../etc/passwd', '00000000-0000-0000-0000-00000000000g'];
  for (const id of ids) assert.equal(s.get(id), null);
});
