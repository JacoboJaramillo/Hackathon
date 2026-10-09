// Spike (paso 1): Deepgram Voice Agent in Spanish with DeepSeek as the think
// provider and a client-side IPS function. No UI: user turns are synthesized
// with Deepgram TTS and streamed as microphone audio in real time.
// Run from web/: node --env-file=../.env scripts/spike-voice-agent.mjs
import { writeFileSync } from 'node:fs';

const { DEEPGRAM_API_KEY, DEEPSEEK_API_KEY, DATOSGOV_APP_TOKEN } = process.env;
if (!DEEPGRAM_API_KEY || !DEEPSEEK_API_KEY) throw new Error('Missing API keys in environment');

const IN_RATE = 16000;
const OUT_RATE = 24000;
const FRAME_MS = 20;
const FRAME_BYTES = (IN_RATE * 2 * FRAME_MS) / 1000;
const VOICE = process.env.SPIKE_VOICE || 'aura-2-celeste-es';

const DOC = `Política de teletrabajo de la empresa Andina Salud S.A.S. (2026).
1. Los empleados pueden teletrabajar máximo tres días por semana.
2. El auxilio de conectividad es de 120.000 pesos mensuales.
3. Las solicitudes se aprueban por el jefe directo en un plazo de cinco días hábiles.
4. Quien incumpla dos veces el horario pactado pierde el beneficio por tres meses.`;

const TURNS = [
  '¿Cuántos días a la semana puedo teletrabajar?',
  '¿Cuántas IPS públicas hay en el municipio de Leticia?',
  '¿Cuál es el salario del gerente general?',
];

const PROMPT = `Eres un asistente de voz en español. Respondes en frases cortas, sin listas ni formato, porque tu respuesta se lee en voz alta.
Tienes dos fuentes: el DOCUMENTO de abajo y la herramienta consultar_ips.
Si la pregunta trata de IPS, hospitales, clínicas, prestadores o sedes de salud en Colombia, llama siempre a consultar_ips antes de responder, aunque el documento no lo mencione.
Para todo lo demás responde solo con el documento. Si la respuesta no está en el documento ni en la herramienta, di que no lo sabes porque no está en el documento.
Nunca menciones nombres de personas, correos ni teléfonos de la base de IPS.
DOCUMENTO:
${DOC}`;

const IPS_COLUMNS = ['departamento', 'municipio', 'nombre_prestador', 'naturaleza', 'nom_sede_ips'];
const soqlString = (v) => `'${String(v).slice(0, 80).replace(/'/g, "''").toUpperCase()}'`;

async function consultarIps({ departamento, municipio, naturaleza } = {}) {
  const where = [];
  if (departamento) where.push(`upper(departamento)=${soqlString(departamento)}`);
  if (municipio) where.push(`upper(municipio)=${soqlString(municipio)}`);
  if (naturaleza) where.push(`upper(naturaleza)=${soqlString(naturaleza)}`);
  const base = 'https://www.datos.gov.co/resource/s2ru-bqt6.json';
  const w = where.length ? `&$where=${encodeURIComponent(where.join(' AND '))}` : '';
  const headers = DATOSGOV_APP_TOKEN ? { 'X-App-Token': DATOSGOV_APP_TOKEN } : {};
  const get = async (q) => {
    const r = await fetch(base + q, { headers, signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error(`datos.gov.co ${r.status}`);
    return r.json();
  };
  const [count, sample] = await Promise.all([
    get(`?$select=count(distinct c_digo_prestador) as ips, count(*) as sedes${w}`),
    get(`?$select=${IPS_COLUMNS.join(',')}&$limit=5${w}`),
  ]);
  return { ips: Number(count[0].ips), sedes: Number(count[0].sedes), ejemplos: sample };
}

const settings = {
  type: 'Settings',
  audio: {
    input: { encoding: 'linear16', sample_rate: IN_RATE },
    output: { encoding: 'linear16', sample_rate: OUT_RATE, container: 'none' },
  },
  agent: {
    listen: { provider: { type: 'deepgram', model: 'nova-3', language: 'es', keyterms: ['IPS', 'Leticia'] } },
    think: {
      provider: { type: 'open_ai', model: 'deepseek-chat', temperature: 0.2 },
      endpoint: {
        url: 'https://api.deepseek.com/chat/completions',
        headers: { authorization: `Bearer ${DEEPSEEK_API_KEY}` },
      },
      prompt: PROMPT,
      functions: [
        {
          name: 'consultar_ips',
          description: 'Consulta el registro oficial de IPS (prestadores de salud) de Colombia en datos.gov.co. Devuelve el número de IPS y de sedes que cumplen los filtros y hasta 5 ejemplos.',
          parameters: {
            type: 'object',
            properties: {
              departamento: { type: 'string', description: 'Nombre del departamento, por ejemplo Antioquia' },
              municipio: { type: 'string', description: 'Nombre del municipio en mayúsculas con tildes, por ejemplo MEDELLÍN' },
              naturaleza: { type: 'string', enum: ['Pública', 'Privada', 'Mixta'] },
            },
          },
        },
      ],
    },
    speak: { provider: { type: 'deepgram', model: VOICE } },
    greeting: 'Hola, ya leí el documento. ¿Qué quieres saber?',
  },
};

async function tts(text) {
  const url = `https://api.deepgram.com/v1/speak?model=${VOICE}&encoding=linear16&sample_rate=${IN_RATE}&container=none`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Token ${DEEPGRAM_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  if (!r.ok) throw new Error(`TTS ${r.status} ${await r.text()}`);
  return Buffer.from(await r.arrayBuffer());
}

function wav(pcm, rate) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVEfmt ', 8);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

const t0 = performance.now();
const now = () => Math.round(performance.now() - t0);
const log = (...a) => console.log(String(now()).padStart(6), ...a);

const userAudio = await Promise.all(TURNS.map(tts));
log('user turns synthesized', userAudio.map((b) => b.length));

const ws = new WebSocket('wss://agent.deepgram.com/v1/agent/converse', ['token', DEEPGRAM_API_KEY]);
ws.binaryType = 'arraybuffer';

const agentAudio = [];
const results = [];
let queue = Buffer.alloc(0);
let turn = -1;
let userEndAt = 0;
let firstAudioAt = 0;
let fnAt = 0;
let pacer;

function nextTurn() {
  turn++;
  if (turn >= TURNS.length) return finish();
  log(`--- turn ${turn + 1}: ${TURNS[turn]}`);
  queue = userAudio[turn];
  firstAudioAt = 0;
  fnAt = 0;
}

function finish() {
  clearInterval(pacer);
  ws.close();
  writeFileSync('spike-agent-output.wav', wav(Buffer.concat(agentAudio), OUT_RATE));
  console.log('\nRESULTS');
  console.table(results);
  console.log('Agent audio saved to web/spike-agent-output.wav');
  process.exit(0);
}

ws.onopen = () => {
  log('ws open');
  ws.send(JSON.stringify(settings));
  pacer = setInterval(() => {
    let frame;
    if (queue.length) {
      frame = queue.subarray(0, FRAME_BYTES);
      queue = queue.subarray(FRAME_BYTES);
      if (!queue.length) userEndAt = now();
    }
    if (!frame || frame.length < FRAME_BYTES) frame = Buffer.concat([frame ?? Buffer.alloc(0)], FRAME_BYTES);
    if (ws.readyState === WebSocket.OPEN) ws.send(frame);
  }, FRAME_MS);
};

ws.onmessage = async ({ data }) => {
  if (typeof data !== 'string') {
    agentAudio.push(Buffer.from(data));
    if (turn >= 0 && !firstAudioAt && userEndAt) {
      firstAudioAt = now();
      log(`first agent audio, ${firstAudioAt - userEndAt} ms after user stopped`);
    }
    return;
  }
  const msg = JSON.parse(data);
  switch (msg.type) {
    case 'ConversationText':
      log(`${msg.role}: ${msg.content}`);
      if (msg.role === 'assistant' && turn >= 0 && results[turn]) results[turn].respuesta += ` ${msg.content}`;
      break;
    case 'FunctionCallRequest':
      for (const f of msg.functions) {
        fnAt = now();
        log(`function ${f.name} ${f.arguments} client_side=${f.client_side}`);
        if (!f.client_side) continue;
        let content;
        try {
          content = JSON.stringify(await consultarIps(JSON.parse(f.arguments)));
        } catch (e) {
          content = JSON.stringify({ error: 'No se pudo consultar la base de IPS' });
          log('function error', e.message);
        }
        log(`function done in ${now() - fnAt} ms: ${content.slice(0, 160)}`);
        ws.send(JSON.stringify({ type: 'FunctionCallResponse', id: f.id, name: f.name, content }));
      }
      break;
    case 'AgentAudioDone':
      log('AgentAudioDone');
      if (turn >= 0) {
        results[turn].latencia_ms = firstAudioAt ? firstAudioAt - userEndAt : null;
        results[turn].uso_funcion = Boolean(fnAt);
      }
      setTimeout(() => {
        nextTurn();
        if (turn < TURNS.length) results[turn] = { pregunta: TURNS[turn], respuesta: '' };
      }, 800);
      break;
    case 'Error':
    case 'Warning':
      log(msg.type, JSON.stringify(msg));
      break;
    case 'LatencyReport':
      log('LatencyReport', JSON.stringify(msg));
      break;
    default:
      log(msg.type);
  }
};

ws.onerror = (e) => log('ws error', e.message ?? e);
ws.onclose = (e) => { log('ws closed', e.code, e.reason); if (turn < TURNS.length) process.exit(1); };
setTimeout(() => { log('timeout'); finish(); }, 120000);
