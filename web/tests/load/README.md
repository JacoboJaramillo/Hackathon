# Pruebas de carga con k6

Versión de k6 fijada: `grafana/k6:2.2.0`. Todas las pruebas leen `BASE_URL` (sin barra final), por ejemplo `https://SERVICIO.run.app` o `http://host.docker.internal:3000` para una app local.

Advertencia: ejecutar estas pruebas solo contra nuestro propio despliegue. Nunca contra hosts de terceros.

## Qué mide cada prueba

| Archivo | Qué mide | Criterio de aprobación |
|---|---|---|
| `smoke.js` | 1 VU, 30 s: `/` y `/api/health` responden y `/` trae las cabeceras de seguridad (HSTS solo con https, nosniff, X-Frame-Options DENY, Referrer-Policy, Permissions-Policy, CSP report-only, sin X-Powered-By). | `http_req_failed < 1 %`, `p(95) < 800 ms`, todos los checks en 100 %. |
| `load.js` | Carga esperada: sube a 20 VUs en 1 min, sostiene 2 min, baja. 70 % `/api/health`, 30 % `/`. | `http_req_failed < 1 %`, `p(95) < 1000 ms`. |
| `stress.js` | Escalones de 50, 100 y 150 VUs (1 min cada uno) y 1 min de bajada para observar recuperación. Cada petición lleva el tag `stage` (`ramp50`, `ramp100`, `ramp150`, `recovery`). | `http_req_failed < 5 %`, `p(95) < 3000 ms` (umbrales laxos). Lo importante es ver en qué escalón empiezan los errores. |
| `spike.js` | 5 VUs, salto brusco a 120 VUs durante 30 s, vuelta a 5 y 1 min de observación. | `http_req_failed < 5 %`. |
| `ws-limits.js` | Límites del proxy WebSocket `/ws/agent`: (a) Origin `https://evil.example` no debe obtener 101; (b) con `ORIGIN` válido se intentan 3 conexiones simultáneas desde una IP y como máximo 2 deben aceptarse. No envía audio y cierra todo en menos de 5 s. | Todos los checks en 100 %. |

`ws-limits.js` usa `k6/ws` porque `ws.connect` devuelve la respuesta del handshake (status 101 o 403). El módulo `k6/experimental/websockets` no expone el status del handshake. Un rechazo en el upgrade puede aparecer como status 403 o como error lanzado; el script acepta ambos como "no aceptado".

## Comandos

Ejecutar desde la carpeta `web/tests/load`. Sustituir la URL por la del despliegue.

Git Bash (el prefijo `MSYS_NO_PATHCONV=1` evita que se altere la ruta montada):

```bash
cd web/tests/load
export BASE_URL=https://SERVICIO.run.app
for t in smoke load stress spike; do
  MSYS_NO_PATHCONV=1 docker run --rm -v "$(pwd -W):/scripts" -e BASE_URL grafana/k6:2.2.0 run /scripts/$t.js
done
MSYS_NO_PATHCONV=1 docker run --rm -v "$(pwd -W):/scripts" -e BASE_URL -e ORIGIN=https://SERVICIO.run.app grafana/k6:2.2.0 run /scripts/ws-limits.js
```

Para una sola prueba, p. ej. humo: `MSYS_NO_PATHCONV=1 docker run --rm -v "$(pwd -W):/scripts" -e BASE_URL grafana/k6:2.2.0 run /scripts/smoke.js`.

PowerShell:

```powershell
cd web\tests\load
$env:BASE_URL = "https://SERVICIO.run.app"
docker run --rm -v "${PWD}:/scripts" -e BASE_URL grafana/k6:2.2.0 run /scripts/smoke.js
docker run --rm -v "${PWD}:/scripts" -e BASE_URL grafana/k6:2.2.0 run /scripts/load.js
docker run --rm -v "${PWD}:/scripts" -e BASE_URL grafana/k6:2.2.0 run /scripts/stress.js
docker run --rm -v "${PWD}:/scripts" -e BASE_URL grafana/k6:2.2.0 run /scripts/spike.js
docker run --rm -v "${PWD}:/scripts" -e BASE_URL -e ORIGIN=https://SERVICIO.run.app grafana/k6:2.2.0 run /scripts/ws-limits.js
```

Contra la app local usar `BASE_URL=http://host.docker.internal:3000` y `ORIGIN=http://localhost:3000` (el Origin debe estar en la lista permitida del servidor).

## Cómo leer el resultado

Al final k6 imprime los umbrales con una marca de cumplido o fallido y termina con código distinto de cero si alguno falla. Una prueba aprueba solo si todos sus umbrales se cumplen. Revisar `http_req_duration` (p95), `http_req_failed` y `checks`.

En `stress.js`, filtrar las métricas por el tag `stage`: `http_req_failed{stage:ramp100}`, etc. El primer escalón con errores o p95 alto marca el punto de quiebre; `recovery` debe volver a latencias normales y sin errores. Se puede exportar con `--summary-export` o `--out json=...` y agrupar por `stage`.

## Notas importantes

- Cloud Run con `max-instances=2`: en `stress.js` y `spike.js` se espera ver el punto de quiebre (429, 503 o latencias altas). Es el objetivo de la prueba, no un defecto; registrar el escalón en que ocurre. Pueden fallar los umbrales laxos.
- `ws-limits.js` no debe escalarse nunca (más VUs, más iteraciones o más conexiones). Cada conexión aceptada abre una sesión de pago en el proveedor de voz y el LLM. La prueba solo verifica que los límites (Origin, máximo 2 sesiones por IP, tope global, límite de conexiones nuevas por IP) rechacen rápido. Ejecutarla una vez, no en bucle, y no dentro de `stress` ni `spike`.
- Si el límite por IP de conexiones nuevas ya se agotó por una corrida previa, esperar a que la ventana expire antes de repetir.
