# Trazabilidad de requerimientos

Matriz de `CLAUDE.md` sección 5.3. Fuentes: IDs y criterios de `docs/REQUIREMENTS.md`; casos, estados y resultados (R-xxx) de el historial de git de `docs/TESTING.md` (última versión en el commit 6eb3dd7, resumida en `docs/ARQUITECTURA.md` sección 11 Pruebas) y `docs/PRUEBAS-AUDIO.md` para voz; módulos de `docs/ARQUITECTURA.md`; endpoints de `docs/api/openapi.yaml` y `docs/api/websocket-protocol.md`; entidades de `docs/ARQUITECTURA.md` sección 7.

Estados:

- Aprobado: todos los casos del requerimiento figuran Aprobado en el historial de git de `docs/TESTING.md` (última versión en el commit 6eb3dd7, resumida en `docs/ARQUITECTURA.md` sección 11 Pruebas).
- Parcial: al menos un caso Aprobado y al menos uno Pendiente.
- Pendiente: ningún caso Aprobado en el historial de git de `docs/TESTING.md` (última versión en el commit 6eb3dd7, resumida en `docs/ARQUITECTURA.md` sección 11 Pruebas). Puede haber pruebas automáticas de la lógica (se citan en Evidencia) pero el caso de aceptación no se ha ejecutado.
- En construcción: el módulo no está terminado (paso 5).

Abreviaturas de módulo: SRV = `web/server.mjs`; LIM = `web/server/limits.mjs`; SET = `web/server/agent-settings.mjs`; IPS = `web/server/ips.mjs`; DOC = `web/server/documents.mjs` y `parse-worker.mjs`; BRF = `web/server/brief.mjs`; UI = `web/src/app/` (componentes `DocumentUpload`, `VoicePanel`, `SedesPanel`); NXT = `web/next.config.mjs`; WAP = `web/server/whatsapp.mjs`.

## 1. Requerimientos funcionales

| Requerimiento | Componente o módulo | Endpoint | Entidad de datos | Casos de prueba | Estado | Evidencia |
|---|---|---|---|---|---|---|
| RF-001 Carga de documento | DOC, SRV (`handleUpload`), LIM (instancia `uploads`), UI `DocumentUpload` | `POST /api/document` | UploadResponse, DocumentRecord | CP-023, CP-024, CP-025, CP-026, CP-066, CP-067, CP-068, CP-069 | Parcial | R-013 (CP-023), R-014 (CP-024, CP-026, CP-067). Pruebas `RF-001 ...` en `documents.test.mjs` y `proxy.test.mjs`. CP-025, CP-066, CP-068 y CP-069 Pendiente (CP-068 se observó una vez en R-014) |
| RF-002 Respuestas ancladas al documento | SET (`buildSettings`, `fenceSafe`), SRV | `GET /ws/agent?doc=<id>` | DocumentRecord, SessionState | CP-028, CP-070, CP-071 | Parcial | R-014 (CP-070 Aprobado), R-015 (CP-071 parcial por suite automática). CP-028 Pendiente. Pruebas `RF-002 ...` en `agent-settings.test.mjs` y `proxy.test.mjs` |
| RF-003 Brief inicial | BRF, SRV, UI `DocumentUpload` | `POST /api/document` | BriefDTO, DocumentRecord | CP-027 | Aprobado | R-013: brief en 1,6 s (TXT), 1,8 s (PDF), 1,2 s (DOCX). Pruebas `RF-003 ...` en `brief.test.mjs` y `documents.test.mjs` |
| RF-004 Conversación por voz | SRV, SET, UI `VoicePanel` | `GET /ws/agent` | SessionState | CP-004, CP-030 | Parcial | R-004 (spike: 1,8 a 2,7 s). R-022: producción p50 2,0 s, p90 2,1 s en 16 turnos automáticos; falta la corrida con micrófono real |
| RF-005 Interrupción (barge-in) | UI `VoicePanel` (descarta el audio en cola al recibir `UserStartedSpeaking`), SRV (reenvía el evento) | `GET /ws/agent` | SessionState | CP-031 | Aprobado | R-023: corte a 1,09 s (p50), dentro del criterio de 1,5 s (ajustado desde 300 ms); el agente atiende la nueva frase en 6 de 6 y en la prueba manual. Implementado en `603d42b` |
| RF-006 Honestidad | SET (`BASE_PROMPT`) | `GET /ws/agent` | SessionState | CP-004, CP-012 | Parcial | R-004 (pregunta fuera del documento respondida como desconocida). CP-012 Pendiente |
| RF-007 Transcripción diarizada | En construcción (paso 5): segundo stream de STT de Deepgram, mensaje `Transcript` | `GET /ws/agent` | TranscriptTurn (por definir) | CP-032 | En construcción | Hoy solo hay transcripción por rol (`ConversationText`, "Tú" y "Agente") sin separar voces; no cumple RF-007 |
| RF-008 Sentimiento y emociones | En construcción (paso 5): sentimiento por intervención con DeepSeek, mensaje `Sentiment` | `GET /ws/agent` | SentimentLabel (por definir) | CP-033 | En construcción | Sin ejecución del caso |
| RF-009 Dataset IPS por API | IPS, SRV (`handleFunctions`) | `GET /ws/agent` (evento `ToolResult`) | SedeDTO, MunicipioCache | CP-001, CP-004, CP-021, CP-022 | Parcial | R-001 (datos.gov.co devuelve 41.427 IPS), R-004 (Leticia con 2 IPS públicas, coincide con la API). Prueba `RF-009 spoken question triggers buscar_sedes` en `proxy.test.mjs`. CP-021 y CP-022 Pendiente |
| RF-010 Necesidad a tipo de atención | IPS (`NEEDS`, `validateArgs`) | `GET /ws/agent` | SedeDTO | CP-006, CP-019 | Pendiente | Pruebas `NEEDS has the contract keys...` y `validateArgs rejects bad input` en `ips.test.mjs` (sin ID en el nombre); los casos CP-006 y CP-019 no están ejecutados |
| RF-011 Municipio aproximado | IPS (`resolveMunicipio`, `normalize`) | `GET /ws/agent` | MunicipioCache | CP-009, CP-020 | Pendiente | Pruebas `resolveMunicipio fuzzy matches` y `normalize strips accents...` en `ips.test.mjs`; casos no ejecutados |
| RF-012 Alternativa por departamento | IPS (`buscarSedes`, campo `alcance`) | `GET /ws/agent` | SedeDTO | CP-008 | Pendiente | Prueba `falls back to departamento when municipio has no sedes` en `ips.test.mjs`; caso no ejecutado |
| RF-013 Sin datos personales | IPS (lista blanca `COLUMNS`) | `GET /ws/agent` | SedeDTO | CP-011 | Pendiente | Prueba `aggregates by sede, sorts by capacity, caps at 20, hides personal data` en `ips.test.mjs`; caso no ejecutado |
| RF-014 Emergencia primero | SET (`BASE_PROMPT`) | `GET /ws/agent` | SessionState | CP-005 | Pendiente | Regla en el prompt; sin ejecución |
| RF-015 Una pregunta de orientación | SET (`BASE_PROMPT`) | `GET /ws/agent` | SessionState | CP-006 | Pendiente | Regla en el prompt; sin ejecución |
| RF-016 Honestidad con especialidades | SET (`BASE_PROMPT`) | `GET /ws/agent` | SessionState | CP-007 | Pendiente | Regla en el prompt; sin ejecución |
| RF-017 No mencionar la fecha de corte | SET (`BASE_PROMPT`) | `GET /ws/agent` | SessionState | CP-014 | Pendiente | Regla en el prompt; sin ejecución |
| RF-018 Cita solo del documento | SET (`BASE_PROMPT`) | `GET /ws/agent?doc=<id>` | DocumentRecord, SessionState | CP-015, CP-071 | Pendiente | R-015 observó "según tu documento" en la suite automática (CP-071 parcial); ningún caso completo Aprobado |
| RF-019 Salida de sedes | SET (voz, máximo 3), UI `SedesPanel` (tarjetas), SRV (`ToolResult`) | `GET /ws/agent` (evento `ToolResult`) | SedeDTO | CP-016 | Pendiente | Implementado en `603d42b`; sin ejecución |
| RF-020 Fuera de la misión | SET (`BASE_PROMPT`) | `GET /ws/agent` | SessionState | CP-010 | Pendiente | Regla en el prompt; sin ejecución |
| RF-021 Documento que no es de salud | SET (`buildSettings`), IPS | `GET /ws/agent?doc=<id>` | DocumentRecord | CP-013 | Pendiente | Regla en el prompt; sin ejecución |
| RF-022 Sin diagnóstico ni comparaciones | SET (`BASE_PROMPT`) | `GET /ws/agent` | SessionState | CP-017 | Pendiente | Regla en el prompt; sin ejecución |
| RF-023 Estilo de voz | SET (`BASE_PROMPT`, saludo) | `GET /ws/agent` | SessionState | CP-018 | Pendiente | Regla en el prompt; sin ejecución |
| RF-024 Envío opcional de sedes por WhatsApp | WAP (`validateArgs`, `buildParams`, `createWhatsApp`), SRV (`handleFunctions`, herramienta `enviar_whatsapp`), SET (`WHATSAPP_PROMPT`) | `GET /ws/agent` (herramienta del lado del servidor, sin mensaje nuevo al navegador) | SessionState (última búsqueda), WhatsAppWindows | CP-074 a CP-085 | Pendiente | Pruebas unitarias en `web/server/whatsapp.test.mjs`; sin resultados reportados aún. Plantilla `sedes_salud_v1` pendiente de aprobación de Meta |

## 2. Requerimientos no funcionales

| Requerimiento | Componente o módulo | Endpoint | Entidad de datos | Casos de prueba | Estado | Evidencia |
|---|---|---|---|---|---|---|
| RNF-001 Despliegue público | `infra/deploy.sh`, Cloud Run | `GET /api/health`, `GET /` | Ninguna | CP-038 | Pendiente | URL publicada y respondiendo (usada por R-006 a R-012); el caso desde otro equipo y otra red no está registrado |
| RNF-002 Experiencia de usuario | UI `VoicePanel` | `GET /ws/agent` | SessionState | CP-034, CP-035 | Pendiente | Estados Conectando, Te escucho, Pensando, Hablando implementados en `603d42b`; casos no ejecutados. R-007 cubre solo la página inicial |
| RNF-003 Robustez y disponibilidad | UI, `infra/deploy.sh` (probes, `min-instances`) | `GET /api/health` | Ninguna | CP-036, CP-037, CP-040 | Pendiente | `/api/health` medido por k6 (R-008 a R-011) pero los casos de 500 ms, reconexión y arranque en frío no están registrados |
| RNF-004 Seguridad del WebSocket y abuso | LIM, SRV, DOC, SET (`fenceSafe`), IPS | `GET /ws/agent`, `POST /api/document` | LimiterCounters, DocumentRecord | CP-029, CP-041 a CP-048, CP-057, CP-067, CP-068, CP-070 | Parcial | R-005 (CP-041, 042, 043, 045), R-014 (CP-067, CP-070), R-012. Pendiente: CP-029, 044, 046, 047, 048, 057, 068. Pruebas `RNF-004 ...` en `limits.test.mjs`, `documents.test.mjs`, `agent-settings.test.mjs`, `proxy.test.mjs` |
| RNF-005 Cabeceras de seguridad | NXT | Todas las páginas | Ninguna | CP-049, CP-050, CP-051 | Parcial | R-006 (CP-049), R-007 (CP-050). CP-051 Pendiente |
| RNF-006 Secretos y exposición | `infra/deploy.sh`, `.gitignore`, `web/.dockerignore`, SRV | Todas | Ninguna | CP-002, CP-052, CP-053, CP-054, CP-055, CP-056 | Parcial | R-002 (CP-002), R-006 (CP-052; también `/.git/config` y un `.map` dan 404). CP-053 a CP-056 Pendiente |
| RNF-007 Rendimiento y carga | `web/tests/load/*.js` | `GET /`, `GET /api/health`, `/ws/agent` (límites) | Ninguna | CP-058, CP-059, CP-060, CP-061, CP-062, CP-072, CP-073 | Aprobado | R-008 a R-012, R-016 (51 749 recorridos, 0 errores, p95 191 ms), R-017 (solo 429, ningún 5xx). Detalle en `docs/ARQUITECTURA.md` sección 10 |
| RNF-008 README de una página | `README.md` | Ninguno | Ninguna | CP-039 | Pendiente | README escrito; falta que un tercero lo siga en menos de 15 min |
| RNF-009 Dependencias y repositorio limpios | CI (`.github/workflows/ci.yml`), `package-lock.json` | Ninguno | Ninguna | CP-003, CP-064, CP-065 | Parcial | R-003 (CP-003). CP-064 y CP-065 Pendiente; la CI corre gitleaks y `npm audit` en cada push |
| RNF-010 Regresión automatizada | `web/server/*.test.mjs`, CI | Ninguno | Ninguna | CP-063 | Pendiente | `npm test` reportó 52 pruebas en verde y 3 en vivo omitidas (`docs/GUIA-QA.md`, commit `050e436`); no hay fila R-xxx para CP-063 |

## 3. Revisión de la matriz

Revisión hecha contra `docs/REQUIREMENTS.md` y el historial de git de `docs/TESTING.md` (commit 6eb3dd7).

Requerimientos sin casos de prueba: ninguno. Los 34 (RF-001 a RF-024 y RNF-001 a RNF-010) tienen al menos un caso en el historial de git de `docs/TESTING.md` (última versión en el commit 6eb3dd7, resumida en `docs/ARQUITECTURA.md` sección 11 Pruebas).

Casos de prueba sin requerimiento: ninguno. Los 85 casos (CP-001 a CP-085) apuntan a un requerimiento existente en la columna "Req." de `docs/TESTING.md` (historial de git, commit 6eb3dd7).

Discrepancias que conviene corregir en los documentos fuente:

- La columna "Casos" del RNF-007 en `docs/REQUIREMENTS.md` lista CP-058 a CP-062 y no incluye CP-072 y CP-073, que sí apuntan a RNF-007 en el historial de git de `docs/TESTING.md` (última versión en el commit 6eb3dd7, resumida en `docs/ARQUITECTURA.md` sección 11 Pruebas). Esta matriz los incluye.
- La sección 3 de `docs/REQUIREMENTS.md` dice 65 casos (CP-001 a CP-065); `docs/TESTING.md` (historial de git) tiene 73 (hasta CP-073).
- Pruebas automáticas sin ID de requerimiento en el nombre: las de `web/server/ips.test.mjs` (mapeo implícito a RF-009 a RF-013). `CLAUDE.md` 5.3 pide el ID en el nombre; queda como mejora.
- Las pruebas k6 y el guion `docs/QA-CONVERSACIONES.md` se asocian a requerimientos por los casos CP-058 a CP-062, CP-072, CP-073 y por la sección correspondiente del guion; el guion no lleva IDs.

Resumen de estados: 2 Aprobados (RF-003, RNF-007); 9 Parciales (RF-001, RF-002, RF-004, RF-006, RF-009, RNF-004, RNF-005, RNF-006, RNF-009); 2 En construcción (RF-007, RF-008); 20 Pendientes. Un requerimiento Pendiente no está probado, aunque el código exista.
