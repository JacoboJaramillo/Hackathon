// Sends the sites a person chose to their WhatsApp (RF-024), using the
// approved utility template. The message text is built here from the last
// registry result, never written by the model, so it cannot invent data or be
// steered into sending something else.
import { createHash } from 'node:crypto';

export const TEMPLATE = { name: 'sedes_salud_v1', language: 'es' };
const WINDOW_MS = 10 * 60_000;
const HOUR_MS = 60 * 60_000;
const MAX_SEDES = 3;
const MAX_LIST_CHARS = 700;
const SEND_TIMEOUT_MS = 8_000;

export const TOOL_DEFINITION = {
  name: 'enviar_whatsapp',
  description:
    'Envía por WhatsApp hasta tres sedes de la última búsqueda al celular de la persona. ' +
    'Úsala solo después de que la persona aceptó, dictó su número y confirmó que lo repetiste bien. Solo se puede usar una vez.',
  parameters: {
    type: 'object',
    properties: {
      telefono: { type: 'string', description: 'Celular colombiano de 10 dígitos que empieza por 3, solo dígitos.' },
      sedes: {
        type: 'array',
        items: { type: 'integer' },
        description: 'Posiciones de las sedes en la última búsqueda, empezando en 1 (la primera que mencionaste es la 1). Máximo tres.',
      },
    },
    required: ['telefono', 'sedes'],
  },
};

// Colombian mobiles only: 10 digits starting with 3, optional 57 prefix.
export function normalizePhone(raw) {
  if (typeof raw !== 'string' || raw.length > 40) return null;
  let d = raw.replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('57')) d = d.slice(2);
  return /^3\d{9}$/.test(d) ? `57${d}` : null;
}

// Meta rejects template parameters with newlines, tabs or long space runs.
const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

export function validateArgs(raw, lastResult) {
  let obj = raw;
  if (typeof raw === 'string') {
    try { obj = JSON.parse(raw); } catch { return { error: 'parametros_invalidos' }; }
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { error: 'parametros_invalidos' };
  for (const k of Object.keys(obj)) if (k !== 'telefono' && k !== 'sedes') return { error: 'parametros_invalidos' };
  const to = normalizePhone(obj.telefono);
  if (!to) return { error: 'telefono_invalido' };
  const list = lastResult?.sedes;
  if (!Array.isArray(list) || !list.length) return { error: 'sin_busqueda' };
  const picks = [...new Set(Array.isArray(obj.sedes) ? obj.sedes : [])];
  if (!picks.length || picks.length > MAX_SEDES || !picks.every((n) => Number.isInteger(n) && n >= 1 && n <= list.length)) {
    return { error: 'sedes_invalidas' };
  }
  return { to, params: buildParams(lastResult, picks) };
}

export function buildParams(result, picks) {
  const lugar = clean(result.alcance === 'departamento'
    ? result.departamento
    : [result.municipio, result.departamento].filter(Boolean).join(', '));
  const lista = clean(picks.map((n, i) => {
    const s = result.sedes[n - 1];
    const parts = [s.sede ?? s.prestador, s.direccion, s.telefono ? `tel ${s.telefono}` : null].filter(Boolean);
    return `${i + 1}) ${parts.join(', ')}.`;
  }).join(' ')).slice(0, MAX_LIST_CHARS);
  return [lugar, lista];
}

const hash = (s) => createHash('sha256').update(s).digest('hex').slice(0, 12);

// ponytail: in-memory windows per instance (max-instances 2), so the real
// global cap is up to twice the configured one; use a shared store if it must be exact.
export function createWhatsApp({
  token, phoneNumberId, version = 'v25.0', perHour = 3, now = Date.now, fetchImpl = fetch,
  log = () => {},
} = {}) {
  const byIp = new Map();
  const byPhone = new Map();
  let sent = [];

  async function send({ ipKey, to, params }) {
    const t = now();
    for (const m of [byIp, byPhone]) for (const [k, at] of m) if (t - at >= WINDOW_MS) m.delete(k);
    sent = sent.filter((at) => t - at < HOUR_MS);
    const phoneKey = hash(to);
    if (byIp.has(ipKey) || byPhone.has(phoneKey)) return { error: 'limite_alcanzado' };
    if (sent.length >= perHour) return { error: 'limite_global' };
    // Counted on attempt: a failing number or a retry loop never reaches Meta twice.
    byIp.set(ipKey, t);
    byPhone.set(phoneKey, t);
    sent.push(t);
    try {
      const r = await fetchImpl(`https://graph.facebook.com/${version}/${phoneNumberId}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to,
          type: 'template',
          template: {
            name: TEMPLATE.name,
            language: { code: TEMPLATE.language },
            components: [{ type: 'body', parameters: params.map((text) => ({ type: 'text', text })) }],
          },
        }),
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok || !body.messages?.[0]?.id) {
        log('whatsapp_failed', { phone: phoneKey, status: r.status, code: body.error?.code ?? null });
        return { error: 'no_disponible' };
      }
      log('whatsapp_sent', { phone: phoneKey });
      return { enviado: true };
    } catch (e) {
      log('whatsapp_failed', { phone: phoneKey, reason: e.name });
      return { error: 'no_disponible' };
    }
  }

  return { send };
}
