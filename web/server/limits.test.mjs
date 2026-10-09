import test from 'node:test';
import assert from 'node:assert/strict';
import { createLimiter, isAllowedOrigin, clientIp } from './limits.mjs';

test('RNF-004 per-IP cap rejects the third concurrent session', () => {
  const l = createLimiter({ perIp: 2, global: 10, ratePerMin: 100 });
  const a = l.admit('1.1.1.1');
  const b = l.admit('1.1.1.1');
  const c = l.admit('1.1.1.1');
  assert.ok(a.ok && b.ok);
  assert.deepEqual([c.ok, c.status, c.reason], [false, 429, 'ip_cap']);
  a.release();
  assert.ok(l.admit('1.1.1.1').ok, 'slot frees after release');
});

test('RNF-004 global cap applies across IPs', () => {
  const l = createLimiter({ perIp: 5, global: 2, ratePerMin: 100 });
  assert.ok(l.admit('a').ok);
  assert.ok(l.admit('b').ok);
  assert.equal(l.admit('c').reason, 'global_cap');
});

test('RNF-004 rate limit counts attempts in a sliding minute', () => {
  let t = 0;
  const l = createLimiter({ perIp: 100, global: 100, ratePerMin: 3, now: () => t });
  for (let i = 0; i < 3; i++) l.admit('x').release();
  assert.equal(l.admit('x').reason, 'rate_limited');
  t = 61_000;
  assert.ok(l.admit('x').ok, 'window slides');
});

test('RNF-004 double release does not corrupt counters', () => {
  const l = createLimiter({ perIp: 1, global: 1, ratePerMin: 100 });
  const a = l.admit('x');
  a.release();
  a.release();
  assert.deepEqual(l.stats(), { total: 0, ips: 0 });
});

test('RNF-004 origin allowlist is exact match and fails closed', () => {
  const allowed = ['https://app.example'];
  assert.ok(isAllowedOrigin('https://app.example', allowed));
  assert.ok(!isAllowedOrigin('https://app.example.evil.com', allowed));
  assert.ok(!isAllowedOrigin(undefined, allowed));
  assert.ok(!isAllowedOrigin('https://app.example', []));
});

test('RNF-004 client IP uses the last X-Forwarded-For entry', () => {
  const req = (xff) => ({ headers: xff ? { 'x-forwarded-for': xff } : {}, socket: { remoteAddress: '9.9.9.9' } });
  assert.equal(clientIp(req('6.6.6.6, 2.2.2.2')), '2.2.2.2');
  assert.equal(clientIp(req()), '9.9.9.9');
});
