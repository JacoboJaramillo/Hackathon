import http from 'k6/http';
import { check, sleep } from 'k6';

// Prueba de usuarios masivos contra NUESTRO propio despliegue (nunca terceros).
// Modela 50 000 recorridos de usuario distintos (cada uno: cargar la página y
// consultar /api/health, con una pausa corta) que llegan en unos 6 minutos (160 por segundo en la meseta).
// No abre WebSocket ni sube documentos: eso consume créditos de pago.
//
// Ejecutar desde web/tests/load (Git Bash):
//   MSYS_NO_PATHCONV=1 docker run --rm -v "$(pwd -W):/scripts" \
//     -e BASE_URL=https://SERVICIO.run.app grafana/k6:2.2.0 run /scripts/users-50k.js
//
// Variables opcionales:
//   PHASE=main (por defecto) | stress  (stress sube la llegada hasta TOP_RATE
//   recorridos por segundo para buscar el punto de quiebre)
//   TOP_RATE=160  recorridos por segundo en la meseta de main
// Si el generador local no alcanza la tasa, k6 avisa con "dropped_iterations":
// en ese caso el límite fue la máquina que genera la carga, no el servicio.

const BASE = __ENV.BASE_URL;
if (!BASE) throw new Error('BASE_URL is required');
const PHASE = __ENV.PHASE || 'main';
const TOP = Number(__ENV.TOP_RATE) || 160;

const stages = PHASE === 'stress'
  ? [
      { target: 200, duration: '1m' },
      { target: 400, duration: '1m' },
      { target: 600, duration: '1m' },
      { target: 800, duration: '1m' },
      { target: 0, duration: '30s' },
    ]
  : [
      { target: TOP, duration: '30s' },
      { target: TOP, duration: '5m' },
      { target: 0, duration: '15s' },
    ];

export const options = {
  scenarios: {
    users: {
      executor: 'ramping-arrival-rate',
      startRate: 10,
      timeUnit: '1s',
      preAllocatedVUs: 400,
      maxVUs: 3000,
      stages,
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<1500'],
  },
};

export default function () {
  const r1 = http.get(`${BASE}/`);
  check(r1, { 'page 200': (r) => r.status === 200 });
  sleep(0.3 + Math.random() * 0.4);
  const r2 = http.get(`${BASE}/api/health`);
  check(r2, { 'health 200': (r) => r.status === 200 });
}
