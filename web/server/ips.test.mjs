import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  NEEDS, TOOL_DEFINITION, validateArgs, normalize, resolveMunicipio, soqlString,
  loadMunicipios, buscarSedes, _resetCache,
} from './ips.mjs';

const LIST = [
  { municipio: 'LETICIA', departamento: 'AMAZONAS' },
  { municipio: 'MEDELLÍN', departamento: 'ANTIOQUIA' },
  { municipio: 'CÚCUTA', departamento: 'NORTE DE SANTANDER' },
  { municipio: 'IBAGUÉ', departamento: 'TOLIMA' },
  { municipio: 'CALI', departamento: 'CALI' },
  { municipio: "SAN JOSE D'ARC", departamento: 'BOYACA' },
  { municipio: 'SANTA ROSA', departamento: 'CAUCA' },
  { municipio: 'SANTA ROSA', departamento: 'RISARALDA' },
];

beforeEach(() => _resetCache());

// Fake SODA server: municipio list, then rows from `rowsFor(where)`.
function fakeFetch(rowsFor) {
  const urls = [];
  const impl = async (url) => {
    urls.push(decodeURIComponent(url));
    const u = new URL(url);
    if (u.searchParams.get('$group')) return { ok: true, json: async () => LIST };
    const where = u.searchParams.get('$where');
    const offset = Number(u.searchParams.get('$offset'));
    return { ok: true, json: async () => rowsFor(where, offset) };
  };
  impl.urls = urls;
  return impl;
}

const row = (code, tipo, n, extra = {}) => ({
  c_digo_sede: code, nom_sede_ips: `Sede ${code}`, nombre_prestador: 'P', direcci_n: 'Cra 1', tel_fono: '123',
  naturaleza: 'Pública', num_nivel_atencion: '', nom_descripcion_capacidad: tipo,
  num_cantidad_capacidad_instalada: String(n), ...extra,
});

test('RF-010 NEEDS has the contract keys and the tool enum matches', () => {
  assert.deepEqual(Object.keys(NEEDS), [
    'consulta_general', 'urgencias', 'partos', 'neonatal', 'pediatria', 'uci_adultos', 'hospitalizacion',
    'cirugia', 'dialisis', 'cancer', 'quemados', 'salud_mental', 'adicciones', 'ambulancia', 'unidad_movil',
  ]);
  assert.deepEqual(TOOL_DEFINITION.parameters.properties.necesidad.enum, Object.keys(NEEDS));
});

test('RF-010 validateArgs accepts string and object, trims', () => {
  const r = validateArgs('{"necesidad":"partos","municipio":"  Leticia "}');
  assert.deepEqual(r, { ok: true, value: { necesidad: 'partos', municipio: 'Leticia' } });
  assert.equal(validateArgs({ necesidad: 'cirugia', municipio: 'X', naturaleza: 'Mixta', departamento: 'Y' }).ok, true);
});

test('RF-010 validateArgs rejects bad input', () => {
  const bad = [
    'not json', '[]', '{"necesidad":"partos"}', { necesidad: 'nope', municipio: 'x' },
    { necesidad: 'partos', municipio: 'x', extra: 1 }, { necesidad: 'partos', municipio: 5 },
    { necesidad: 'partos', municipio: 'x'.repeat(61) }, { necesidad: 'partos', municipio: 'a\u0000b' },
    { necesidad: 'partos', municipio: 'x', naturaleza: 'Otra' }, { necesidad: 'partos', municipio: '  ' },
  ];
  for (const b of bad) assert.equal(validateArgs(b).ok, false, JSON.stringify(b));
});

test('RF-011 normalize strips accents, case and whitespace', () => {
  assert.equal(normalize('  Medellín   de  Ñu '), 'MEDELLIN DE NU');
});

test('RF-011 resolveMunicipio fuzzy matches', () => {
  for (const [input, want] of [['Letizia', 'LETICIA'], ['medellin', 'MEDELLÍN'], ['Cucuta', 'CÚCUTA'], ['Ibague', 'IBAGUÉ']]) {
    assert.equal(resolveMunicipio(input, LIST).match.municipio, want);
  }
  assert.equal(resolveMunicipio('Leticia', LIST).score, 1);
});

test('RF-011 resolveMunicipio returns suggestions for nonsense', () => {
  const r = resolveMunicipio('Zzzzxqwk', LIST);
  assert.equal(r.match, null);
  assert.ok(r.suggestions.length >= 1 && r.suggestions.length <= 3);
});

test('RF-011 resolveMunicipio uses departamento only as tie-break', () => {
  assert.equal(resolveMunicipio('Santa Rosa', LIST, 'Risaralda').match.departamento, 'RISARALDA');
  assert.equal(resolveMunicipio('Leticia', LIST, 'Antioquia').match.municipio, 'LETICIA');
});

test('RNF-004 soqlString doubles quotes', () => {
  assert.equal(soqlString("D'ARC"), "'D''ARC'");
});

test('RNF-004 official name with a quote is escaped in the query', async () => {
  const f = fakeFetch(() => []);
  await buscarSedes({ necesidad: 'partos', municipio: "San Jose D'Arc" }, { fetchImpl: f });
  assert.ok(f.urls.some((u) => u.includes("municipio='SAN JOSE D''ARC'")));
});

test('RF-009 loadMunicipios caches success only', async () => {
  let calls = 0;
  const failing = async () => { calls++; return { ok: false, status: 500 }; };
  await assert.rejects(loadMunicipios({ fetchImpl: failing }));
  const good = async () => { calls++; return { ok: true, json: async () => LIST }; };
  await loadMunicipios({ fetchImpl: good });
  await loadMunicipios({ fetchImpl: good });
  assert.equal(calls, 3, "the 500 is retried once, then the good list is cached");
});

test('RF-013 RF-019 aggregates by sede, sorts by capacity, caps at 20, hides personal data', async () => {
  const rows = [];
  for (let i = 1; i <= 25; i++) {
    rows.push(row(`S${i}`, 'Partos', i, { gerente: 'Ana', email: 'a@b.co' }));
    rows.push(row(`S${i}`, 'Obstetricia', 1, { gerente: 'Ana', email: 'a@b.co' }));
  }
  const f = fakeFetch(() => rows);
  const r = await buscarSedes({ necesidad: 'partos', municipio: 'Leticia' }, { fetchImpl: f });
  assert.equal(r.alcance, 'municipio');
  assert.equal(r.total_sedes, 25);
  assert.equal(r.sedes.length, 20);
  assert.equal(r.sedes[0].sede, 'Sede S25');
  assert.deepEqual(r.sedes[0].capacidades, [{ tipo: 'Partos', cantidad: 25 }, { tipo: 'Obstetricia', cantidad: 1 }]);
  assert.equal(r.sedes[0].nivel, null);
  const out = JSON.stringify(r);
  assert.ok(!/gerente|email|Ana|a@b\.co/.test(out));
  assert.ok(f.urls.every((u) => !/gerente|email/.test(u)));
});

test('RF-012 falls back to departamento when municipio has no sedes', async () => {
  const f = fakeFetch((where) => (where.includes('municipio=') ? [] : [row('D1', 'Sillas de Hemodiálisis', 4, { naturaleza: 'Privada', num_nivel_atencion: '2' })]));
  const r = await buscarSedes({ necesidad: 'dialisis', municipio: 'Leticia', naturaleza: 'Privada' }, { fetchImpl: f });
  assert.equal(r.alcance, 'departamento');
  assert.equal(r.sedes[0].nivel, 2);
  assert.ok(f.urls.some((u) => u.includes("naturaleza='Privada'")));
});

test('RF-010 ambulancia restricts by group', async () => {
  const f = fakeFetch(() => []);
  await buscarSedes({ necesidad: 'ambulancia', municipio: 'Leticia' }, { fetchImpl: f });
  assert.ok(f.urls.some((u) => u.includes("nom_grupo_capacidad='AMBULANCIAS'")));
});

test('RNF-004 query URL never contains raw user text', async () => {
  const f = fakeFetch(() => []);
  await buscarSedes({ necesidad: 'partos', municipio: "Letizia' OR 1=1 --" }, { fetchImpl: f });
  assert.ok(f.urls.every((u) => !u.includes('Letizia') && !u.includes('OR 1=1')));
});

test('RF-009 errors map to contract codes', async () => {
  assert.deepEqual(await buscarSedes({ necesidad: 'x', municipio: 'y' }, { fetchImpl: fakeFetch(() => []) }), { error: 'parametros_invalidos' });
  const none = await buscarSedes({ necesidad: 'partos', municipio: 'Zzzzxqwk' }, { fetchImpl: fakeFetch(() => []) });
  assert.equal(none.error, 'municipio_no_encontrado');
  assert.ok(none.sugerencias.length > 0);
  const origErr = console.error;
  console.error = () => {};
  const down = await buscarSedes({ necesidad: 'partos', municipio: 'Leticia' }, { token: 'SECRET', fetchImpl: async () => { throw new Error('boom'); } });
  console.error = origErr;
  assert.deepEqual(down, { error: 'servicio_no_disponible' });
});

const live = process.env.LIVE === '1';

test('RF-009 live: partos in Letizia', { skip: !live }, async () => {
  const r = await buscarSedes({ necesidad: 'partos', municipio: 'Letizia' }, {});
  console.log('live partos', r.alcance, r.municipio, r.total_sedes);
  assert.equal(r.alcance, 'municipio');
  assert.equal(r.municipio, 'LETICIA');
  assert.ok(r.total_sedes >= 1);
});

test('RF-009 live: dialisis in Medellin', { skip: !live }, async () => {
  const r = await buscarSedes({ necesidad: 'dialisis', municipio: 'Medellin' }, {});
  console.log('live dialisis', r.alcance, r.municipio, r.total_sedes);
  assert.equal(r.municipio, 'MEDELLÍN');
  assert.ok(r.total_sedes >= 1);
});

test('RF-009 a 5xx is retried once and successful queries are cached', async () => {
  _resetCache();
  let calls = 0;
  const fetchImpl = async (url) => {
    calls++;
    if (url.includes('$select=municipio')) return { ok: true, status: 200, json: async () => [{ municipio: 'LETICIA', departamento: 'AMAZONAS' }] };
    if (calls === 2) return { ok: false, status: 503, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => [] };
  };
  await buscarSedes({ necesidad: 'urgencias', municipio: 'Leticia' }, { fetchImpl });
  const afterFirst = calls;
  await buscarSedes({ necesidad: 'urgencias', municipio: 'Leticia' }, { fetchImpl });
  assert.equal(calls, afterFirst, 'second identical search served from cache');
  _resetCache();
});
