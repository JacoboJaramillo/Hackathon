// Admission control for voice sessions. Every accepted session opens a paid
// upstream (Deepgram + DeepSeek), so limits are enforced before the handshake.
// ponytail: in-memory counters, valid while Cloud Run runs at most a couple of
// instances; move to Redis if max-instances grows.

// An IPv6 client usually controls a whole /64, so per-IP limits key on it.
export function ipKey(ip) {
  if (!ip.includes(':') || ip.includes('.')) return ip;
  const [head, tail] = ip.split('::');
  const h = head ? head.split(':') : [];
  const t = tail ? tail.split(':') : [];
  const full = tail === undefined ? h : [...h, ...Array(8 - h.length - t.length).fill('0'), ...t];
  return `${full.slice(0, 4).map((x) => x.toLowerCase().replace(/^0+(?=.)/, '')).join(':')}::/64`;
}

export function createLimiter({ perIp = 2, global = 8, ratePerMin = 10, now = Date.now } = {}) {
  const active = new Map();
  const attempts = new Map();
  let total = 0;
  // Forget addresses with no attempt in the last minute so the map stays bounded.
  setInterval(() => {
    const t = now();
    for (const [k, v] of attempts) if (!v.some((x) => t - x < 60_000)) attempts.delete(k);
  }, 60_000).unref();

  function admit(rawIp) {
    const ip = ipKey(rawIp);
    const t = now();
    const recent = (attempts.get(ip) || []).filter((x) => t - x < 60_000);
    recent.push(t);
    attempts.set(ip, recent);
    if (recent.length > ratePerMin) return { ok: false, status: 429, reason: 'rate_limited' };
    if (total >= global) return { ok: false, status: 503, reason: 'global_cap' };
    if ((active.get(ip) || 0) >= perIp) return { ok: false, status: 429, reason: 'ip_cap' };
    active.set(ip, (active.get(ip) || 0) + 1);
    total++;
    let released = false;
    return {
      ok: true,
      release() {
        if (released) return;
        released = true;
        total--;
        const n = active.get(ip) - 1;
        if (n > 0) active.set(ip, n);
        else active.delete(ip);
      },
    };
  }

  return { admit, stats: () => ({ total, ips: active.size }) };
}

export function isAllowedOrigin(origin, allowed) {
  return typeof origin === 'string' && allowed.includes(origin);
}

// Cloud Run's front end appends the real client address as the last
// X-Forwarded-For entry; anything before it is client-supplied and spoofable.
export function clientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.trim()) return xff.split(',').pop().trim();
  return req.socket.remoteAddress || 'unknown';
}
