// Copia local del registro de IPS (datos.gov.co, s2ru-bqt6) que usa buscar_sedes
// cuando la API falla. La API sigue siendo la fuente principal.
// Regenerar desde web/:
//   node --env-file-if-exists=../.env scripts/snapshot-ips.mjs
// Escribe server/data/ips-snapshot.json.gz: un arreglo JSON cuya primera fila son
// los nombres de columna y las demas son los valores. Solo columnas de la lista
// blanca COLUMNS de ips.mjs (nunca gerente ni email).
import { writeFileSync, mkdirSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { COLUMNS } from '../server/ips.mjs';

const BASE = 'https://www.datos.gov.co/resource/s2ru-bqt6.json';
const PAGE = 10000;
const token = process.env.DATOSGOV_APP_TOKEN;

async function getPage(offset) {
  const url = `${BASE}?$select=${COLUMNS.join(',')}&$order=:id&$limit=${PAGE}&$offset=${offset}`;
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { headers: token ? { 'X-App-Token': token } : {}, signal: AbortSignal.timeout(60000) })
      .catch((e) => ({ ok: false, status: 0, e }));
    if (res.ok) return res.json();
    if ((res.status && res.status < 500) || attempt === 4) throw new Error(`datos.gov.co ${res.status} at offset ${offset}`);
    await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
  }
}

const rows = [COLUMNS];
for (let offset = 0; ; offset += PAGE) {
  const page = await getPage(offset);
  for (const r of page) rows.push(COLUMNS.map((c) => r[c] ?? null));
  console.log(`offset ${offset}: ${page.length}`);
  if (page.length < PAGE) break;
}
mkdirSync(new URL('../server/data/', import.meta.url), { recursive: true });
const gz = gzipSync(JSON.stringify(rows), { level: 9 });
writeFileSync(new URL('../server/data/ips-snapshot.json.gz', import.meta.url), gz);
console.log(`${rows.length - 1} rows, ${gz.length} bytes`);
