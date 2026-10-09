# ¿Dónde me atienden?

Agente de voz cognitivo del Reto 01 de Kognia Labs. Una persona abre la página, habla en español con la asistente "Gabriela" y le dice qué atención necesita y en qué municipio está; Gabriela consulta en vivo el registro oficial de IPS de datos.gov.co (dataset `s2ru-bqt6`) y le indica en qué sede puede atenderse. Si la persona sube un documento (PDF, DOCX o TXT), el agente también responde sobre él sin inventar y cita "según tu documento". La pantalla muestra la transcripción con hablantes y hora, y el sentimiento y la emoción de cada intervención. Si la persona quiere, Gabriela le envía hasta tres sedes por WhatsApp.

URL pública: https://agente-vocal-583590264456.us-east1.run.app (sin cuentas ni instalación; Chrome o Edge con micrófono, Firefox no está soportado).

## Stack

- Un proceso Node 24 con Next.js 15.5 (React 19, TypeScript en la interfaz) y un servidor propio (`web/server.mjs`) que además atiende el WebSocket `/ws/agent` con la librería `ws`.
- Voz: Deepgram Voice Agent API (STT `nova-3`, TTS `aura-2-celeste-es`) con DeepSeek `deepseek-chat` como modelo de lenguaje.
- Datos: API SODA2 de datos.gov.co. Sin base de datos: todo el estado vive en memoria.
- Despliegue: Google Cloud Run (proyecto `agente-vocal-hackaton`, región `us-east1`), secretos en Secret Manager.
- Dependencias de producción: `next`, `react`, `react-dom`, `ws`, `unpdf`, `fflate` (ver `web/package.json`).

## Arquitectura en cinco líneas

1. El navegador abre un WebSocket seguro a `/ws/agent` y envía audio PCM de 16 kHz.
2. `web/server/limits.mjs` decide la admisión antes del handshake: Origin en lista blanca, tasa por IP, cupo por IP y cupo global.
3. `web/server.mjs` abre una conexión a Deepgram por sesión, le envía el `Settings` (prompt, herramienta y clave de DeepSeek, que el navegador nunca ve) y releva audio y eventos permitidos.
4. Cuando el modelo pide `buscar_sedes`, `web/server/ips.mjs` valida los argumentos, resuelve el municipio contra la lista oficial y consulta datos.gov.co con valores escapados.
5. `POST /api/document` identifica el tipo por firma, extrae el texto en un hilo aislado, lo guarda 30 minutos en memoria y genera un brief con DeepSeek.

Detalle, diagramas y límites de confianza: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Arquitectura en imágenes

![Vista general del sistema](docs/diagrams/img/01-contexto.png)

De izquierda a derecha: la persona habla con Gabriela en el navegador, que se conecta por HTTPS y WSS al servicio `agente-vocal` en Cloud Run; el servidor, con claves que solo él conoce, habla con Deepgram, DeepSeek, datos.gov.co y (opcional) WhatsApp. Los seis diagramas (contexto, módulos, flujo de voz, despliegue, seguridad y WhatsApp) están en [docs/ARQUITECTURA-VISUAL.md](docs/ARQUITECTURA-VISUAL.md).

## Decisiones clave

- [ADR 0001](docs/adr/0001-mision-del-agente.md): misión del agente, reglas de conversación y herramienta `buscar_sedes`.
- [ADR 0002](docs/adr/0002-stack-y-monolito-modular.md): Node + Next.js en un monolito modular, sin base de datos.
- [ADR 0003](docs/adr/0003-despliegue-en-cloud-run.md): Cloud Run con `max-instances` 2 y afinidad de sesión.
- [ADR 0004](docs/adr/0004-acceso-publico-sin-login.md): acceso público sin login, con controles compensatorios de costo y abuso.

## Correr en local

Requisitos: Node 24 y npm 11.

```bash
cp .env.example .env        # en la raíz del repositorio; poner las claves reales
cd web && npm ci && npm run dev
```

Abrir http://localhost:3000. `npm run dev` lee `../.env`. Sin `DEEPGRAM_API_KEY` y `DEEPSEEK_API_KEY` el servidor termina con código 1.

## Variables de entorno

Solo nombres y propósito; los valores reales nunca se versionan (`.env.example` trae valores falsos).

| Variable | Obligatoria | Propósito |
|---|---|---|
| `DEEPGRAM_API_KEY` | Sí | Autenticación contra la Voice Agent API de Deepgram |
| `DEEPSEEK_API_KEY` | Sí | Clave de DeepSeek: el servidor se la entrega a Deepgram en `Settings` y la usa directamente para el brief |
| `DATOSGOV_APP_TOKEN` | No | Token de aplicación de datos.gov.co (sin él aplican límites más bajos) |
| `WHATSAPP_ACCESS_TOKEN` | No | Token de la WhatsApp Cloud API (secreto `whatsapp-access-token`). Con `WHATSAPP_PHONE_NUMBER_ID` activa el envío de sedes por WhatsApp (RF-024); sin alguno de los dos, la función no existe |
| `WHATSAPP_PHONE_NUMBER_ID` | No | Identificador del número remitente en la Cloud API |
| `WHATSAPP_BUSINESS_ACCOUNT_ID` | No | Cuenta de WhatsApp Business; solo para administrar plantillas, el servidor no lo usa |
| `WHATSAPP_API_VERSION` | No | Versión de la Graph API (`v25.0` por defecto) |
| `WHATSAPP_MAX_PER_HOUR` | No | Tope global de mensajes por hora y por instancia (3 por defecto) |
| `ALLOWED_ORIGINS` | En producción | Orígenes permitidos, separados por comas; vacía en producción rechaza todo |
| `PORT` | No | Puerto HTTP (8080 en el contenedor) |
| `SESSION_MAX_MS` | No | Duración máxima de una sesión de voz (10 min por defecto) |
| `MAX_SESSIONS` | No | Sesiones simultáneas por instancia (8) |
| `MAX_SESSIONS_PER_IP` | No | Sesiones simultáneas por IP (2) |
| `MAX_CONNECTS_PER_MIN` | No | Intentos de conexión por IP y minuto (10) |

## Pruebas

```bash
cd web && npm test                      # unitarias (node --test server/*.test.mjs); las pruebas en vivo se saltan
LIVE=1 node --env-file=../.env --test server/*.test.mjs                  # incluye pruebas contra datos.gov.co y DeepSeek
BASE_URL=<url> ORIGIN=<url> node --env-file=../.env --test tests/integration/proxy.test.mjs   # integración, opt-in: abre sesiones de voz pagadas
```

Carga con k6 (solo contra nuestro propio despliegue), por ejemplo el humo:

```bash
cd web/tests/load
MSYS_NO_PATHCONV=1 docker run --rm -v "$(pwd -W):/scripts" -e BASE_URL=<url> grafana/k6:2.2.0 run /scripts/smoke.js
```

Los demás scripts (`load`, `stress`, `spike`, `ws-limits`, `users-50k`) y sus umbrales están en `web/tests/load/README.md`. La CI (`.github/workflows/ci.yml`) corre lint, pruebas, `npm audit`, build y gitleaks.

## Desplegar

Requiere `gcloud` autenticado con acceso al proyecto y los tres secretos ya creados en Secret Manager (ver cabecera del script).

```bash
bash infra/deploy.sh                # MIN_INSTANCES=1 bash infra/deploy.sh durante la evaluación
```

El script es idempotente: habilita las APIs, crea las cuentas de servicio de ejecución y de build con permisos mínimos, fija la versión de cada secreto, construye con Cloud Build, despliega y verifica `/api/health`.

## Mapa de documentación

| Documento | Contenido |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Contexto, módulos, flujo de un turno de voz, límites de confianza, despliegue |
| [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) | 33 requerimientos con criterio de aceptación |
| [docs/TRACEABILITY.md](docs/TRACEABILITY.md) | Requerimiento, módulo, endpoint, datos, pruebas, estado y evidencia |
| [docs/api/openapi.yaml](docs/api/openapi.yaml) | Contrato HTTP |
| [docs/api/websocket-protocol.md](docs/api/websocket-protocol.md) | Protocolo del WebSocket `/ws/agent` |
| [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md) | Servicios externos: protocolo, autenticación, timeouts, fallos |
| [docs/DATA-MODEL.md](docs/DATA-MODEL.md) | Entidades en memoria, retención y datos sensibles |
| [docs/SECURITY.md](docs/SECURITY.md) | Modelo de amenazas, controles, auditoría y deuda |
| [docs/TEST-PLAN.md](docs/TEST-PLAN.md) | Plan de pruebas |
| [docs/TESTING.md](docs/TESTING.md) | Casos, resultados y break test |
| [docs/CAPACITY.md](docs/CAPACITY.md) | Capacidad medida y camino a 100 000 usuarios |
| [docs/GUIA-QA.md](docs/GUIA-QA.md) | Bitácora por commit para el QA |
| [docs/QA-CONVERSACIONES.md](docs/QA-CONVERSACIONES.md) | Guion de unas 200 frases para intentar romper el agente |
| [docs/PLAN.md](docs/PLAN.md) | Plan original del proyecto |
| [CHANGELOG.md](CHANGELOG.md) | Cambios por versión |

## Qué se generó con IA

El código y la documentación de este repositorio se escribieron con Claude Code bajo dirección y revisión humana: el desarrollador define el alcance, decide y revisa cada cambio, y el QA ejecuta las pruebas y el break test. Nada se da por bueno por haber sido generado: lo verifican las pruebas automáticas (`web/server/*.test.mjs`, integración contra producción, k6), la CI con gitleaks y `npm audit`, y una auditoría de seguridad cuyos hallazgos se corrigieron (ver [docs/SECURITY.md](docs/SECURITY.md)). Lo que `docs/TESTING.md` marca como Pendiente no está verificado. En tiempo de ejecución, el agente usa modelos de lenguaje de terceros (DeepSeek, a través de Deepgram) y puede equivocarse; por eso su prompt le prohíbe diagnosticar y le exige decir que no sabe cuando el dato no está en el documento ni en el registro.
