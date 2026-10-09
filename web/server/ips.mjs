// Tool backend for buscar_sedes over the datos.gov.co IPS registry (s2ru-bqt6).
// Contract: docs/adr/0001-mision-del-agente.md. The model never writes queries:
// SoQL literals come only from the official municipio list and the enums below.

const BASE = 'https://www.datos.gov.co/resource/s2ru-bqt6.json';
const PAGE = 1000;
const ROW_CAP = 5000;
const MAX_SEDES = 20;
const MAX_STR = 60;

// gerente and email are personal data and must never be selected.
const COLUMNS = [
  'departamento', 'municipio', 'c_digo_sede', 'nom_sede_ips', 'nombre_prestador',
  'naturaleza', 'num_nivel_atencion', 'direcci_n', 'tel_fono',
  'nom_grupo_capacidad', 'nom_descripcion_capacidad', 'num_cantidad_capacidad_instalada',
];

export const NEEDS = {
  consulta_general: ['Consulta Externa'],
  urgencias: ['Urgencias', 'Observación Adultos Mujeres', 'Observación Adultos Hombres', 'Observación Pediátrica'],
  partos: ['Partos', 'TPR', 'Atención del Parto', 'Obstetricia'],
  neonatal: [
    'Incubadora Intensiva Neonatal', 'Incubadora Intermedia Neonatal', 'Incubadora Básico Neonatal',
    'Cuna Básico Neonatal', 'Cuna Intermedia Neonatal', 'Cuna Intensiva Neonatal',
    'Cuidado Intensivo Neonatal', 'Cuidado Intermedio Neonatal', 'Cuidado básico neonatal',
  ],
  pediatria: [
    'Pediátrica', 'Intensiva Pediátrica', 'Intermedia Pediátrica', 'Cuidado Intensivo Pediátrico',
    'Cuidado Intermedio Pediátrico', 'Cuna Intermedia Pediátrica', 'Cuna Intensiva Pediátrica',
  ],
  uci_adultos: ['Intensiva Adultos', 'Cuidado Intensivo Adulto', 'Intermedia Adultos', 'Cuidado Intermedio Adulto'],
  hospitalizacion: ['Adultos'],
  cirugia: ['Sala de Cirugía', 'Quirófano'],
  dialisis: ['Sillas de Hemodiálisis'],
  cancer: ['Sillas de Quimioterapia', 'Sala de Radioterapia', 'Transplante de progenitores hematopoyeticos'],
  quemados: ['Unidad de Quemados Adulto', 'Unidad de Quemados Pediátrico', 'Intensiva Quemado Adulto', 'Intensiva Quemado pediátrica'],
  salud_mental: ['Salud Mental', 'Salud Mental Adulto', 'Salud Mental Pediátrico', 'Psiquiatría', 'Cuidado Agudo Mental'],
  adicciones: ['SPA', 'SPA Básico Adultos', 'SPA Adultos', 'SPA Pediátricas', 'SPA Básico Pediátricos', 'Farmacodependencia'],
  ambulancia: ['Básica', 'Medicalizada'],
  unidad_movil: ['Unidad Móvil'],
};

// 'Básica' alone is ambiguous across groups, so these needs also filter by group.
export const NEED_GROUPS = { ambulancia: 'AMBULANCIAS' };

const NATURALEZAS = ['Pública', 'Privada', 'Mixta'];

export const TOOL_DEFINITION = {
  name: 'buscar_sedes',
  description:
    'Busca en el registro oficial de IPS las sedes de salud de un municipio que ofrecen un tipo de atención. ' +
    'Úsala cuando la persona pregunte dónde atenderse. Devuelve hasta 20 sedes con dirección, teléfono, naturaleza y capacidad. ' +
    'No tiene especialidades, EPS, horarios ni cupos.',
  parameters: {
    type: 'object',
    properties: {
      necesidad: {
        type: 'string',
        enum: Object.keys(NEEDS),
        description: 'Tipo de atención que busca la persona.',
      },
      municipio: { type: 'string', description: 'Municipio donde busca atención, como lo dijo la persona.' },
      departamento: { type: 'string', description: 'Solo si el nombre del municipio es ambiguo.' },
      naturaleza: { type: 'string', enum: NATURALEZAS, description: 'Solo si la persona pide pública, privada o mixta.' },
    },
    required: ['necesidad', 'municipio'],
  },
};

const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

export function validateArgs(raw) {
  let obj = raw;
  if (typeof raw === 'string') {
    try { obj = JSON.parse(raw); } catch { return { ok: false, error: 'JSON invalido' }; }
  }
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return { ok: false, error: 'se esperaba un objeto' };
  const allowed = ['necesidad', 'municipio', 'departamento', 'naturaleza'];
  for (const k of Object.keys(obj)) if (!allowed.includes(k)) return { ok: false, error: `campo desconocido: ${k}` };

  const value = {};
  for (const k of allowed) {
    if (obj[k] === undefined || obj[k] === null) continue;
    if (typeof obj[k] !== 'string') return { ok: false, error: `${k} debe ser texto` };
    const s = obj[k].trim();
    if (s.length > MAX_STR) return { ok: false, error: `${k} demasiado largo` };
    if (CONTROL.test(s)) return { ok: false, error: `${k} con caracteres de control` };
    if (s === '' && (k === 'departamento' || k === 'naturaleza')) continue;
    value[k] = s;
  }
  if (!value.necesidad || !Object.hasOwn(NEEDS, value.necesidad)) return { ok: false, error: 'necesidad invalida' };
  if (!value.municipio) return { ok: false, error: 'municipio requerido' };
  if (value.naturaleza && !NATURALEZAS.includes(value.naturaleza)) return { ok: false, error: 'naturaleza invalida' };
  return { ok: true, value };
}

export function normalize(s) {
  return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
}

function levenshtein(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

export function resolveMunicipio(name, list, departamento) {
  const target = normalize(name);
  const dep = departamento ? normalize(departamento) : null;
  const scored = list.map((e) => ({ e, d: levenshtein(target, normalize(e.municipio)) }));
  const best = Math.min(...scored.map((x) => x.d));
  const limit = Math.max(1, Math.floor(target.length / 4));
  if (scored.length && best <= limit) {
    const ties = scored.filter((x) => x.d === best);
    // The department only breaks ties: city-districts (Cali, etc.) carry a different departamento value.
    const pick = (dep && ties.find((x) => normalize(x.e.departamento) === dep)) || ties[0];
    return { match: { municipio: pick.e.municipio, departamento: pick.e.departamento }, score: best === 0 ? 1 : 1 - best / Math.max(target.length, 1) };
  }
  const names = [];
  for (const x of [...scored].sort((a, b) => a.d - b.d)) {
    if (!names.includes(x.e.municipio)) names.push(x.e.municipio);
    if (names.length === 3) break;
  }
  return { match: null, suggestions: names };
}

export function soqlString(s) {
  return `'${String(s).replaceAll("'", "''")}'`;
}

// datos.gov.co answers intermittent 5xx; one quick retry covers most of them.
async function getJson(url, token, fetchImpl, retries = 1) {
  const res = await fetchImpl(url, {
    headers: token ? { 'X-App-Token': token } : {},
    signal: AbortSignal.timeout(8000),
  });
  if (res.status >= 500 && retries > 0) return getJson(url, token, fetchImpl, retries - 1);
  if (!res.ok) throw new Error(`datos.gov.co ${res.status}`);
  return res.json();
}

const q = (params) => '?' + Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');

let municipiosPromise = null;

export function loadMunicipios({ token, fetchImpl = fetch } = {}) {
  if (!municipiosPromise) {
    const p = getJson(
      BASE + q({ $select: 'municipio,departamento', $group: 'municipio,departamento', $limit: '5000' }),
      token, fetchImpl,
    ).then((rows) => rows.filter((r) => r.municipio && r.departamento).map((r) => ({ municipio: r.municipio, departamento: r.departamento })));
    municipiosPromise = p;
    p.catch(() => { if (municipiosPromise === p) municipiosPromise = null; });
  }
  return municipiosPromise;
}

// Test hook: the cache is module-level by contract.
// ponytail: the registry is a static snapshot, so successful queries are kept
// for the life of the instance (bounded by count); move to Redis if instances grow.
const rowsCache = new Map();
const ROWS_CACHE_MAX = 500;

export function _resetCache() { municipiosPromise = null; rowsCache.clear(); }

async function fetchRows(conds, token, fetchImpl) {
  const key = conds.join(' AND ');
  if (rowsCache.has(key)) return rowsCache.get(key);
  const rows = await fetchRowsUncached(conds, token, fetchImpl);
  if (rowsCache.size >= ROWS_CACHE_MAX) rowsCache.delete(rowsCache.keys().next().value);
  rowsCache.set(key, rows);
  return rows;
}

async function fetchRowsUncached(conds, token, fetchImpl) {
  const rows = [];
  for (let offset = 0; offset < ROW_CAP; offset += PAGE) {
    const page = await getJson(
      BASE + q({ $select: COLUMNS.join(','), $where: conds.join(' AND '), $order: 'c_digo_sede', $limit: String(PAGE), $offset: String(offset) }),
      token, fetchImpl,
    );
    rows.push(...page);
    if (page.length < PAGE) break;
  }
  return rows;
}

function aggregate(rows) {
  const by = new Map();
  for (const r of rows) {
    const key = r.c_digo_sede ?? `${r.nom_sede_ips}|${r.direcci_n}`;
    let s = by.get(key);
    if (!s) {
      const nivel = Number(r.num_nivel_atencion);
      s = {
        sede: r.nom_sede_ips ?? null, prestador: r.nombre_prestador ?? null, direccion: r.direcci_n ?? null,
        telefono: r.tel_fono ?? null, naturaleza: r.naturaleza ?? null,
        nivel: r.num_nivel_atencion && Number.isFinite(nivel) ? nivel : null,
        capacidades: [], total: 0,
      };
      by.set(key, s);
    }
    const cantidad = Number(r.num_cantidad_capacidad_instalada) || 0;
    const tipo = r.nom_descripcion_capacidad;
    const cap = s.capacidades.find((c) => c.tipo === tipo);
    if (cap) cap.cantidad += cantidad; else s.capacidades.push({ tipo, cantidad });
    s.total += cantidad;
  }
  return [...by.values()].sort((a, b) => b.total - a.total);
}

export async function buscarSedes(args, { token, fetchImpl = fetch } = {}) {
  const v = validateArgs(args);
  if (!v.ok) return { error: 'parametros_invalidos' };
  const { necesidad, municipio, departamento, naturaleza } = v.value;

  try {
    const list = await loadMunicipios({ token, fetchImpl });
    const r = resolveMunicipio(municipio, list, departamento);
    if (!r.match) return { error: 'municipio_no_encontrado', sugerencias: r.suggestions };

    const base = [`nom_descripcion_capacidad in (${NEEDS[necesidad].map(soqlString).join(',')})`];
    if (NEED_GROUPS[necesidad]) base.push(`nom_grupo_capacidad=${soqlString(NEED_GROUPS[necesidad])}`);
    if (naturaleza) base.push(`naturaleza=${soqlString(naturaleza)}`);
    const depCond = `departamento=${soqlString(r.match.departamento)}`;

    let alcance = 'municipio';
    let sedes = aggregate(await fetchRows([...base, depCond, `municipio=${soqlString(r.match.municipio)}`], token, fetchImpl));
    if (sedes.length === 0) {
      alcance = 'departamento';
      sedes = aggregate(await fetchRows([...base, depCond], token, fetchImpl));
    }
    return {
      alcance,
      municipio: r.match.municipio,
      departamento: r.match.departamento,
      necesidad,
      total_sedes: sedes.length,
      sedes: sedes.slice(0, MAX_SEDES).map(({ total, ...s }) => s),
    };
  } catch (e) {
    console.error('buscar_sedes failed:', e.message);
    return { error: 'servicio_no_disponible' };
  }
}
