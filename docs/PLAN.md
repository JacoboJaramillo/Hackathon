# Plan de trabajo: Reto 01, Agente Vocal Cognitivo

> Documento inicial. El stack (FastAPI), la ruta `/ws/session`, SODA3 y los tamaños de Cloud Run quedaron reemplazados: la fuente de verdad es `docs/ARCHITECTURE.md` y los ADR 0002 a 0004.

Fuente: `V2.xlsx` (hoja "01 RETO"). Equipo: 1 desarrollador + 1 QA. Despliegue: Google Cloud, proyecto `agente-vocal-hackaton`.

## 1. Qué hay que construir

Una URL pública donde el jurado:

1. Abre la página sin instalar nada (P1).
2. Sube un documento sorpresa (P2).
3. Recibe un brief: de qué trata y entre 3 y 5 preguntas sugeridas (P3).
4. Conversa por voz con baja latencia: resumen, detalle fino y una pregunta fuera del documento, a la que el agente debe responder que no lo sabe (P4).
5. Ve en vivo la transcripción diarizada con marcas de tiempo y un panel de sentimiento y emociones (P5).
6. Pregunta por la arquitectura (P6).

Además, el objetivo exige consumir por API el dataset "Relación de IPS públicas y privadas" de datos.gov.co (SODA3, con token, más de 41.000 filas y paginación obligatoria).

## 2. Huecos en los requerimientos (pedir al organizador)

- La hoja dice "los ocho requisitos" pero solo lista R08. R01 a R07 están ausentes; abajo se infieren.
- Los pesos suman 70 %. Falta el 30 % y la hoja "02 CRITERIOS".
- No queda claro cómo se combina el dataset IPS con el documento sorpresa. Decisión: soportar ambos. El dataset queda disponible como fuente consultable por el agente y el documento subido es la fuente principal de la sesión.
- Faltan los formatos de documento esperados. Supuesto: PDF, DOCX, TXT/MD, CSV/XLSX.

## 3. Requerimientos inferidos

| ID | Requerimiento | Criterio de aceptación | Origen |
|---|---|---|---|
| RF-01 | Carga de documento | Acepta PDF, DOCX, TXT, MD, CSV y XLSX de hasta 20 MB; si el formato no es soportado, error claro | P2 |
| RF-02 | Indexación como única fuente | Respuestas basadas solo en el documento; cita el fragmento usado | Descripción |
| RF-03 | Brief inicial | Resumen y de 3 a 5 preguntas pertinentes en menos de 30 s | P3 |
| RF-04 | Conversación por voz | STT y TTS en streaming; primera palabra hablada en 1,5 s o menos tras terminar la pregunta (p50) | P4, 20 % |
| RF-05 | Interrupciones (barge-in) | El agente deja de hablar en 300 ms o menos cuando el usuario habla | 20 % |
| RF-06 | Honestidad | Ante una pregunta fuera del documento responde que no está en el documento, sin inventar | P4 |
| RF-07 | Transcripción diarizada | Texto en vivo, hablante separado (Hablante 1, Hablante 2, Agente) y marca de tiempo | P5, 15 % |
| RF-08 | Sentimiento y emociones | Panel por intervención y tendencia, actualizado en 2 s o menos | P5 |
| RF-09 | Dataset IPS por API | Consulta SODA3 autenticada con paginación o filtros; el agente responde preguntas sobre IPS | Objetivo |
| RNF-01 | Despliegue público | URL HTTPS estable, código en GitHub, sin instalación local | R08, 10 % |
| RNF-02 | UX | Interfaz clara, estados visibles (escuchando, pensando, hablando), sin errores en consola | 25 % |
| RNF-03 | Robustez | Sin arranque en frío durante la demo; recuperación si se cae el WebSocket | M07 |
| RNF-04 | Seguridad | Claves solo en el servidor, límites de abuso y costo, OWASP (ver CLAUDE.md sección 4) | CLAUDE.md |
| RNF-05 | README de una página | Stack, arquitectura, decisiones y qué se generó con IA | E03, M04 |

## 4. Arquitectura propuesta

Monolito modular en un solo servicio de Cloud Run. Microservicios no aportan puntos y suman riesgo de latencia y despliegue.

```
Navegador (React)
  micrófono -> AudioWorklet PCM 16 kHz -> WebSocket /ws/session
  <- eventos: transcript, sentiment, agent_text, agent_audio (chunks)
Cloud Run (FastAPI, Python)
  modules/ingest     parseo (pypdf, python-docx, openpyxl) + chunking + embeddings en memoria
  modules/brief      LLM: resumen + 3 a 5 preguntas
  modules/stt        Deepgram streaming (diarize, interim, endpointing, timestamps)
  modules/agent      RAG + LLM en streaming; herramienta query_ips()
  modules/tts        TTS en streaming; cancelable (barge-in)
  modules/sentiment  LLM rápido por intervención -> {sentimiento, emociones[]}
  modules/ips        cliente SODA3 (token, $limit/$offset, SoQL, caché)
Servicios externos
  Deepgram (STT con diarización) | LLM (Claude Haiku 5.5 o Gemini Flash vía Vertex) | TTS (ElevenLabs Flash, Deepgram Aura o Cartesia) | datos.gov.co SODA3
GCP
  Cloud Run (WebSocket, session affinity, min-instances=1 en la demo) | Artifact Registry | Cloud Build | Secret Manager | Budget alert
```

Decisiones clave (cada una lleva su ADR):

- **Pipeline en cascada (STT, LLM, TTS) en vez de speech-to-speech.** La diarización vale 15 % y necesita un STT con hablantes; la cascada da control de la latencia, del barge-in y de la honestidad.
- **El audio pasa por el backend.** Las claves nunca llegan al navegador, a cambio de un salto extra de red. Si la latencia no alcanza, usar tokens temporales de Deepgram para conectar el navegador directo.
- **Vectores en memoria, sin base de datos.** Un documento por sesión, cientos de chunks; numpy alcanza. `ponytail:` estado en memoria por instancia, requiere session affinity; pasar a Memorystore si se escala.
- **IPS mediante herramienta (tool calling), no RAG.** 41.000 filas estructuradas: el LLM genera filtros y la herramienta hace una consulta SoQL paginada. No se copia el dataset.
- **Agente en la transcripción:** sus intervenciones se etiquetan desde el texto del TTS, no desde el micrófono. El navegador usa `echoCancellation: true` para que el STT no transcriba la voz del agente.
- **Región `us-east1`:** cerca de los proveedores de IA y latencia razonable a Colombia.

## 5. Plan paso a paso

La regla es desplegar primero: hay URL pública desde el paso 1 y cada paso termina desplegado.

| Paso | Qué | Quién | Paralelo | Hecho cuando |
|---|---|---|---|---|
| 0 | Preparación: cuentas y claves (Deepgram, LLM, TTS, token datos.gov.co), repositorio GitHub, `gcloud config set project agente-vocal-hackaton`, budget alert | Ambos | Sí | Claves en Secret Manager, repositorio creado |
| 1 | Esqueleto: FastAPI + React estático en un contenedor, Dockerfile, despliegue a Cloud Run | Dev | QA escribe casos desde la tabla de requerimientos | URL HTTPS responde `/health` y la página |
| 2 | Ingesta y brief (RF-01, 02, 03) | Dev | QA prepara documentos de prueba variados (PDF escaneado, DOCX largo, CSV, archivo corrupto) | Subir documento devuelve brief y preguntas |
| 3 | Bucle de voz: micrófono, WebSocket, Deepgram, RAG + LLM, TTS (RF-04, 06) | Dev | Agentes en paralelo: frontend de audio y backend de pipeline, con contrato de eventos fijo | Pregunta hablada, respuesta hablada con el umbral de latencia |
| 4 | Barge-in y estados de UI (RF-05, RNF-02) | Dev | QA mide latencias con cronómetro y registros | El agente se corta al hablar encima |
| 5 | Panel de diarización (RF-07) | Dev | Paralelo con el paso 6 | Hablantes separados con marca de tiempo |
| 6 | Sentimiento y emociones (RF-08) | Dev (agente) | Paralelo con el paso 5 | Panel actualizándose en vivo |
| 7 | Dataset IPS (RF-09) | Dev (agente) | Paralelo con los pasos 5 y 6 | "¿Cuántas IPS de nivel 3 hay en Antioquia?" responde con datos reales |
| 8 | Seguridad y costos (RNF-04): límites por IP, tamaño de archivo, duración de sesión, headers, CORS, `/web-security-audit` | Dev + QA | Auditoría en pistas paralelas | Auditoría sin hallazgos críticos ni altos |
| 9 | Pruebas: unitarias, integración, contrato del WebSocket, E2E con Playwright, carga corta con k6 sobre la ingesta, regresión en CI | QA | Sí | `TEST-PLAN.md` y matriz de trazabilidad completas |
| 10 | Documentación: README, ARCHITECTURE, diagramas FossFLOW, DATA-MODEL, INTEGRATIONS, ADR, declaración de uso de IA | Dev (agente) + QA | Sí | Todo enlazado desde el README |
| 11 | Ensayo de demo: guion P1 a P6 tres veces desde otro equipo y otra red, con un documento desconocido | Ambos | No | Tres corridas sin fallos; plan B ensayado |
| 12 | Congelar: `min-instances=1`, versión etiquetada, URL registrada en el formulario | Dev | No | URL entregada |
| 13 | Desmontaje después del evento (sección 7) | Dev | No | Sin recursos que generen costo |

## 6. Despliegue en GCP

```bash
gcloud config set project agente-vocal-hackaton
gcloud config set run/region us-east1

# Secretos (una vez por clave)
# Ya creados: deepseek-api-key, deepgram-api-key, datosgov-app-token (us-east1)

# Build y despliegue desde el código fuente (Cloud Build + Artifact Registry)
gcloud run deploy agente-vocal \
  --source . \
  --allow-unauthenticated \
  --session-affinity \
  --timeout 3600 \
  --min-instances 0 --max-instances 3 \
  --cpu 2 --memory 2Gi --concurrency 20 \
  --set-secrets DEEPGRAM_API_KEY=deepgram-api-key:latest,DEEPSEEK_API_KEY=deepseek-api-key:latest,DATOSGOV_APP_TOKEN=datosgov-app-token:latest

# Solo durante la ventana de evaluación
gcloud run services update agente-vocal --min-instances 1
```

- La cuenta de servicio de Cloud Run necesita `roles/secretmanager.secretAccessor` sobre los secretos.
- Budget alert en Billing con un tope bajo (por ejemplo 20 USD) para avisar antes de gastar de más.
- `max-instances` bajo limita el costo ante abuso. El rate limit va en la aplicación.

## 7. Desmontaje (después del evento)

**Irreversible.** Borra el servicio y sus datos. Hacerlo solo después de que el jurado termine de calificar.

```bash
gcloud projects delete agente-vocal-hackaton
```

Esto borra en un solo paso el servicio, las imágenes, los secretos y los buckets, porque el proyecto se creó solo para el evento.

Después: revocar las claves de los proveedores (Deepgram, DeepSeek, datos.gov.co) y revisar la facturación a las 24 horas.

## 8. Riesgos y plan B

| Riesgo | Mitigación |
|---|---|
| La URL falla en la evaluación (un solo reintento de 2 min) | `min-instances=1`, una revisión anterior estable lista para restaurar el tráfico, chequeo de salud justo antes |
| Eco: el STT transcribe la voz del agente | `echoCancellation`; pausar el envío al STT mientras el agente habla, salvo detección de voz fuerte para el barge-in |
| PDF escaneado sin texto | Detectarlo y avisar; OCR solo si sobra tiempo |
| Latencia alta | Modelos rápidos, streaming de punta a punta, TTS por frases, región cercana |
| Cuota o costo de las APIs | Límites por sesión y por IP, budget alert, `max-instances` |
| Diarización mezcla hablantes | Probar con 2 o 3 voces reales en el ensayo; mostrar confianza |
| datos.gov.co caído o lento | Caché de las consultas frecuentes y mensaje honesto al usuario |
