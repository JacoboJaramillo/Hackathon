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

const dev = process.env.NODE_ENV !== 'production';
const port = Number(process.env.PORT) || 3000;
const { DEEPGRAM_API_KEY, DEEPSEEK_API_KEY, DATOSGOV_APP_TOKEN } = process.env;
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || (dev ? `http://localhost:${port}` : ''))
  .split(',').map((s) => s.trim()).filter(Boolean);
const SESSION_MAX_MS = Number(process.env.SESSION_MAX_MS) || 10 * 60_000;
const MAX_FRAME_BYTES = 64 * 1024;
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
const hashIp = (ip) => createHash('sha256').update(ip).digest('hex').slice(0, 12);
const logEvent = (event, fields) => console.log(JSON.stringify({ severity: 'INFO', event, ...fields }));

const app = next({ dev, port });
const handle = app.getRequestHandler();
await app.prepare();

const server = createServer((req, res) => handle(req, res));
const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME_BYTES });

function reject(socket, status, reason, fields) {
  logEvent('ws_rejected', { reason, status, ...fields });
  socket.write(`HTTP/1.1 ${status} ${status === 403 ? 'Forbidden' : status === 503 ? 'Service Unavailable' : 'Too Many Requests'}\r\nConnection: close\r\nContent-Length: 0\r\n${status === 429 ? 'Retry-After: 60\r\n' : ''}\r\n`);
  socket.destroy();
}

server.on('upgrade', (req, socket, head) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  if (pathname !== '/ws/agent') {
    if (dev) return app.getUpgradeHandler()(req, socket, head);
    return socket.destroy();
  }
  const ip = clientIp(req);
  const id = randomUUID();
  if (!isAllowedOrigin(req.headers.origin, ALLOWED_ORIGINS)) {
    return reject(socket, 403, 'bad_origin', { id, ip: hashIp(ip) });
  }
  const slot = limiter.admit(ip);
  if (!slot.ok) return reject(socket, slot.status, slot.reason, { id, ip: hashIp(ip) });
  wss.handleUpgrade(req, socket, head, (client) => runSession(client, { id, ip: hashIp(ip), release: slot.release }));
});

function runSession(client, { id, ip, release }) {
  logEvent('session_start', { id, ip });
  const started = Date.now();
  const upstream = new WebSocket(DEEPGRAM_URL, { headers: { Authorization: `Token ${DEEPGRAM_API_KEY}` } });
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
    upstream.send(JSON.stringify(buildSettings({ deepseekKey: DEEPSEEK_API_KEY })));
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
        ? await buscarSedes(f.arguments, { token: DATOSGOV_APP_TOKEN }).catch(() => ({ error: 'servicio_no_disponible' }))
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

server.listen(port, () => {
  logEvent('server_listening', { port, dev, allowedOrigins: ALLOWED_ORIGINS.length });
});
