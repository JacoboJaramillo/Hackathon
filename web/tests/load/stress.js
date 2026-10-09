import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE = __ENV.BASE_URL;
if (!BASE) throw new Error('BASE_URL is required');

// Stage tags let the report show at which load level errors start.
const stages = [
  { duration: '1m', target: 50, tag: 'ramp50' },
  { duration: '1m', target: 100, tag: 'ramp100' },
  { duration: '1m', target: 150, tag: 'ramp150' },
  { duration: '1m', target: 0, tag: 'recovery' },
];

function currentStage() {
  const t = (Date.now() - start) / 1000;
  return stages[Math.min(Math.floor(t / 60), stages.length - 1)].tag;
}
let start = 0;

export const options = {
  stages: stages.map(({ duration, target }) => ({ duration, target })),
  thresholds: {
    http_req_failed: ['rate<0.05'],
    http_req_duration: ['p(95)<3000'],
    'http_req_failed{stage:ramp50}': ['rate<1'],
    'http_req_failed{stage:ramp100}': ['rate<1'],
    'http_req_failed{stage:ramp150}': ['rate<1'],
    'http_req_failed{stage:recovery}': ['rate<1'],
    'http_req_duration{stage:ramp50}': ['p(95)<60000'],
    'http_req_duration{stage:ramp100}': ['p(95)<60000'],
    'http_req_duration{stage:ramp150}': ['p(95)<60000'],
    'http_req_duration{stage:recovery}': ['p(95)<60000'],
  },
};

export function setup() {
  return { start: Date.now() };
}

export default function (data) {
  start = data.start;
  const tags = { stage: currentStage() };
  const r = Math.random() < 0.7
    ? http.get(`${BASE}/api/health`, { tags })
    : http.get(`${BASE}/`, { tags });
  check(r, { 'status 200': (x) => x.status === 200 }, tags);
  sleep(1);
}
