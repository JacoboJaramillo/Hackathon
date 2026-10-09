import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePhone, validateArgs, buildParams, createWhatsApp, TEMPLATE } from './whatsapp.mjs';
import { buildSettings } from './agent-settings.mjs';

const LAST = {
  alcance: 'municipio',
  municipio: 'Leticia',
  departamento: 'Amazonas',
  sedes: [
    { sede: 'Hospital San Rafael', direccion: 'Cra 10\n# 13-78', telefono: '6085927826' },
    { sede: null, prestador: 'IPS Sur', direccion: 'Calle 8 # 9-12', telefono: null },
    { sede: 'Centro C', direccion: null, telefono: '3001112233' },
    { sede: 'Centro D', direccion: 'Cra 1', telefono: null },
  ],
};

function fakeMeta(status = 200, body = { messages: [{ id: 'wamid.x' }] }) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    return { ok: status === 200, status, json: async () => body };
  };
  return { calls, fetchImpl };
}

test('RF-024 only Colombian mobiles are accepted', () => {
  assert.equal(normalizePhone('300 123 4567'), '573001234567');
  assert.equal(normalizePhone('+57 (300) 123-4567'), '573001234567');
  assert.equal(normalizePhone('573001234567'), '573001234567');
  for (const bad of ['6041234567', '30012345', '30012345678', '+1 300 123 4567', '', 'tres cero cero', 42, null]) {
    assert.equal(normalizePhone(bad), null, String(bad));
  }
});

test('RF-024 the message is built from the registry result, flattened for Meta', () => {
  const [lugar, lista] = buildParams(LAST, [1, 2]);
  assert.equal(lugar, 'Leticia, Amazonas');
  assert.equal(lista, '1) Hospital San Rafael, Cra 10 # 13-78, tel 6085927826. 2) IPS Sur, Calle 8 # 9-12.');
  assert.doesNotMatch(lista, /[\n\t]| {2}/);
  assert.equal(buildParams({ ...LAST, alcance: 'departamento' }, [3])[0], 'Amazonas');
});

test('RF-024 arguments are validated against the last search', () => {
  assert.equal(validateArgs('{bad', LAST).error, 'parametros_invalidos');
  assert.equal(validateArgs({ telefono: '3001234567', sedes: [1], texto: 'premio' }, LAST).error, 'parametros_invalidos');
  assert.equal(validateArgs({ telefono: '123', sedes: [1] }, LAST).error, 'telefono_invalido');
  assert.equal(validateArgs({ telefono: '3001234567', sedes: [1] }, null).error, 'sin_busqueda');
  assert.equal(validateArgs({ telefono: '3001234567', sedes: [1, 2, 3, 4] }, LAST).error, 'sedes_invalidas');
  assert.equal(validateArgs({ telefono: '3001234567', sedes: [9] }, LAST).error, 'sedes_invalidas');
  assert.equal(validateArgs({ telefono: '3001234567', sedes: [] }, LAST).error, 'sedes_invalidas');
  const ok = validateArgs(JSON.stringify({ telefono: '300 123 4567', sedes: [2, 2] }), LAST);
  assert.equal(ok.to, '573001234567');
  assert.equal(ok.params[1], '1) IPS Sur, Calle 8 # 9-12.');
});

test('RF-024 sends the approved template with the token only in the header', async () => {
  const meta = fakeMeta();
  const wa = createWhatsApp({ token: 'secret-token', phoneNumberId: '111', fetchImpl: meta.fetchImpl });
  assert.deepEqual(await wa.send({ ipKey: 'ip1', to: '573001234567', params: ['Leticia', 'lista'] }), { enviado: true });
  const [c] = meta.calls;
  assert.equal(c.url, 'https://graph.facebook.com/v25.0/111/messages');
  assert.equal(c.init.headers.Authorization, 'Bearer secret-token');
  assert.equal(c.body.template.name, TEMPLATE.name);
  assert.deepEqual(c.body.template.components[0].parameters, [{ type: 'text', text: 'Leticia' }, { type: 'text', text: 'lista' }]);
  assert.doesNotMatch(c.init.body, /secret-token/);
});

test('RF-024 one message per IP and per number every 10 minutes, 3 per hour overall', async () => {
  let t = 0;
  const meta = fakeMeta();
  const logs = [];
  const wa = createWhatsApp({ token: 't', phoneNumberId: '1', fetchImpl: meta.fetchImpl, now: () => t, log: (e, f) => logs.push({ e, ...f }) });
  const send = (ipKey, to) => wa.send({ ipKey, to, params: ['a', 'b'] });
  assert.equal((await send('A', '573000000001')).enviado, true);
  assert.equal((await send('A', '573000000002')).error, 'limite_alcanzado');
  assert.equal((await send('B', '573000000001')).error, 'limite_alcanzado');
  assert.equal((await send('B', '573000000002')).enviado, true);
  assert.equal((await send('C', '573000000003')).enviado, true);
  assert.equal((await send('D', '573000000004')).error, 'limite_global');
  t = 10 * 60_000;
  assert.equal((await send('A', '573000000001')).error, 'limite_global');
  t = 60 * 60_000;
  assert.equal((await send('A', '573000000001')).enviado, true);
  assert.equal(meta.calls.length, 4);
  assert.ok(logs.every((l) => !JSON.stringify(l).includes('573000000001')), 'number never logged');
});

test('RF-024 Meta errors and timeouts return no_disponible and still count', async () => {
  const meta = fakeMeta(400, { error: { code: 132001 } });
  const wa = createWhatsApp({ token: 't', phoneNumberId: '1', fetchImpl: meta.fetchImpl });
  assert.equal((await wa.send({ ipKey: 'A', to: '573000000001', params: ['a', 'b'] })).error, 'no_disponible');
  assert.equal((await wa.send({ ipKey: 'A', to: '573000000001', params: ['a', 'b'] })).error, 'limite_alcanzado');
  const down = createWhatsApp({ token: 't', phoneNumberId: '1', fetchImpl: async () => { throw new Error('net'); } });
  assert.equal((await down.send({ ipKey: 'A', to: '573000000001', params: ['a', 'b'] })).error, 'no_disponible');
});

test('RF-024 the agent offers WhatsApp only when it is configured', () => {
  const off = buildSettings({ deepseekKey: 'k' }).agent.think;
  const on = buildSettings({ deepseekKey: 'k', whatsapp: true }).agent.think;
  assert.deepEqual(off.functions.map((f) => f.name), ['buscar_sedes']);
  assert.doesNotMatch(off.prompt, /WhatsApp/);
  assert.deepEqual(on.functions.map((f) => f.name), ['buscar_sedes', 'enviar_whatsapp']);
  assert.match(on.prompt, /oferta_whatsapp/);
});
