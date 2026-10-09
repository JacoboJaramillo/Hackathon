# Capacidad y escalado

Fecha de las mediciones: 2026-10-09, entre las 11:26 y las 11:42 (hora local de la máquina generadora; en UTC, 16:26 a 16:42). Objetivo: únicamente nuestro despliegue `https://agente-vocal-583590264456.us-east1.run.app` (Cloud Run, proyecto `agente-vocal-hackaton`, `us-east1`, servicio `agente-vocal`, `max-instances=2`, `concurrency=40`, 1 vCPU, 1 GiB). Lo medido se marca como "Medido"; lo demás es "Proyección" y no está verificado.

## 1. Qué se midió

Script: `web/tests/load/users-50k.js` (k6 2.2.0, ejecutor `ramping-arrival-rate`). Cada recorrido de usuario es `GET /`, una pausa de 0,3 a 0,7 s y `GET /api/health`. No se abrió ningún WebSocket ni se subió ningún documento, porque ambos disparan llamadas de pago a Deepgram y DeepSeek.

Comando (Git Bash, desde `web/tests/load`):

```bash
MSYS_NO_PATHCONV=1 docker run --rm -v "$(pwd -W):/scripts" \
  -e BASE_URL=https://agente-vocal-583590264456.us-east1.run.app \
  grafana/k6:2.2.0 run /scripts/users-50k.js
```

Generador: una sola máquina Windows de 16 hilos con Docker y red doméstica, un único origen de IP. Las rutas probadas (`/` y `/api/health`) no usan el límite por IP.

### 1.1 Carga principal: 50 000 usuarios en unos 6 minutos

Medido. La primera corrida, a 140 recorridos por segundo (11:26 a 11:32), completó 45 299 recorridos: no llegó a 50 000, por eso se subió la meseta a 160. Corrida oficial (11:32 a 11:37, revisión `agente-vocal-00006-rtt`):

| Métrica | Valor |
|---|---|
| Recorridos completados (usuarios modelados) | 51 749; 0 interrumpidos, 0 descartados |
| Peticiones HTTP | 103 498 (299,6 por segundo en promedio de la corrida; unas 320 por segundo en la meseta) |
| Recorridos por segundo (promedio) | 149,8 (meseta objetivo 160) |
| Mediana | 91,7 ms |
| p90 / p95 | 130 ms / 191 ms |
| p99 | No registrado en esta corrida (k6 no lo imprime por defecto); el máximo fue 1,66 s |
| Tasa de error | 0,00 % (0 de 103 498) |
| VUs máximos usados | 179 de 400 reservados |
| Umbrales (`http_req_failed < 1 %`, `p95 < 1500 ms`) | Cumplidos |

Cloud Monitoring (solo lectura, `request_count` e `instance_count`): durante la meseta el servicio atendió unas 19 200 peticiones por minuto (320 por segundo) con 2 instancias; todas 2xx, cero 4xx y cero 5xx. En la corrida de 140 por segundo la mediana fue 88 ms y el p95 133 ms, también sin errores.

Conclusión medida: 51 749 recorridos (103 498 peticiones) en 5,8 minutos con p95 de 191 ms y sin errores. El generador no fue el límite en esta corrida (no hubo `dropped_iterations`).

### 1.2 Estrés: búsqueda del punto de quiebre

Medido. Mismo script con `-e PHASE=stress` (11:38 a 11:42). La llegada sube por escalones de un minuto a 200, 400, 600 y 800 recorridos por segundo (400 a 1 600 peticiones por segundo ofrecidas), con hasta 3 000 VUs:

```bash
MSYS_NO_PATHCONV=1 docker run --rm -v "$(pwd -W):/scripts" -e PHASE=stress \
  -e BASE_URL=https://agente-vocal-583590264456.us-east1.run.app \
  grafana/k6:2.2.0 run --summary-trend-stats="med,p(90),p(95),p(99),max" /scripts/users-50k.js
```

| Métrica | Valor |
|---|---|
| Recorridos completados | 80 856; 27 443 descartados por falta de VUs |
| Peticiones | 161 712 (597,9 por segundo en promedio) |
| Mediana / p90 / p95 / p99 / máximo | 123 ms / 9,93 s / 10,2 s / 10,47 s / 12,1 s |
| Tasa de error | 17,49 % (28 289 de 161 712) |
| Códigos de error en los logs | Todos 429 (10 093 entradas leídas; ningún 5xx) |
| Umbrales | Incumplidos, esperado en una prueba de estrés |

Punto de quiebre: los primeros 429 aparecen en el tercer escalón (600 recorridos por segundo, unas 1 200 peticiones por segundo ofrecidas, desde las 16:40 UTC). Hasta el segundo escalón (400 por segundo, unas 800 peticiones por segundo) no hubo errores. Cloud Monitoring muestra un máximo de unas 46 300 respuestas 2xx en un minuto (unas 770 por segundo) con 2 instancias. Los 429 los emite Cloud Run: se agotó la capacidad (`max-instances=2` por `concurrency=40` son 80 peticiones simultáneas más una cola breve), no la aplicación. No hubo 5xx. Al terminar la rampa el servicio volvió a responder 200 (la última ventana de logs ya no muestra 429 nuevos de la carga).

Advertencia sobre el generador: el escalón de 800 por segundo superó lo que una máquina doméstica puede sostener con latencias de 10 s (se agotaron los 3 000 VUs y hubo iteraciones descartadas). Por eso el techo del servicio se estima con las respuestas 2xx por minuto de Cloud Run, no con los números del generador.

### 1.3 Cambio de revisión durante la prueba

La carga principal corrió sobre `agente-vocal-00006-rtt`. El hilo principal desplegó `agente-vocal-00007-ss4` a las 16:40:59 UTC, en pleno escalón de estrés (838 de las 10 093 entradas de 429 leídas corresponden a la revisión nueva, y el contador de instancias llegó a 3 al final). El arranque de la revisión nueva consumió capacidad, así que el punto de quiebre exacto es aproximado; el orden de magnitud no cambia. La corrida principal (1.1) no se vio afectada.

## 2. Modelo de capacidad

### 2.1 Tráfico de páginas y API (a)

Medido: sin degradación (p95 191 ms, 0 % de error) con unas 320 peticiones por segundo en 2 instancias, es decir unas 160 por segundo por instancia, con 179 VUs en vuelo como máximo. Con presión máxima el pico servido fue de unas 770 por segundo en total, unas 385 por segundo por instancia, ya con latencias de segundos en el cliente.

Modelo: capacidad cómoda de unas 160 peticiones por segundo por instancia y capacidad de pico de unas 380. Con `max-instances=2`: unas 320 cómodas y unas 770 de pico. Una llegada genera 2 peticiones aquí (los estáticos de `/_next/static` no se incluyeron en la prueba y el navegador los cachea), por lo que 320 por segundo equivalen a unos 160 usuarios nuevos por segundo. Es capacidad de llegadas de página, no de usuarios usando el agente.

### 2.2 Cargas de documento (b)

No medido en producción (cuesta dinero). Límites por diseño en `web/server.mjs`: 1 carga simultánea por IP, 4 globales por instancia y 5 por minuto por IP. Con 2 instancias son 8 cargas simultáneas. Cada carga llama a DeepSeek para generar el brief; las pruebas manuales (R-013) dieron 1,2 a 1,8 s por carga, lo que en teoría permite unas 4 a 7 cargas por segundo con 8 simultáneas. En la práctica el tope lo fija la cuota de DeepSeek de la cuenta (proyección). Los contadores son en memoria por instancia, de modo que el límite por IP es realmente por IP y por instancia.

### 2.3 Sesiones de voz concurrentes (c)

No medido en producción (cada sesión usa Deepgram y DeepSeek de pago). Límite por diseño: `MAX_SESSIONS=8` por instancia, 2 por IP y 10 minutos de duración máxima. Con `max-instances=2` son 16 sesiones simultáneas; la sesión 17 recibe 503. Con sesiones de hasta 10 minutos, eso es como máximo unas 96 sesiones por hora. Hay además dos límites externos sin medir: la concurrencia de conexiones de streaming de la cuenta de Deepgram (depende del plan) y el límite de peticiones de DeepSeek. Esta es, con diferencia, la carga más restrictiva y no se resuelve con más instancias sin subir también esos planes.

## 3. Cómo llegar a 100.000 usuarios

Nada de esta sección está medido; son proyecciones con supuestos explícitos.

### 3.1 Supuestos y cuentas

"100 000 usuarios" admite tres lecturas:

1. 100 000 usuarios al día. Supuesto: el 12 % del tráfico cae en la hora pico, unos 12 000 usuarios, unos 3,3 usuarios nuevos por segundo, unas 7 peticiones por segundo. El sistema actual (320 por segundo medidas) lo cubre con un factor mayor a 40, solo para páginas.
2. 100 000 usuarios llegando en pocos minutos. Se midieron unos 150 recorridos por segundo con 2 instancias. Para 100 000 en 6 minutos hacen falta unos 280 recorridos por segundo, unas 560 peticiones por segundo; con 160 cómodas por instancia son 4 instancias, y con 50 % de margen, 6.
3. 100 000 usuarios con sesión de voz simultánea. Supuesto: el 1 % está hablando a la vez, 1 000 sesiones. Con 8 sesiones por instancia son 125 instancias y 1 000 conexiones simultáneas a Deepgram y DeepSeek. Con un 5 % serían 5 000 sesiones. El valor 8 es una elección conservadora de costo, no un límite de CPU medido; hay que medir cuántas sesiones sostiene una instancia de 1 vCPU antes de subirlo.

### 3.2 Cambios concretos

- `max-instances`: de 2 a 10 para tráfico de páginas (caso 2). Para voz con el 1 % (caso 3): 125 con `MAX_SESSIONS=8`, o unas 40 si una prueba demuestra que 25 sesiones por instancia son viables (proyección). Se cambia en `infra/deploy.sh`, que hoy fija 2.
- `min-instances`: 2 o 3 durante el evento para evitar arranques en frío ante picos bruscos (en el estrés, el arranque de una instancia nueva coincidió con los 429). Costo: instancias siempre encendidas.
- `concurrency`: 40 es adecuado para páginas. Las sesiones WebSocket son largas y cuentan como peticiones concurrentes; con `MAX_SESSIONS` de 25 queda margen dentro de 40, pero debe medirse.
- Memorystore (Redis): hoy el limitador (`web/server/limits.mjs`, que ya lo anticipa en un comentario `ponytail`) y el almacén de documentos viven en la memoria de cada instancia. Con más de una instancia el límite por IP no es global y un `documentId` subido en una instancia puede no existir en otra (el WebSocket con `?doc=` daría 404). Mover ambos a Redis, en la misma región y con acceso por Direct VPC egress o conector VPC, es obligatorio antes de escalar más allá de 2 instancias. La afinidad de sesión (`--session-affinity`, ya activa) lo mitiga pero no lo garantiza.
- Cuotas regionales de Cloud Run: revisar y pedir aumento de las cuotas de CPU, memoria e instancias de la región antes de pasar de unas decenas de instancias. No se verificó la cuota actual del proyecto.
- Deepgram: contratar un plan cuya concurrencia de streaming cubra el pico previsto (1 000 en el supuesto del 1 %) y confirmar la cifra por escrito con el proveedor; no se asume aquí el límite vigente. DeepSeek: solicitar aumento del límite de peticiones o repartir entre claves.
- CDN para estáticos: Cloud CDN detrás de un balanceador global, o `/_next/static` servido desde un bucket con CDN. Esos archivos llevan hash en el nombre y se pueden cachear por mucho tiempo; así las instancias atienden solo HTML y API.
- Salvaguardas de gasto: cuotas y alertas de presupuesto en Deepgram y DeepSeek y un tope global de sesiones en Redis. El 503 de `global_cap` es el comportamiento correcto ante saturación.

### 3.3 Verificación necesaria

Una sola máquina no basta: aquí un equipo doméstico sostuvo unas 300 peticiones por segundo y se saturó en el estrés. Para validar 100 000 hay que usar un generador distribuido (k6 Cloud, o k6 en varias máquinas o en un clúster con el operador de k6) con varias IP de origen. Orden sugerido: (1) tráfico de páginas con el nuevo `max-instances`; (2) sesiones de voz en número pequeño y con presupuesto acotado, para medir sesiones por instancia y costo por sesión; (3) extrapolar y repetir a escala con topes de gasto. Hasta entonces, la cifra de 100 000 simultáneos es una proyección.

### 3.4 Implicación de costo

Para solo tráfico de páginas, 100 000 usuarios cuestan poco, y menos aún con CDN. El costo dominante son las sesiones de voz (minutos de audio en Deepgram y turnos de LLM en DeepSeek) más el costo fijo de las instancias mínimas encendidas. No se calculó en dinero porque depende de los precios vigentes de cada proveedor; hay que fijar presupuesto y topes antes de abrir el servicio a ese volumen.
