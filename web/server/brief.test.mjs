import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateBrief } from './brief.mjs';

const qs = (n) => Array.from({ length: n }, (_, i) => `Pregunta ${i + 1}?`);

function fakeFetch(content, { status = 200, calls = [] } = {}) {
  return async (url, init) => {
    calls.push({ url, init });
    return new Response(
      JSON.stringify({ choices: [{ message: { content: typeof content === 'string' ? content : JSON.stringify(content) } }] }),
      { status },
    );
  };
}

async function quiet(fn) {
  const orig = console.error;
  console.error = () => {};
  try {
    return await fn();
  } finally {
    console.error = orig;
  }
}

test('RF-003 happy path returns resumen and preguntas', async () => {
  const out = await generateBrief('texto', { apiKey: 'k', fetchImpl: fakeFetch({ resumen: ' Trata de salud. ', preguntas: qs(3) }) });
  assert.deepEqual(out, { resumen: 'Trata de salud.', preguntas: qs(3) });
});

test('RF-003 request shape: url, model, json mode, auth, delimiters, 12000 cap', async () => {
  const calls = [];
  await generateBrief('a'.repeat(20_000), { apiKey: 'secret', fetchImpl: fakeFetch({ resumen: 'r', preguntas: qs(3) }, { calls }) });
  const { url, init } = calls[0];
  const body = JSON.parse(init.body);
  assert.equal(url, 'https://api.deepseek.com/chat/completions');
  assert.equal(body.model, 'deepseek-chat');
  assert.deepEqual(body.response_format, { type: 'json_object' });
  assert.equal(body.temperature, 0.3);
  assert.equal(body.max_tokens, 500);
  assert.equal(init.headers.Authorization, 'Bearer secret');
  const user = body.messages.find((m) => m.role === 'user').content;
  assert.equal(user, `<documento>\n${'a'.repeat(12_000)}\n</documento>`);
  assert.match(body.messages[0].content, /json/);
});

test('RF-003 six questions are trimmed to five', async () => {
  const out = await generateBrief('t', { apiKey: 'k', fetchImpl: fakeFetch({ resumen: 'r', preguntas: qs(6) }) });
  assert.equal(out.preguntas.length, 5);
});

test('RF-003 fewer than three valid questions returns null', async () => {
  const out = await quiet(() => generateBrief('t', { apiKey: 'k', fetchImpl: fakeFetch({ resumen: 'r', preguntas: qs(2) }) }));
  assert.equal(out, null);
});

test('RF-003 non-JSON content returns null', async () => {
  assert.equal(await quiet(() => generateBrief('t', { apiKey: 'k', fetchImpl: fakeFetch('no es json') })), null);
});

test('RF-003 HTTP 500 returns null', async () => {
  assert.equal(await quiet(() => generateBrief('t', { apiKey: 'k', fetchImpl: fakeFetch({}, { status: 500 }) })), null);
});

test('RF-003 fetch rejection returns null and logs a code only', async () => {
  const logs = [];
  const orig = console.error;
  console.error = (l) => logs.push(l);
  try {
    const out = await generateBrief('t', { apiKey: 'k', fetchImpl: async () => { throw new Error('boom'); } });
    assert.equal(out, null);
  } finally {
    console.error = orig;
  }
  assert.deepEqual(JSON.parse(logs[0]), { severity: 'ERROR', event: 'brief_failed', reason: 'network' });
});

test('RF-003 timeout returns null', async () => {
  const hang = (url, { signal }) =>
    new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason)));
  assert.equal(await quiet(() => generateBrief('t', { apiKey: 'k', fetchImpl: hang, timeoutMs: 50 })), null);
});

test('RF-003 extra keys are dropped', async () => {
  const out = await generateBrief('t', { apiKey: 'k', fetchImpl: fakeFetch({ resumen: 'r', preguntas: qs(3), extra: 1 }) });
  assert.deepEqual(Object.keys(out), ['resumen', 'preguntas']);
});

test('RF-003 live DeepSeek brief', { skip: !(process.env.LIVE === '1' && process.env.DEEPSEEK_API_KEY) }, async () => {
  const sample =
    'El Sistema General de Seguridad Social en Salud de Colombia obliga a las EPS a garantizar la atencion de sus afiliados. ' +
    'Cuando una persona necesita una consulta con medicina general, debe acudir a la IPS primaria asignada en su municipio. ' +
    'Para atenciones de urgencias no se requiere autorizacion previa y cualquier IPS con servicio de urgencias debe atender. ' +
    'Las especialidades como cardiologia o pediatria requieren remision del medico general y se prestan en IPS de mayor complejidad.';
  const t0 = Date.now();
  const out = await generateBrief(sample, { apiKey: process.env.DEEPSEEK_API_KEY });
  const ms = Date.now() - t0;
  console.log(`live brief in ${ms} ms`, JSON.stringify(out));
  assert.ok(out);
  assert.ok(out.preguntas.length >= 3 && out.preguntas.length <= 5);
  assert.ok(ms < 30_000);
});
