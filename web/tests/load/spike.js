import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE = __ENV.BASE_URL;
if (!BASE) throw new Error('BASE_URL is required');

export const options = {
  stages: [
    { duration: '30s', target: 5 },
    { duration: '5s', target: 120 },
    { duration: '30s', target: 120 },
    { duration: '5s', target: 5 },
    { duration: '1m', target: 5 },
  ],
  thresholds: {
    http_req_failed: ['rate<0.05'],
  },
};

export default function () {
  const r = http.get(`${BASE}/api/health`);
  check(r, { 'status 200': (x) => x.status === 200 });
  sleep(1);
}
