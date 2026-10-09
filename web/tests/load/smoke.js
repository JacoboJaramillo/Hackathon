import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE = __ENV.BASE_URL;
if (!BASE) throw new Error('BASE_URL is required');

export const options = {
  vus: 1,
  duration: '30s',
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<800'],
    checks: ['rate==1'],
  },
};

export default function () {
  const home = http.get(`${BASE}/`);
  const h = home.headers;
  const get = (n) => h[n] || h[n.toLowerCase()] || h[n.replace(/(^|-)(\w)/g, (_, a, b) => a + b.toUpperCase())];
  const checks = {
    'home 200': (r) => r.status === 200,
    'x-content-type-options nosniff': () => (get('X-Content-Type-Options') || '').toLowerCase() === 'nosniff',
    'x-frame-options DENY': () => (get('X-Frame-Options') || '').toUpperCase() === 'DENY',
    'referrer-policy present': () => !!get('Referrer-Policy'),
    'permissions-policy present': () => !!get('Permissions-Policy'),
    'csp report-only present': () => !!get('Content-Security-Policy-Report-Only'),
    'no x-powered-by': () => !get('X-Powered-By'),
  };
  if (BASE.startsWith('https://')) {
    checks['hsts present'] = () => !!get('Strict-Transport-Security');
  }
  check(home, checks);

  const health = http.get(`${BASE}/api/health`);
  check(health, {
    'health 200': (r) => r.status === 200,
    'health status ok': (r) => r.json('status') === 'ok',
  });
  sleep(1);
}
