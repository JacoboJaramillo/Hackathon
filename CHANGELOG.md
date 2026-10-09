# Changelog

Cambios agrupados por paso del plan, el más reciente primero. Las fechas y horas son las del commit (2026-10-09). El proyecto no tiene versiones numeradas; cada grupo se identifica por el paso del plan de `docs/GUIA-QA.md`. Formato inspirado en Keep a Changelog.

## Sin publicar

- Paso 5, en construcción: transcripción diarizada con un segundo stream de STT de Deepgram, sentimiento por intervención con DeepSeek y los mensajes `Transcript` y `Sentiment` del WebSocket (RF-007, RF-008). Aún no hay commit.
- Documentación faltante de CLAUDE.md sección 5: `README.md`, `CHANGELOG.md`, `docs/SECURITY.md`, `docs/TRACEABILITY.md`, `docs/INTEGRATIONS.md`, `docs/DATA-MODEL.md`.

## Pruebas, capacidad y guion de QA

- `a9f51ce` (11:56) docs: guion de unas 200 frases para intentar romper el agente por voz (`docs/QA-CONVERSACIONES.md`).
- `6308611` (11:48) test: prueba de 50 000 usuarios contra producción (`web/tests/load/users-50k.js`) y modelo de capacidad a 100 000 usuarios (`docs/CAPACITY.md`). Resultado medido: 51 749 recorridos, 0 errores, p95 191 ms; el estrés llega a unas 770 peticiones por segundo servidas y luego solo hay 429 de Cloud Run.
- `e0037e1` (11:23) y `1bcec59` (11:23) test y docs: resultados R-013 a R-015 del paso 3 en `docs/TESTING.md` y su entrada en la guía de QA.

## Seguridad

- `050e436` (11:37) security: correcciones de la auditoría del paso 3. Lectura de PDF y DOCX en un worker con 192 MB y 10 s de plazo (bombas de descompresión), presupuesto absoluto de 20 s para recibir el cuerpo de la subida (slowloris), neutralización de variantes de la etiqueta `<documento>`, poda del limitador y límite por bloque /64 en IPv6. Además, mensajes claros del flujo de permiso de micrófono.
- `05e4634` (11:42) fix: el botón Hablar queda en "Cargando..." hasta que la página termina de cargar su JavaScript, para no perder clics.

## Paso 4: conversación por voz completa

- `603d42b` (11:32) feat: panel de voz con transcripción en vivo por rol, interrupción (barge-in), estados de la conversación y tarjetas de sedes con dirección, teléfono, naturaleza, nivel y capacidades.

## Paso 3: documento y brief

- `5e7cbdc` (11:17) feat: `POST /api/document` (PDF, DOCX y TXT por firma real, hasta 20 MB, 5 cargas por minuto y 1 simultánea por IP), almacén en memoria de 30 minutos, brief de 3 a 5 preguntas con DeepSeek y sesiones de voz con `?doc=<id>` que tratan el documento como datos. DOCX se lee con `fflate` en lugar de `mammoth`, que traía una vulnerabilidad.

## Paso 2: esqueleto desplegado, CI e infraestructura

- `06434a0` (10:54) feat: documentos de arquitectura con diagramas, CI de GitHub Actions (lint, pruebas, `npm audit`, build y gitleaks), `infra/deploy.sh` reproducible y cuentas de servicio de build y ejecución con mínimo privilegio.
- `2015929` (10:41) feat: servidor propio con proxy de voz `/ws/agent`, herramienta `buscar_sedes` sobre datos.gov.co, cabeceras de seguridad, límites de admisión (Origin, tasa, cupo por IP y global), despliegue en Cloud Run, suite de integración y pruebas de carga con k6.

## Paso 1: prueba del riesgo mayor

- `34624ca` (10:08), `2e8dd04` (10:07) y `a35f928` (09:59) docs: ADR 0001 define la misión del agente y el diseño conversacional; el agente cita solo el documento subido y no menciona la fecha de corte de los datos.
- `0db2d37` (09:39) test: spike de Deepgram Voice Agent en español con DeepSeek y la herramienta de IPS. Latencia de 1,8 a 2,7 s por turno; plan A confirmado.

## Paso 0: repositorio y secretos

- `68bff48` (09:31) docs: bitácora por commit para el QA (`docs/GUIA-QA.md`) como regla del proyecto.
- `2a4b8f2` (09:28) docs: el despliegue apunta al proyecto dedicado `agente-vocal-hackaton`.
- `c77a282` (09:25) chore: repositorio inicial con la plantilla de Next.js e higiene de secretos (`.env` ignorado, `.env.example` con valores falsos).
