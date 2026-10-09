// Custom server: Next.js pages plus the /ws/agent voice proxy. The browser
// never talks to Deepgram directly because the Settings message carries the
// DeepSeek key; this server builds it and relays audio both ways.
import { createServer } from 'node:http';
import { randomUUID, createHash } from 'node:crypto';
import next from 'next';
import { WebSocketServer, WebSocket } from 'ws';
import { createLimiter, isAllowedOrigin, clientIp } from './server/limits.mjs';
import { buildSettings } from './server/agent-settings.mjs';
import { buscarSedes } from './server/ips.mjs';
import { parseDocument, createDocumentStore, MAX_BYTES } from './server/documents.mjs';
import { generateBrief } from './server/brief.mjs';

const dev = process.env.NODE_ENV !== 'production';
const port = Number(process.env.PORT) || 3000;
const { DEEPGRAM_API_KEY, DEEPSEEK_API_KEY, DATOSGOV_APP_TOKEN } = process.env;
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || (dev ? `http://localhost:${port}` : ''))
  .split(',').map((s) => s.trim()).filter(Boolean);
const SESSION_MAX_MS = Number(process.env.SESSION_MAX_MS) || 10 * 60_000;
const MAX_FRAME_BYTES = 64 * 1024;
// One tool call may page through datos.gov.co several times; cap the total so
// the voice turn never hangs on a slow upstream.
const TOOL_DEADLINE_MS = 12_000;
const withDeadline = (promise, ms) => Promise.race([
  promise,
  new Promise((_, reject) => setTimeout(() => reject(new Error('deadline')), ms).unref()),
]);
const DEEPGRAM_URL = 'wss://agent.deepgram.com/v1/agent/converse';
// Upstream events the browser needs; everything else stays on the server.
const FORWARD_TYPES = new Set([
  'Welcome', 'SettingsApplied', 'ConversationText', 'UserStartedSpeaking',
  'AgentThinking', 'AgentStartedSpeaking', 'AgentAudioDone',
]);

if (!DEEPGRAM_API_KEY || !DEEPSEEK_API_KEY) {
  console.error('Missing DEEPGRAM_API_KEY or DEEPSEEK_API_KEY');
  process.exit(1);
}

const limiter = createLimiter({
  perIp: Number(process.env.MAX_SESSIONS_PER_IP) || 2,
  global: Number(process.env.MAX_SESSIONS) || 8,
  ratePerMin: Number(process.env.MAX_CONNECTS_PER_MIN) || 10,
});
// Each upload may trigger a paid DeepSeek call for the brief.
const uploads = createLimiter({ perIp: 1, global: 4, ratePerMin: 5 });
const documents = createDocumentStore();
const hashIp = (ip) => createHash('sha256').update(ip).digest('hex').slice(0, 12);
const logEvent = (event, fields) => console.log(JSON.stringify({ severity: 'INFO', event, ...fields }));

const app = next({ dev, port });
const handle = app.getRequestHandler();
await app.prepare();

const server = createServer((req, res) => {
  if (new URL(req.url, 'http://localhost').pathname === '/api/document') return handleUpload(req, res);
  return handle(req, res);
});
const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME_BYTES });

const STATUS_TEXT = { 403: 'Forbidden', 404: 'Not Found', 429: 'Too Many Requests', 503: 'Service Unavailable' };

function reject(socket, status, reason, fields) {
  logEvent('ws_rejected', { reason, status, ...fields });
  socket.write(`HTTP/1.1 ${status} ${STATUS_TEXT[status]}\r\nConnection: close\r\nContent-Length: 0\r\n${status === 429 ? 'Retry-After: 60\r\n' : ''}\r\n`);
  socket.destroy();
}

server.on('upgrade', (req, socket, head) => {
  const { pathname, searchParams } = new URL(req.url, 'http://localhost');
  if (pathname !== '/ws/agent') {
    if (dev) return app.getUpgradeHandler()(req, socket, head);
    return socket.destroy();
  }
  const ip = clientIp(req);
  const id = randomUUID();
  if (!isAllowedOrigin(req.headers.origin, ALLOWED_ORIGINS)) {
    return reject(socket, 403, 'bad_origin', { id, ip: hashIp(ip) });
  }
  const docId = searchParams.get('doc');
  const doc = docId === null ? null : documents.get(docId);
  if (docId !== null && !doc) return reject(socket, 404, 'doc_not_found', { id, ip: hashIp(ip) });
  const slot = limiter.admit(ip);
  if (!slot.ok) return reject(socket, slot.status, slot.reason, { id, ip: hashIp(ip) });
  wss.handleUpgrade(req, socket, head, (client) => runSession(client, {
    id, ip: hashIp(ip), release: slot.release, documentText: doc?.text || '',
  }));
});

function runSession(client, { id, ip, release, documentText }) {
  logEvent('session_start', { id, ip, document: Boolean(documentText) });
  const started = Date.now();
  const upstream = new WebSocket(DEEPGRAM_URL, {
    headers: { Authorization: `Token ${DEEPGRAM_API_KEY}` },
    handshakeTimeout: 10_000,
  });
  const pending = [];
  let closed = false;

  const close = (code, reason) => {
    if (closed) return;
    closed = true;
    clearTimeout(maxTimer);
    release();
    if (client.readyState === WebSocket.OPEN) client.close(code, reason);
    if (upstream.readyState === WebSocket.OPEN || upstream.readyState === WebSocket.CONNECTING) upstream.terminate();
    logEvent('session_end', { id, ip, code, reason, seconds: Math.round((Date.now() - started) / 1000) });
  };
  const maxTimer = setTimeout(() => close(4000, 'session_time_limit'), SESSION_MAX_MS);
  const sendClient = (obj) => client.readyState === WebSocket.OPEN && client.send(JSON.stringify(obj));

  upstream.on('open', () => {
    upstream.send(JSON.stringify(buildSettings({ deepseekKey: DEEPSEEK_API_KEY, documentText })));
    for (const frame of pending.splice(0)) upstream.send(frame);
  });

  upstream.on('message', async (data, isBinary) => {
    if (isBinary) {
      if (client.readyState === WebSocket.OPEN) client.send(data, { binary: true });
      return;
    }
    let msg;
    try { msg = JSON.parse(data.toString()); } catch { return; }
    if (FORWARD_TYPES.has(msg.type)) return sendClient(msg);
    if (msg.type === 'FunctionCallRequest') return handleFunctions(msg);
    if (msg.type === 'Error') {
      console.error(JSON.stringify({ severity: 'ERROR', event: 'upstream_error', id, detail: msg }));
      sendClient({ type: 'Error', message: 'El servicio de voz tuvo un problema. Intenta de nuevo.' });
    }
  });

  async function handleFunctions(msg) {
    for (const f of msg.functions || []) {
      if (!f.client_side) continue;
      const result = f.name === 'buscar_sedes'
        ? await withDeadline(buscarSedes(f.arguments, { token: DATOSGOV_APP_TOKEN }), TOOL_DEADLINE_MS)
          .catch(() => ({ error: 'servicio_no_disponible' }))
        : { error: 'funcion_desconocida' };
      logEvent('tool_call', { id, name: f.name, error: result.error || null, total: result.total_sedes ?? null });
      sendClient({ type: 'ToolResult', name: f.name, result });
      if (upstream.readyState === WebSocket.OPEN) {
        upstream.send(JSON.stringify({ type: 'FunctionCallResponse', id: f.id, name: f.name, content: JSON.stringify(result) }));
      }
    }
  }

  upstream.on('close', () => close(1011, 'upstream_closed'));
  upstream.on('error', (e) => {
    if (closed) return;
    console.error(JSON.stringify({ severity: 'ERROR', event: 'upstream_socket_error', id, detail: e.message }));
    close(1011, 'upstream_error');
  });

  client.on('message', (data, isBinary) => {
    if (!isBinary) {
      // Only KeepAlive is accepted as text; anything else could inject agent
      // instructions or settings into the upstream session.
      let msg;
      try { msg = JSON.parse(data.toString()); } catch { return close(1008, 'invalid_message'); }
      if (msg?.type !== 'KeepAlive') return close(1008, 'invalid_message');
      data = JSON.stringify({ type: 'KeepAlive' });
    }
    if (upstream.readyState === WebSocket.OPEN) upstream.send(data, { binary: isBinary });
    else if (pending.length < 50) pending.push(data);
  });
  client.on('close', () => close(1000, 'client_closed'));
  client.on('error', () => close(1011, 'client_error'));
}

const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains',
};
const UPLOAD_BODY_MS = 20_000;
const UPLOAD_ERRORS = {
  origen_no_permitido: [403, 'No se aceptan cargas desde este sitio.'],
  demasiado_grande: [413, 'El archivo supera 20 MB. Sube uno más pequeño.'],
  demasiadas_cargas: [429, 'Hiciste muchas cargas seguidas. Espera un minuto e intenta de nuevo.'],
  error_interno: [500, 'No pudimos procesar tu documento. Intenta de nuevo.'],
};

// POST /api/document (docs/api/openapi.yaml). Raw body, type decided by
// signature inside parseDocument; the client name and Content-Type are ignored.
async function handleUpload(req, res) {
  const reply = (status, body, headers = {}) => {
    if (res.headersSent) return;
    res.writeHead(status, { ...JSON_HEADERS, ...headers });
    res.end(JSON.stringify(body));
  };
  const fail = (error, headers) => {
    const [status, mensaje] = UPLOAD_ERRORS[error];
    reply(status, { error, mensaje }, headers);
    req.resume();
  };
  if (req.method !== 'POST') {
    res.writeHead(405, { 'Cache-Control': 'no-store', Allow: 'POST' });
    return res.end();
  }
  const ip = clientIp(req);
  if (!isAllowedOrigin(req.headers.origin, ALLOWED_ORIGINS)) return fail('origen_no_permitido');
  if (Number(req.headers['content-length']) > MAX_BYTES) return fail('demasiado_grande', { Connection: 'close' });
  const slot = uploads.admit(ip);
  if (!slot.ok) return fail('demasiadas_cargas', { 'Retry-After': '60' });
  const started = Date.now();
  try {
    // Absolute budget for the body: an idle timeout alone lets a client that
    // trickles one byte at a time hold an upload slot for the whole request.
    const deadline = setTimeout(() => req.destroy(), UPLOAD_BODY_MS);
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > MAX_BYTES) return fail('demasiado_grande', { Connection: 'close' });
      chunks.push(chunk);
    }
    clearTimeout(deadline);
    const parsed = await parseDocument(Buffer.concat(chunks));
    if (!parsed.ok) return reply(parsed.status, { error: parsed.error, mensaje: parsed.mensaje });
    const brief = await generateBrief(parsed.text, { apiKey: DEEPSEEK_API_KEY });
    const documentId = documents.put({ tipo: parsed.tipo, text: parsed.text });
    logEvent('document_uploaded', {
      ip: hashIp(ip), tipo: parsed.tipo, caracteres: parsed.caracteres, truncado: parsed.truncado,
      brief: Boolean(brief), ms: Date.now() - started,
    });
    reply(201, { documentId, tipo: parsed.tipo, caracteres: parsed.caracteres, truncado: parsed.truncado, brief });
  } catch (e) {
    console.error(JSON.stringify({ severity: 'ERROR', event: 'upload_failed', ip: hashIp(ip), detail: e.message }));
    fail('error_interno');
  } finally {
    slot.release();
  }
}

server.listen(port, () => {
  logEvent('server_listening', { port, dev, allowedOrigins: ALLOWED_ORIGINS.length });
});
