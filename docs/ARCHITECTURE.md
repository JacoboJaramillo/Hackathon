# Arquitectura

Documento de arquitectura de "¿Dónde me atienden?", el agente de voz del Reto 01 de Kognia Labs. Describe el sistema tal como está en el código (`web/server.mjs`, `web/server/*.mjs`, `web/next.config.mjs`, `web/Dockerfile`) y marca como **planeado** lo que aún no está construido. Las fuentes de los diagramas están en `docs/diagrams/` y se repiten aquí para que GitHub los renderice.

Documentos relacionados: misión del agente en `docs/adr/0001-mision-del-agente.md`, decisiones de stack, despliegue y acceso en los ADR 0002 a 0004, contrato HTTP en `docs/api/openapi.yaml`, protocolo del WebSocket en `docs/api/websocket-protocol.md`, requerimientos en `docs/REQUIREMENTS.md`.

## 1. Propósito

Una persona abre una URL pública, habla en español y el agente le dice en qué sede de salud de su municipio puede recibir la atención que necesita. Para eso consulta en vivo el registro oficial de IPS de datos.gov.co (dataset `s2ru-bqt6`). Si la persona sube un documento (por ejemplo una orden médica, o el documento sorpresa del jurado), el agente responde sobre él con rigor y sin inventar (RF-001 a RF-006, RF-009).

## 2. Atributos de calidad priorizados

| Prioridad | Atributo | Qué significa aquí | Cómo se logra | Requerimiento |
|---|---|---|---|---|
| 1 | Latencia de conversación | Del fin de la voz del usuario al primer audio del agente, p50 de 2,0 s o menos | Un solo salto de proxy, Deepgram Voice Agent hace STT, orquestación y TTS en streaming; audio crudo sin transcodificar; región `us-east1` | RF-004, RF-005 |
| 2 | Seguridad de las claves | Ninguna clave llega al navegador | El mensaje `Settings` (que lleva la clave de DeepSeek) lo arma y envía solo el servidor; secretos en Secret Manager | RNF-006 |
| 3 | Control de costo | Cada sesión abre una conexión pagada; el abuso no puede disparar la factura | Admisión antes del handshake (Origin, cupos por IP y global, tasa), sesión de 10 min, `max-instances` 2 | RNF-004 |
| 4 | Honestidad | El agente no inventa: lo que no está en el documento ni en el registro, no lo sabe | Prompt con reglas del ADR 0001, herramienta con salida estructurada, `temperature` 0,2 | RF-006, RF-016, RF-018 |

Atributos de segundo orden: disponibilidad durante la ventana del jurado (RNF-003) y simplicidad operativa para un equipo de dos personas.

## 3. Contexto del sistema

```mermaid
flowchart LR
  usuario["Ciudadano o jurado - navegador con micrófono"]
  sistema["¿Dónde me atienden? - servicio agente-vocal en Cloud Run"]
  deepgram["Deepgram Voice Agent API - STT nova-3 y TTS aura-2-celeste-es"]
  deepseek["DeepSeek API - modelo deepseek-chat"]
  datosgov["datos.gov.co - dataset IPS s2ru-bqt6"]

  usuario -- "HTTPS: página y GET /api/health" --> sistema
  usuario -- "WSS /ws/agent: audio PCM y eventos" --> sistema
  sistema -- "WSS: Settings, audio y FunctionCallResponse" --> deepgram
  deepgram -- "HTTPS: chat completions con la clave de DeepSeek" --> deepseek
  sistema -- "HTTPS: consulta SoQL con X-App-Token" --> datosgov
```

Fuente: `docs/diagrams/contexto.mmd`.

Lectura de izquierda a derecha, siguiendo a un usuario real: la persona abre la página por HTTPS y, al iniciar la conversación, su navegador abre un WebSocket seguro a `/ws/agent` en nuestro servicio. El servicio no procesa la voz por sí mismo: abre una segunda conexión WebSocket hacia la Voice Agent API de Deepgram, que transcribe (nova-3, español), consulta al modelo de lenguaje (DeepSeek, `deepseek-chat`, a través de su endpoint compatible con OpenAI) y sintetiza la respuesta (aura-2-celeste-es). Cuando el modelo decide buscar sedes, Deepgram le pide la función a nuestro servidor, que consulta datos.gov.co y devuelve el resultado. DeepSeek nunca es llamado directamente por nuestro servidor en el flujo de voz: lo llama Deepgram con la clave que nuestro servidor le entrega en `Settings`.

## 4. Contenedores y módulos

Es un monolito modular: un solo proceso Node 24 en un solo contenedor sirve las páginas de Next.js y el proxy de voz (decisión en ADR 0002).

```mermaid
flowchart LR
  subgraph nav["Navegador - no confiable"]
    ui["Interfaz React - carga y brief; voz y tarjetas planeadas"]
    mic["Captura de micrófono - PCM 16 kHz linear16"]
  end

  subgraph run["Contenedor único en Cloud Run - Node 24"]
    srv["server.mjs - servidor HTTP y proxy WebSocket /ws/agent"]
    nextjs["Next.js 15.5 - páginas y GET /api/health"]
    limits["server/limits.mjs - admisión: Origin, cupos y tasa"]
    settings["server/agent-settings.mjs - prompt y mensaje Settings"]
    ips["server/ips.mjs - herramienta buscar_sedes"]
    docmod["server/documents.mjs y brief.mjs - texto en memoria y brief"]
    diar["Transcripción diarizada y sentimiento - planeado"]
  end

  deepgram["Deepgram Voice Agent API"]
  deepseek["DeepSeek API"]
  datosgov["datos.gov.co SODA2"]

  ui -- "HTTPS" --> nextjs
  mic -- "WSS binario" --> srv
  srv -- "eventos permitidos y audio 24 kHz" --> ui
  srv --> limits
  srv --> settings
  srv --> ips
  ui -- "POST /api/document" --> srv
  srv --> docmod
  docmod -- "HTTPS brief" --> deepseek
  srv -.-> diar
  srv -- "WSS con Authorization Token" --> deepgram
  deepgram -- "HTTPS" --> deepseek
  ips -- "HTTPS GET con X-App-Token" --> datosgov
  diar -.-> deepgram
  diar -.-> deepseek
```

Fuente: `docs/diagrams/contenedores.mmd`.

Lectura de izquierda a derecha: el micrófono del navegador produce PCM de 16 kHz que entra por `/ws/agent` a `server.mjs`. Antes de aceptar la conexión, `server.mjs` consulta a `limits.mjs`. Aceptada la sesión, toma el `Settings` de `agent-settings.mjs`, abre la conexión a Deepgram y queda como relevo en ambos sentidos. Cuando Deepgram pide `buscar_sedes`, `server.mjs` delega en `ips.mjs`, que habla con datos.gov.co. La carga del documento entra por `POST /api/document`: `server.mjs` la pasa a `documents.mjs` (tipo por firma, extracción de texto, almacén en memoria con vencimiento) y a `brief.mjs` (resumen y preguntas con DeepSeek). Las líneas punteadas son módulos planeados.

| Módulo | Archivo | Responsabilidad | Interfaz pública | Estado |
|---|---|---|---|---|
| Servidor y proxy de voz | `web/server.mjs` | Arranca Next.js, atiende el upgrade a `/ws/agent`, abre una conexión a Deepgram por sesión, filtra mensajes en ambos sentidos, ejecuta funciones del agente, registra eventos | HTTP en `PORT`; WebSocket `/ws/agent` (ver `docs/api/websocket-protocol.md`) | Construido |
| Control de admisión | `web/server/limits.mjs` | Lista blanca de Origin, IP del cliente, cupo por IP, cupo global y tasa de conexiones por minuto | `createLimiter({ perIp, global, ratePerMin })` con `admit(ip)` que devuelve `{ ok, release }` o `{ ok: false, status, reason }`; `isAllowedOrigin(origin, allowed)`; `clientIp(req)` | Construido |
| Configuración del agente | `web/server/agent-settings.mjs` | Prompt de la misión (ADR 0001), modelos de STT, LLM y TTS, formatos de audio, saludo | `buildSettings({ deepseekKey, documentText })`; constantes `IN_RATE` (16000), `OUT_RATE` (24000), `VOICE`, `BASE_PROMPT` | Construido; el texto del documento va cercado entre `<documento>` y `</documento>` como datos, no instrucciones |
| Herramienta de sedes | `web/server/ips.mjs` | Valida argumentos, resuelve el municipio contra la lista oficial, construye la consulta SoQL con literales escapados, pagina, agrega por sede | `buscarSedes(args, { token })`; `TOOL_DEFINITION`; `validateArgs`; `resolveMunicipio` | Construido |
| Páginas y salud | `web/src/app/` | Interfaz web y `GET /api/health` | `GET /`, `GET /api/health` | Salud, carga de documento y brief construidos (`page.tsx`, `components/DocumentUpload.tsx`); la interfaz de voz y las tarjetas de sedes están planeadas (paso 4) |
| Documento y brief | `web/server/documents.mjs`, `web/server/brief.mjs` | Tipo real por firma (PDF con unpdf, DOCX leyendo `word/document.xml` con fflate, TXT UTF-8), texto hasta 20 000 caracteres en memoria 30 min, brief de 3 a 5 preguntas con DeepSeek en 25 s como máximo; la sesión de voz recibe el texto con `/ws/agent?doc=<id>` | `POST /api/document`; `parseDocument`, `createDocumentStore`, `generateBrief` | Construido (paso 3) |
| Transcripción diarizada | por definir | Segunda conexión a Deepgram STT con `diarize=true` para separar Hablante 1 y Hablante 2 | Eventos adicionales por el mismo WebSocket | Planeado (paso 5) |
| Sentimiento | por definir | Clasificación por intervención con DeepSeek | Eventos adicionales por el mismo WebSocket | Planeado (paso 5) |

Reglas de modularidad que se cumplen hoy: `server.mjs` solo usa las funciones exportadas de cada módulo; `ips.mjs` no conoce el WebSocket; `agent-settings.mjs` toma la definición de la herramienta de `ips.mjs` por su export `TOOL_DEFINITION` y no por duplicación. No hay base de datos, así que la regla "cada módulo es dueño de sus tablas" no aplica; el único estado compartido de un módulo es la caché en memoria de la lista de municipios dentro de `ips.mjs`.

## 5. Flujo de datos de un turno de voz

```mermaid
sequenceDiagram
  autonumber
  participant N as Navegador
  participant S as Servidor agente-vocal
  participant DG as Deepgram Voice Agent
  participant DS as DeepSeek
  participant DT as datos.gov.co

  N->>S: GET /ws/agent con Upgrade y Origin
  S->>S: Origin en lista blanca, cupo por IP, tasa por minuto y cupo global
  S-->>N: 101 Switching Protocols
  S->>DG: Abre wss agent/converse con Authorization Token
  S->>DG: Settings con prompt, herramienta y clave de DeepSeek
  DG-->>S: Welcome y SettingsApplied
  S-->>N: Welcome y SettingsApplied
  DG-->>S: Audio del saludo 24 kHz
  S-->>N: Frames binarios de audio
  loop Cada turno
    N->>S: Frames binarios PCM 16 kHz
    S->>DG: Mismos frames sin modificar
    DG-->>S: UserStartedSpeaking y ConversationText del usuario
    S-->>N: UserStartedSpeaking y ConversationText
    DG->>DS: chat completions con historial y herramientas
    DS-->>DG: Llamada a buscar_sedes con argumentos
    DG-->>S: FunctionCallRequest
    S->>S: validateArgs y resolución del municipio
    S->>DT: GET resource s2ru-bqt6 con X-App-Token, timeout 8 s
    DT-->>S: Filas con columnas de la lista blanca
    S-->>N: ToolResult con hasta 20 sedes
    S->>DG: FunctionCallResponse
    DG->>DS: chat completions con el resultado
    DS-->>DG: Texto de respuesta
    DG-->>S: AgentThinking, ConversationText y AgentStartedSpeaking
    S-->>N: AgentThinking, ConversationText y AgentStartedSpeaking
    DG-->>S: Audio TTS 24 kHz
    S-->>N: Frames binarios de audio
    DG-->>S: AgentAudioDone
    S-->>N: AgentAudioDone
  end
  N->>S: Cierre normal o límite de 10 minutos
  S->>DG: terminate
```

Fuente: `docs/diagrams/secuencia-voz.mmd`.

Paso a paso, en el orden en que ocurre:

1. El navegador pide `GET /ws/agent` con `Upgrade: websocket`. El servidor genera un UUID de sesión y aplica, en este orden: Origin en lista blanca (si no, 403), tasa por IP de 10 intentos por minuto (429), cupo global de 8 sesiones (503) y cupo de 2 sesiones simultáneas por IP (429). Las respuestas 429 llevan `Retry-After: 60`.
2. Aceptada la conexión, el servidor abre `wss://agent.deepgram.com/v1/agent/converse` con la cabecera `Authorization: Token` y, al abrirse, envía `Settings`: audio de entrada `linear16` a 16 kHz, salida `linear16` a 24 kHz sin contenedor, STT `nova-3` en español con `keyterms` IPS, EPS y urgencias, LLM `deepseek-chat` con `temperature` 0,2 en `https://api.deepseek.com/chat/completions`, la herramienta `buscar_sedes` y la voz `aura-2-celeste-es`. Los frames de audio que llegan antes de que abra Deepgram se guardan (hasta 50) y se envían después.
3. El navegador envía audio binario; el servidor lo reenvía tal cual. Deepgram detecta el fin del turno, transcribe y llama a DeepSeek.
4. Si el modelo pide `buscar_sedes`, llega un `FunctionCallRequest`. El servidor valida los argumentos, resuelve el municipio, consulta datos.gov.co, envía al navegador un evento `ToolResult` (para las tarjetas en pantalla) y devuelve a Deepgram un `FunctionCallResponse` con el mismo resultado serializado.
5. Deepgram pide a DeepSeek la respuesta final, la sintetiza y la envía como audio binario de 24 kHz, que el servidor reenvía al navegador. Los eventos de texto y de estado de la lista blanca también se reenvían; los demás se quedan en el servidor.
6. La sesión termina cuando el navegador cierra, cuando Deepgram cierra o falla, o a los 10 minutos. En todos los casos se libera el cupo y se registra `session_end` con la duración.

Latencia medida en el spike (`web/scripts/spike-voice-agent.mjs`): unos 2 s desde el fin de la voz hasta el primer audio del agente, repartidos en STT unos 0,1 s, DeepSeek de 0,8 a 1,05 s y TTS de 0,7 a 0,8 s. El LLM es el componente dominante; por eso el prompt pide respuestas de máximo dos frases. Un turno con herramienta suma el tiempo de datos.gov.co (cada petición con tope de 8 s).

La interrupción (barge-in, RF-005) la detecta Deepgram y la anuncia con `UserStartedSpeaking`; el navegador debe descartar el audio del agente que tenga en cola al recibirlo. Esa parte del cliente está planeada con la interfaz de voz.

## 6. Límites de confianza

```mermaid
flowchart LR
  subgraph z0["Zona 0 - no confiable"]
    nav["Navegador del usuario - audio, Origin, X-Forwarded-For"]
  end

  subgraph z1["Zona 1 - borde de Google"]
    gfe["Front end de Cloud Run - TLS y X-Forwarded-For"]
  end

  subgraph z2["Zona 2 - nuestro servidor, confiable"]
    adm["Admisión - limits.mjs"]
    proxy["Proxy de sesión - server.mjs"]
    tool["buscar_sedes - ips.mjs"]
    env["Claves en memoria del proceso"]
  end

  subgraph z3["Zona 3 - terceros con contrato de servicio"]
    dg["Deepgram - recibe audio y la clave de DeepSeek"]
    ds["DeepSeek - recibe texto de la conversación"]
    dt["datos.gov.co - recibe municipio y tipo de atención"]
  end

  subgraph z4["Zona 4 - plano de control de GCP"]
    sm["Secret Manager"]
    iam["IAM y cuentas de servicio"]
  end

  nav -- "B1: todo input se valida" --> gfe
  gfe --> adm
  adm -- "solo si pasa los cuatro controles" --> proxy
  proxy -- "B2: solo audio y KeepAlive salen hacia arriba" --> dg
  dg -- "B2: solo eventos de la lista blanca bajan" --> proxy
  dg --> ds
  proxy -- "B3: argumentos validados y literales escapados" --> tool
  tool --> dt
  sm -- "B4: inyección al desplegar" --> env
  iam --> sm
```

Fuente: `docs/diagrams/limites-de-confianza.mmd`.

Lectura de izquierda a derecha: todo lo que viene del navegador es no confiable, incluido el Origin (lo puede falsificar un cliente que no sea navegador) y las entradas de `X-Forwarded-For` que el propio cliente agrega. El front end de Cloud Run termina TLS y agrega la IP real como última entrada de `X-Forwarded-For`; por eso `clientIp` toma solo la última. Nuestro servidor es la única zona que conoce las claves. Los terceros reciben lo mínimo para su función.

| Frontera | Qué cruza | Control |
|---|---|---|
| B1: navegador a servidor | Upgrade HTTP, audio binario, mensajes de texto | Origin en lista blanca; cupos y tasa antes del handshake; frames de más de 64 KB cierran con 1009; el único texto aceptado es `{"type":"KeepAlive"}`, que se reescribe en forma canónica antes de reenviarse; cualquier otro texto cierra con 1008. El navegador no puede enviar `Settings`, `InjectAgentMessage`, `UpdatePrompt` ni ningún otro mensaje de control a Deepgram |
| B2: servidor y Deepgram | Hacia arriba: `Settings`, audio, `KeepAlive`, `FunctionCallResponse`. Hacia abajo: eventos y audio | Hacia el navegador solo bajan los siete tipos de la lista blanca, `ToolResult` y un `Error` saneado con texto fijo; el detalle del error de Deepgram queda en el log del servidor |
| B2 bis: Deepgram y DeepSeek | Texto de la conversación y la clave de DeepSeek | Riesgo aceptado: la clave de DeepSeek viaja dentro de `Settings` a Deepgram, que la usa para llamar a DeepSeek. Es la razón por la que el proxy es obligatorio. Mitigación: clave dedicada al evento, revocada al desmontar |
| B3: argumentos del modelo a la consulta | `necesidad`, `municipio`, `departamento`, `naturaleza` | El modelo es tratado como no confiable: `validateArgs` rechaza campos desconocidos, textos de más de 60 caracteres y caracteres de control; `necesidad` y `naturaleza` son enums; el municipio se reemplaza por el nombre oficial antes de entrar a la consulta; todo literal pasa por `soqlString`. Las columnas pedidas son una lista blanca que excluye `gerente` y `email` |
| B4: plano de control de GCP | Secretos e imagen | Secret Manager inyecta las claves como variables de entorno al desplegar la revisión; la cuenta `agente-vocal-run` solo tiene `roles/secretmanager.secretAccessor` sobre los tres secretos; la imagen no contiene secretos (`.dockerignore` excluye `.env*`) |

Aislamiento entre sesiones: cada sesión vive en el cierre de `runSession` con su propia conexión a Deepgram, su propio buffer y su propio temporizador. No hay estado compartido entre sesiones salvo los contadores de admisión y la caché de municipios, que no contiene datos de usuarios.

## 7. Vista de despliegue

```mermaid
flowchart LR
  dev["Desarrollador - infra/deploy.sh"]
  gh["GitHub - repositorio"]
  ci["GitHub Actions CI - pruebas, lint, gitleaks, npm audit, build. No despliega"]

  subgraph gcp["Proyecto GCP agente-vocal-hackaton - us-east1"]
    cb["Cloud Build - cuenta de servicio dedicada"]
    ar["Artifact Registry - repo cloud-run-source-deploy"]
    sm["Secret Manager - deepseek-api-key, deepgram-api-key, datosgov-app-token"]
    subgraph cr["Cloud Run - servicio agente-vocal"]
      inst1["Instancia 1 - Node 24, 1 vCPU, 1 GiB"]
      inst2["Instancia 2 - solo bajo carga"]
    end
    sa["Cuenta de servicio agente-vocal-run - secretAccessor"]
    logs["Cloud Logging"]
  end

  usuario["Navegador del jurado"]

  dev -- "git push" --> gh
  gh --> ci
  dev -- "deploy.sh" --> cb
  cb -- "imagen multi-etapa node:24-slim" --> ar
  ar -- "imagen" --> cr
  sa -- "lee secretos al desplegar la revisión" --> sm
  sm -- "variables de entorno" --> cr
  cr -- "stdout JSON" --> logs
  usuario -- "HTTPS y WSS con afinidad de sesión" --> cr
```

Fuente: `docs/diagrams/despliegue.mmd`.

Lectura de izquierda a derecha: el desarrollador empuja a GitHub, donde la CI de GitHub Actions corre pruebas, lint, gitleaks, `npm audit` y build, sin desplegar. El despliegue lo hace el desarrollador con `infra/deploy.sh`, que envía el código a Cloud Build (con una cuenta de servicio dedicada de permisos mínimos); Cloud Build construye la imagen desde `web/Dockerfile` y la guarda en Artifact Registry; Cloud Run crea la revisión, inyectando los tres secretos con la identidad `agente-vocal-run`. El navegador del jurado llega por HTTPS y WSS.

| Elemento | Valor |
|---|---|
| Proyecto GCP | `agente-vocal-hackaton`, dedicado al evento y borrado al terminar |
| Servicio | Cloud Run `agente-vocal`, región `us-east1` |
| URL | `https://agente-vocal-583590264456.us-east1.run.app` |
| Escala | `min-instances` 0 (1 durante la evaluación del jurado), `max-instances` 2, `concurrency` 40 |
| Recursos | 1 vCPU, 1 GiB, startup CPU boost |
| Conexión | `timeout` 3600 s, afinidad de sesión, acceso público (`allow-unauthenticated`, ADR 0004) |
| Identidad en ejecución | `agente-vocal-run`, solo `roles/secretmanager.secretAccessor` sobre `deepseek-api-key`, `deepgram-api-key` y `datosgov-app-token` (replicados en `us-east1`) |
| Imagen | Multi-etapa `node:24-slim`, usuario `node` (no root), solo dependencias de producción, `CMD ["node", "server.mjs"]`, puerto 8080 |
| Registro de imágenes | Artifact Registry, repositorio `cloud-run-source-deploy` en `us-east1` |
| Variables de entorno | `DEEPGRAM_API_KEY` y `DEEPSEEK_API_KEY` obligatorias (sin ellas el proceso termina con código 1); `DATOSGOV_APP_TOKEN` opcional (sin él datos.gov.co aplica límites más bajos); `ALLOWED_ORIGINS` (en producción, vacía significa rechazar todo upgrade); opcionales `SESSION_MAX_MS`, `MAX_SESSIONS`, `MAX_SESSIONS_PER_IP`, `MAX_CONNECTS_PER_MIN`, `PORT` |

Los límites de admisión son por instancia. Con `max-instances` 2 el techo real es de 16 sesiones de voz simultáneas en todo el servicio, y de 4 por IP si sus conexiones caen en instancias distintas. La concurrencia de 40 por instancia deja holgura para las peticiones HTTP de páginas mientras hay 8 sesiones de voz abiertas.

## 8. Controles de seguridad frente a CLAUDE.md sección 4

| Control de la sección 4 | Estado | Detalle |
|---|---|---|
| Autorización por objeto y por función en cada endpoint | No aplica | No hay usuarios, roles ni recursos con dueño (ADR 0004). Cada sesión solo accede a su propia conexión; no existe un identificador que el cliente pueda manipular para leer otra |
| Denegar por defecto | Implementado | En producción, un upgrade a cualquier ruta distinta de `/ws/agent` se corta; el texto del cliente se acepta solo si es `KeepAlive`; hacia el navegador solo bajan tipos de la lista blanca; `ALLOWED_ORIGINS` vacía rechaza todo |
| Contraseñas, JWT, refresh, MFA | No aplica | Sin login (ADR 0004) |
| Rate limit y bloqueo progresivo | Parcial | Tasa por IP, cupo por IP y cupo global en el upgrade del WebSocket, que es lo único que genera costo. No hay bloqueo progresivo ni rate limit de aplicación en las páginas HTTP |
| Validación de esquema de todo input | Implementado para lo que existe | Mensajes del cliente por lista blanca de tipo; argumentos de la herramienta con `validateArgs` (campos desconocidos, tipo, longitud, caracteres de control, enums). La validación de archivos subidos llega con RF-001 |
| DTOs de entrada y salida | Implementado | La herramienta devuelve un objeto construido campo a campo desde columnas de la lista blanca; el campo interno `total` se elimina antes de responder |
| Consultas parametrizadas | Implementado en su equivalente | No hay SQL. La consulta SoQL a datos.gov.co se arma solo con valores de enums y de la lista oficial de municipios, todos escapados con `soqlString`, y codificados con `encodeURIComponent` |
| Salida codificada sin `innerHTML` | Planeado con la interfaz | La interfaz se escribe en React, que codifica por defecto; regla: sin `dangerouslySetInnerHTML` con datos del agente o del registro |
| Subidas de archivos | Construido | RF-001: tipo por firma, 20 MB contando bytes reales, nombre del cliente ignorado e id generado (UUID), solo en memoria con vencimiento, Origin en lista blanca, 5 cargas por minuto y 1 simultánea por IP |
| Anti SSRF | Implementado | Los tres destinos salientes son constantes en el código; ninguna URL sale del usuario o del modelo |
| Límites de tamaño, paginación y timeouts | Implementado | Frames de 64 KB; buffer previo de 50 frames; sesión de 10 min; datos.gov.co con páginas de 1000 filas, tope de 5000 filas, 20 sedes por respuesta y 8 s por petición |
| Secretos fuera del código | Implementado | Secret Manager y variables de entorno; `.env` fuera de la imagen y del repositorio; las claves nunca se envían al navegador |
| Cifrado en tránsito y en reposo | Implementado / no aplica | TLS en todas las conexiones (HTTPS, WSS). No se guarda nada en reposo |
| No loguear datos personales ni tokens | Implementado | La IP se registra como SHA-256 truncado a 12 caracteres; no se registran transcripciones, audio ni argumentos de la herramienta, solo su nombre, el código de error y el total de sedes |
| Mínimo privilegio en base de datos, RLS | No aplica | Sin base de datos |
| Webhooks firmados | No aplica | Sin webhooks |
| Cabeceras de seguridad | Implementado | En todas las rutas: HSTS `max-age=63072000; includeSubDomains`, CSP en modo report-only, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` con micrófono solo para `self`. `poweredByHeader` desactivado y sin source maps en el navegador. Deuda: la CSP permite `'unsafe-inline'` en scripts y estilos y todavía no se aplica en modo bloqueo |
| CORS con lista explícita | Implementado por omisión | El servidor no emite cabeceras CORS, así que ningún otro origen puede leer sus respuestas; el WebSocket, que no está cubierto por CORS, se protege con la lista blanca de Origin |
| Errores genéricos | Implementado | Al navegador solo llega "El servicio de voz tuvo un problema. Intenta de nuevo." o un código de cierre; la herramienta devuelve códigos (`servicio_no_disponible`, `parametros_invalidos`) sin trazas |
| Registro de eventos de seguridad con correlación | Implementado | `ws_rejected` con motivo (`bad_origin`, `rate_limited`, `ip_cap`, `global_cap`) y estado; cada intento lleva un UUID que se mantiene en toda la sesión |
| Dependencias fijadas, auditoría, escaneo de secretos | Implementado | `package-lock.json`, `npm ci`; CI con `npm audit` y gitleaks |
| Contenedor no root, imagen mínima, sin secretos en capas | Implementado | Ver vista de despliegue |

## 9. Observabilidad

El servidor escribe una línea JSON por evento en stdout con el campo `severity`, que Cloud Logging interpreta sin agente adicional.

| Evento | Severidad | Campos |
|---|---|---|
| `server_listening` | INFO | `port`, `dev`, número de orígenes permitidos |
| `ws_rejected` | INFO | `reason`, `status`, `id`, `ip` (hash) |
| `session_start` | INFO | `id`, `ip` (hash) |
| `tool_call` | INFO | `id`, `name`, `error`, `total` |
| `session_end` | INFO | `id`, `ip` (hash), `code`, `reason`, `seconds` |
| `upstream_error` | ERROR | `id`, `detail` (mensaje de error de Deepgram) |
| `upstream_socket_error` | ERROR | `id`, `detail` |

El `id` de sesión es el identificador de correlación. Las métricas de peticiones, latencia, instancias y memoria vienen de Cloud Run sin configuración. No hay trazas distribuidas: con un solo servicio no se justifican. Excepción conocida: cuando `buscar_sedes` falla contra datos.gov.co, `ips.mjs` escribe un `console.error` en texto plano, no en JSON; el evento `tool_call` con `error: servicio_no_disponible` sí queda estructurado.

## 10. Manejo de fallos por integración

| Falla | Qué ve el servidor | Qué hace | Qué ve el usuario |
|---|---|---|---|
| Deepgram rechaza la conexión o no está disponible | `error` en el socket de subida | Registra `upstream_socket_error`, cierra la sesión con 1011 `upstream_error` y libera el cupo | Cierre con código 1011; la interfaz debe ofrecer reconectar (RNF-003, planeado con la interfaz) |
| Deepgram cierra la sesión | `close` en el socket de subida | Cierra con 1011 `upstream_closed` | Igual que el caso anterior |
| Deepgram envía un mensaje `Error` sin cerrar | Mensaje `Error` | Registra el detalle como `upstream_error` y envía al navegador un `Error` saneado; la sesión sigue abierta | Mensaje genérico en pantalla |
| DeepSeek lento o caído | Nada directo: lo llama Deepgram | Deepgram anuncia `AgentThinking` y, si DeepSeek falla, emite `Error`, que sigue el caso anterior. Nuestro servidor no impone un tope propio al LLM; el límite es la sesión de 10 min | Estado "pensando" más largo o mensaje genérico |
| datos.gov.co responde 429, 5xx o error de red | Excepción en `getJson` | La herramienta devuelve `{ "error": "servicio_no_disponible" }` al modelo y al navegador; el prompt obliga a decir que no lo sabe. Sin reintentos. Si fallaba la carga de municipios, la caché se vacía y la siguiente llamada reintenta | El agente dice que no pudo consultar; no inventa sedes |
| datos.gov.co no responde | Timeout de 8 s por petición (`AbortSignal.timeout`) | Igual que el caso anterior | Igual, tras la espera |
| Municipio no reconocido | Sin coincidencia cercana | Devuelve `municipio_no_encontrado` con hasta 3 sugerencias | El agente pregunta de nuevo ofreciendo las sugerencias |
| El navegador pierde la conexión | `close` del cliente | Cierra con 1000 `client_closed`, termina la conexión a Deepgram, libera el cupo | Debe reconectar; la sesión anterior no se recupera |
| La instancia se reinicia o se reemplaza | Todas sus sesiones se pierden | Nada que recuperar: no hay estado persistente | Reconexión y conversación nueva |
| Arranque en frío | Primera petición con `min-instances` 0 | Startup CPU boost; durante la evaluación `min-instances` 1 | Primera carga más lenta fuera de la ventana del jurado |

## 11. Control de costo

- Cada sesión de voz abre una conexión facturada a Deepgram y consumo de DeepSeek, por eso la admisión ocurre antes del handshake y no después.
- Techo de costo por instancia: 8 sesiones simultáneas de hasta 10 minutos. Con `max-instances` 2, techo de 16 sesiones en el servicio.
- `min-instances` 0 fuera de la ventana del jurado: sin tráfico no hay costo de cómputo.
- 1 vCPU y 1 GiB: el proceso solo releva bytes y hace consultas HTTP; no procesa audio.
- Alerta de presupuesto: pendiente. La cuenta de facturación es compartida y el desarrollador no tiene permiso para crear presupuestos; la debe crear el administrador de facturación, filtrada al proyecto `agente-vocal-hackaton`.
- Proyecto dedicado al evento: el desmontaje es `gcloud projects delete` y la revocación de las tres claves (`docs/PLAN.md` sección 7).

## 12. Pruebas que respaldan la arquitectura

| Suite | Ubicación | Resultado |
|---|---|---|
| Unitarias (`node:test`) | `web/server/*.test.mjs` | 21 pruebas en verde |
| Integración del proxy contra producción | `web/tests/integration/proxy.test.mjs` | 7 pruebas en verde |
| k6 smoke | `web/tests/load/smoke.js` | p95 170 ms |
| k6 carga, 20 VUs | `web/tests/load/load.js` | p95 360 ms |
| k6 estrés, 150 VUs | `web/tests/load/stress.js` | p95 252 ms, 0 errores |
| k6 picos, 120 VUs | `web/tests/load/spike.js` | p95 176 ms |
| k6 límites del WebSocket | `web/tests/load/ws-limits.js` | Todos los excedentes rechazados |

Las pruebas de carga HTTP miden las páginas y `/api/health`, no sesiones de voz completas, porque cada sesión real consume créditos de Deepgram y DeepSeek. Los umbrales están en RNF-007.

## 13. Limitaciones conocidas

- **Límites en memoria por instancia.** Los contadores de `limits.mjs` no se comparten entre instancias, así que los cupos efectivos se multiplican por el número de instancias (comentario `ponytail:` en el archivo). Aceptable con `max-instances` 2; con más instancias hay que moverlos a Redis (Memorystore).
- **Origin es falsificable fuera del navegador.** La lista blanca impide que otra web use el agente desde el navegador de una víctima, pero un script puede enviar cualquier Origin. Para ese caso quedan los cupos, la tasa y la duración máxima (ADR 0004).
- **Una sola región.** Si `us-east1` cae, el servicio cae. Se acepta para un evento de un día.
- **Arranque en frío con `min-instances` 0.** Se mitiga subiendo a 1 durante la evaluación.
- **Tiempo de la herramienta.** Cada petición a datos.gov.co tiene 8 s y la llamada completa a `buscar_sedes` tiene un plazo total de 12 s (`TOOL_DEADLINE_MS` en `server.mjs`); al vencer, el agente recibe `servicio_no_disponible` y lo dice. La conexión con Deepgram tiene un timeout de handshake de 10 s.
- **Datos del registro.** El dataset no tiene especialidades, EPS, horarios ni disponibilidad, y su corte es de noviembre de 2022 (ADR 0001). El agente lo dice en lugar de inventar.
- **La clave de DeepSeek se comparte con Deepgram** por diseño de la Voice Agent API.
- **Documento en una sola instancia.** El texto vive en la memoria de la instancia que recibió la carga; la afinidad de sesión de Cloud Run mantiene la voz en la misma instancia. Si la instancia se recicla, la persona vuelve a subir el documento. Un documento de más de 20 000 caracteres se corta y la interfaz lo avisa.
- **Funciones planeadas.** Transcripción diarizada, panel de sentimiento e interfaz de voz con tarjetas aún no están construidos.

## 14. Camino a microservicios

Las fronteras ya permiten separar sin reescribir. El primer candidato es el **gateway de voz** (`server.mjs` en su parte de WebSocket, junto con `limits.mjs` y `agent-settings.mjs`), por tres razones: su perfil de carga es distinto (conexiones largas que cuestan dinero contra peticiones HTTP cortas y baratas), es el único componente que maneja claves de proveedores y su escalado es el que hoy obliga a la limitación de cupos en memoria. Al extraerlo, los contadores de admisión pasan a Memorystore y las páginas de Next.js pueden ir a un servicio sin secretos o a un CDN.

El segundo candidato es `ips.mjs` como servicio de consulta del registro: es puro (argumentos validados entran, JSON sale), sin estado más allá de una caché, y otros canales (chat de texto, WhatsApp) podrían reutilizarlo. No se extrae primero porque hoy solo tiene un consumidor y separarlo agregaría un salto de red dentro del turno de voz, que es el atributo de calidad prioritario.

Los módulos planeados de diarización y sentimiento nacen detrás de una función por módulo para que puedan seguir el mismo camino.
