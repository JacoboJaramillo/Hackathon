import ws from 'k6/ws';
import { check } from 'k6';

// k6/ws is used because ws.connect returns the handshake response (101 accepted, 403 rejected).
// DO NOT scale this up: every accepted session opens a paid upstream session. No audio is sent.
const BASE = __ENV.BASE_URL;
const ORIGIN = __ENV.ORIGIN;
if (!BASE || !ORIGIN) throw new Error('BASE_URL and ORIGIN are required');
const WS_URL = BASE.replace(/^http/, 'ws') + '/ws/agent';

export const options = {
  vus: 1,
  iterations: 1,
  thresholds: { checks: ['rate==1'] },
};

// Opens a connection; while it is open, tries the next one (nested), so up to `n`
// sockets are held at once. Every socket is closed after at most 3 s. Sends nothing.
// Rejected handshakes may come back as a response with status != 101 or as a thrown error.
function open(origin, n, statuses) {
  try {
    const res = ws.connect(WS_URL, { headers: { Origin: origin } }, (socket) => {
      socket.on('open', () => {
        if (n > 1) open(origin, n - 1, statuses);
        socket.close();
      });
      socket.on('error', () => {});
      socket.setTimeout(() => socket.close(), 3000);
    });
    statuses.unshift(res ? res.status : 0);
  } catch (e) {
    statuses.unshift(0);
  }
}

export default function () {
  const bad = [];
  open('https://evil.example', 1, bad);
  check(bad, { 'bad origin never accepted (no 101)': (s) => s.length === 1 && s[0] !== 101 });

  const good = [];
  open(ORIGIN, 3, good);
  const accepted = good.filter((s) => s === 101).length;
  check(good, {
    'three attempts made': (s) => s.length === 3,
    'at most 2 accepted': () => accepted <= 2,
    'at least 1 rejected': () => accepted < 3,
  });
}
