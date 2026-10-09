# Seguridad

Modelo de amenazas breve, controles implementados frente a `CLAUDE.md` sección 4, resultados de auditoría y deuda conocida. Las referencias de código son a `web/`. Documentos relacionados: `docs/ARQUITECTURA.md` (límites de confianza y controles detallados), `docs/adr/0004-acceso-publico-sin-login.md`, `docs/PRUEBAS-AUDIO.md` (pruebas de voz) y el historial de git de `docs/TESTING.md` (última versión en el commit 6eb3dd7, resumida en `docs/ARQUITECTURA.md` sección 11 Pruebas) para los demás casos y resultados.

## 1. Modelo de amenazas

### Activos

| Activo | Por qué importa |
|---|---|
| Claves de Deepgram, DeepSeek y datos.gov.co | Quien las obtenga gasta el presupuesto o usa el servicio como proxy gratuito de LLM y TTS |
| Presupuesto de proveedores | Cada sesión de voz abre una conexión facturada a Deepgram y consume DeepSeek |
| Disponibilidad durante la ventana del jurado | Un proceso Node comparte el event loop entre todas las sesiones de voz |
| Texto de documentos subidos y audio de la conversación | Pueden contener datos personales de quien los sube; viven solo en memoria |

No hay base de datos, cuentas ni datos personales del registro: `gerente` y `email` nunca se seleccionan (`web/server/ips.mjs`, lista `COLUMNS`).

### Actores

| Actor | Capacidad supuesta |
|---|---|
| Visitante legítimo | Navegador con micrófono; sube documentos propios |
| Visitante malicioso con navegador | Falsifica entradas de interfaz, abre varias pestañas, sube archivos hostiles |
| Script fuera del navegador | Puede enviar cualquier `Origin` y cualquier `X-Forwarded-For` que agregue por su cuenta |
| Autor de un documento hostil | Intenta inyectar instrucciones al agente a través del texto del documento |
| Modelo de lenguaje | Tratado como no confiable: sus argumentos de herramienta se validan |
| Terceros (Deepgram, DeepSeek, datos.gov.co) | Reciben lo mínimo para su función; una caída degrada el servicio, no lo compromete |

### Fronteras de confianza

Resumen; el diagrama completo está en `docs/ARQUITECTURA.md` sección 3.5.

- B1, navegador a servidor: todo input es hostil. Controles antes del handshake (Origin, cupos, tasa) y lista blanca de mensajes.
- B2, servidor a Deepgram: solo salen `Settings`, audio, `KeepAlive`, `InjectUserMessage` (reconstruido por el servidor a partir de un `AskText` validado: texto de 1 a 300 caracteres, máximo 20 por sesión) y `FunctionCallResponse`; hacia Deepgram STT de diarización sale solo audio, `KeepAlive` y `CloseStream`; solo bajan siete tipos de evento, `ToolResult` y un `Error` saneado. Riesgo aceptado: la clave de DeepSeek viaja en `Settings` a Deepgram.
- B3, argumentos del modelo a la consulta SoQL: validados y escapados.
- B4, plano de control de GCP: Secret Manager inyecta las claves como variables de entorno al desplegar.
- B6, servidor a Meta (RF-024, opcional): solo sale una plantilla fija con dos parámetros armados por el servidor; el destino es constante en el código (`graph.facebook.com`).

### Amenazas del envío por WhatsApp (RF-024)

| Amenaza | Riesgo | Controles |
|---|---|---|
| Acoso o spam a un número de terceros | Alguien hace que el agente envíe mensajes a un número ajeno | Solo envía si la persona aceptó y confirmó el número repetido en grupos 3-3-4; 1 mensaje por número (hash SHA-256) cada 10 minutos; 1 por IP (IPv6 por /64) cada 10 minutos; 3 por hora en total; los límites se cuentan al intentar; contenido fijo de plantilla, sin texto libre; el pie identifica al servicio |
| Abuso de costo | Reintentos o muchas sesiones para disparar mensajes facturables | Los mismos límites, más 8 s de timeout y cero reintentos; el tope global es `WHATSAPP_MAX_PER_HOUR`; nivel de mensajería de 250 destinatarios por día en el número remitente. Límite: los contadores son por instancia, con `max-instances` 2 el tope global real puede ser el doble |
| Inyección de instrucciones para enviar texto arbitrario | Un documento o una frase del usuario ("envía al 3001234567 el texto ...") intenta que el modelo redacte el mensaje | El modelo no escribe el mensaje: el servidor lo arma con su copia de la última búsqueda exitosa; `validateArgs` rechaza campos distintos de `telefono` y `sedes`, teléfonos que no son celulares colombianos y posiciones fuera de la última búsqueda (máximo 3); parámetros con espacios colapsados y 700 caracteres como máximo |
| Fuga del token o del número | El token da control del remitente; el número es un dato personal | Token solo en Secret Manager (`whatsapp-access-token`) y variable de entorno, nunca en el navegador ni en logs; los registros `whatsapp_sent` y `whatsapp_failed` llevan solo el hash del número; el número no se guarda. Riesgo aceptado: el número dictado pasa por Deepgram y DeepSeek |
| Número mal reconocido | Los dígitos dictados llegan mal y el mensaje va a otra persona | Repetición en grupos 3-3-4 con confirmación explícita antes de enviar; un solo envío por conversación |

## 2. Controles implementados (CLAUDE.md sección 4)

| Control exigido | Estado | Dónde |
|---|---|---|
| Autorización por objeto y por función | No aplica por decisión (ADR 0004): sin cuentas ni recursos con dueño. Una sesión solo toca su propia conexión; el `documentId` es un UUID aleatorio de uso único dentro de 30 min | `web/server/documents.mjs` (`createDocumentStore`) |
| Denegar por defecto | Implementado: upgrade a rutas distintas de `/ws/agent` se corta en producción; `ALLOWED_ORIGINS` vacía rechaza todo; texto del cliente solo `KeepAlive` o `AskText` validado, ambos reconstruidos por el servidor | `web/server.mjs` (`server.on('upgrade')`, `client.on('message')`) |
| Contraseñas, JWT, MFA | No aplica (sin login) | ADR 0004 |
| Rate limit | Parcial: tasa por IP (10 por minuto), cupo por IP (2), cupo global (8) en el WebSocket; en `POST /api/document` 5 por minuto, 1 simultánea por IP y 4 globales. Sin bloqueo progresivo ni límite en páginas | `web/server/limits.mjs`, `web/server.mjs` |
| Validación de esquema | Implementado: argumentos de herramienta (campos desconocidos, tipo, 60 caracteres, caracteres de control, enums); mensajes del cliente por lista blanca; archivos por firma real | `web/server/ips.mjs` (`validateArgs`), `web/server/documents.mjs` (`detectType`) |
| DTOs de entrada y salida | Implementado: la herramienta construye cada sede campo a campo desde columnas de la lista blanca y elimina `total`; el brief se sanea (`resumen` hasta 600 caracteres, 3 a 5 preguntas de hasta 200) | `web/server/ips.mjs` (`aggregate`), `web/server/brief.mjs` (`sanitize`) |
| Consultas parametrizadas | Equivalente: no hay SQL. La SoQL usa solo valores de enums y de la lista oficial de municipios, con `soqlString` y `encodeURIComponent` | `web/server/ips.mjs` |
| Salida codificada | La interfaz es React, que codifica por defecto. Regla: sin `dangerouslySetInnerHTML` con datos del agente o del registro | `web/src/app/components/` |
| Subidas de archivos | Implementado: tipo por firma (PDF, DOCX con `word/document.xml`, TXT UTF-8 sin NUL), 20 MB contando bytes reales, nombre del cliente ignorado, id UUID, solo memoria, extracción en worker con límite de memoria y plazo | `web/server/documents.mjs`, `web/server/parse-worker.mjs`, `web/server.mjs` (`handleUpload`) |
| Anti SSRF | Implementado: los destinos salientes son constantes en el código; ninguna URL proviene del usuario o del modelo | `web/server.mjs`, `web/server/ips.mjs`, `web/server/brief.mjs` |
| Tamaños, paginación, timeouts | Implementado: frame de 64 KB, buffer previo de 50 frames, sesión de 10 min, datos.gov.co con páginas de 1000, tope de 5000 filas, 20 sedes y 8 s por petición, plazo total de la herramienta 12 s, brief 25 s, handshake con Deepgram 10 s, cuerpo de subida 20 s | `web/server.mjs`, `web/server/ips.mjs`, `web/server/brief.mjs` |
| Secretos fuera del código | Implementado: Secret Manager y variables de entorno; `.env` ignorado por git y por `.dockerignore`; versión de cada secreto fijada al desplegar; las claves nunca llegan al navegador | `infra/deploy.sh`, `.gitignore`, `web/.dockerignore` |
| Cifrado | TLS en HTTPS y WSS; nada se guarda en reposo | Cloud Run |
| No loguear datos personales | Implementado: IP como SHA-256 truncado a 12 caracteres; no se registran transcripciones, audio, texto de documentos ni argumentos de la herramienta | `web/server.mjs` (`hashIp`, `logEvent`) |
| Base de datos, RLS, webhooks | No aplica | Sin base de datos ni webhooks |
| Cabeceras | Implementado: HSTS, `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy` (micrófono solo `self`), CSP en modo report-only; sin `X-Powered-By` ni source maps | `web/next.config.mjs` |
| CORS | Por omisión no se emiten cabeceras CORS; el WebSocket se protege con la lista blanca de Origin | `web/server/limits.mjs` (`isAllowedOrigin`) |
| Errores genéricos | Implementado: al navegador solo llegan textos fijos y códigos; el detalle queda en logs | `web/server.mjs` (`UPLOAD_ERRORS`, mensaje de `Error`) |
| Envío por WhatsApp (RF-024) | Implementado: la herramienta solo existe con credenciales; argumentos validados con lista cerrada de campos; mensaje armado por el servidor desde su copia de la última búsqueda; límites por IP, por número y global; timeout de 8 s sin reintento; sin número ni token en logs | `web/server/whatsapp.mjs`, `web/server.mjs` (`handleFunctions`) |
| Logging de eventos de seguridad | Implementado: `ws_rejected` con motivo, `document_uploaded`, `upload_failed`, `upstream_error`, con UUID de correlación por sesión | `web/server.mjs` |
| Dependencias, auditoría, secretos | Implementado: `package-lock.json`, `npm ci`; CI con `npm audit --omit=dev --audit-level=high` y gitleaks con historial completo | `.github/workflows/ci.yml` |
| Contenedor | Implementado: imagen multi-etapa `node:24-slim`, usuario `node`, solo dependencias de producción, sin secretos en capas; cuenta de ejecución con solo `secretAccessor` sobre sus tres secretos; cuenta de build dedicada | `web/Dockerfile`, `infra/deploy.sh` |

## 3. Resultados de auditoría

### Auditoría del paso 3 (carga de documentos y limitador)

Hallazgos corregidos en el commit `050e436` (`security: audit fixes for uploads and limiter`). Evidencia automática en `web/server/documents.test.mjs` y `web/server/limits.test.mjs` (52 pruebas pasan, 3 en vivo se saltan).

| Hallazgo | Riesgo | Corrección | Verificación |
|---|---|---|---|
| H1: bomba de descompresión en DOCX | Un ZIP pequeño con un `word/document.xml` enorme congelaba el event loop que comparte la voz | Lectura de PDF y DOCX en un worker con 192 MB de heap y plazo de 10 s; del XML solo se descomprime lo declarado hasta 8 MB y se lee la cabecera de 2 MB | Prueba `RNF-004 docx with a 30 MB document.xml is bounded and does not block the event loop` |
| H2: bomba de descompresión en PDF | Un stream FlateDecode enorme agotaba memoria o CPU | Mismo worker con límites de recursos y plazo | Prueba `RNF-004 pdf with a huge FlateDecode stream resolves within the deadline` |
| H3: slowloris en la subida | Un cliente enviando un byte cada pocos segundos retenía un cupo de subida hasta una hora | Presupuesto absoluto de 20 s para recibir el cuerpo (`UPLOAD_BODY_MS`) | Revisión de código; sin prueba automática dedicada |
| M1: cerco del documento rompible | Variantes como `</DOCUMENTO>` o etiquetas anidadas permitían cerrar `<documento>` y escribir instrucciones | `fenceSafe` neutraliza cualquier grafía de la etiqueta (mayúsculas, espacios, anidamiento); lo usan el prompt de voz y el brief | Pruebas `RNF-004 a document cannot close the fence early` y `nested, uppercase and spaced fence tags are neutralized` |
| M2: crecimiento del limitador y evasión por IPv6 | El mapa de intentos crecía sin límite y un cliente IPv6 rotaba direcciones dentro de su /64 | Poda de IPs sin actividad cada minuto y clave por bloque /64 para IPv6 | Prueba `RNF-004 IPv6 clients are limited per /64 and IPv4 is untouched` |

Hallazgos de severidad baja (L): se aceptan sin corregir cuando el costo de arreglarlos supera el riesgo en un servicio de un evento, sin datos persistentes. Los aceptados y verificables en el código son:

- Un PDF hostil todavía consume CPU hasta 10 s en el worker. La voz no se congela (el event loop principal queda libre) pero puede ir algo más lenta en ese lapso (`docs/GUIA-QA.md`, entrada del commit `050e436`). Mitigación: 5 cargas por minuto y 1 simultánea por IP, 4 globales.
- `Origin` es falsificable fuera del navegador. La lista blanca impide el uso desde el navegador de una víctima; contra scripts quedan cupos, tasa y duración máxima (ADR 0004).
- Las rutas HTTP de páginas no tienen rate limit de aplicación. No generan costo en proveedores; el techo lo da Cloud Run (`max-instances` 2, `concurrency` 40, `docs/ARQUITECTURA.md` sección 10).

Nota para el cierre: la lista numerada original de hallazgos L de la auditoría no está reproducida en el repositorio; esta sección solo documenta lo que se puede comprobar contra el código.

### Verificaciones en producción

Resultados Aprobados (registro en el historial de git de `docs/TESTING.md` (última versión en el commit 6eb3dd7, resumida en `docs/ARQUITECTURA.md` sección 11 Pruebas)): R-005 (Origin ajeno 403, tercera sesión 429, frame de 65 KB cierra con 1009, texto desconocido cierra con 1008), R-006 (cabeceras presentes, `/.env`, `/.git/config`, `/package.json`, `/server.mjs` y un `.map` dan 404), R-007 (sin violaciones de CSP en consola), R-012 (límites del WebSocket bajo k6), R-014 (PNG 415, vacío 400, Origin ajeno 403, `doc` inválido 404, sexta carga 429), R-002 y R-003 (gitleaks limpio y `npm audit` con 0 vulnerabilidades en lo versionado al inicio).

Pendiente por ejecutar (Pendiente según el historial de git de `docs/TESTING.md` (última versión en el commit 6eb3dd7, resumida en `docs/ARQUITECTURA.md` sección 11 Pruebas)): CP-044, CP-046, CP-047, CP-048, CP-051, CP-053 a CP-057, CP-064, CP-065 y el break test manual de la sección 13. Una auditoría `/web-security-audit` completa del repositorio y del despliegue está prevista antes de la entrega (paso 7).

## 4. Deuda de seguridad conocida

| Deuda | Impacto | Plan |
|---|---|---|
| La CSP sigue en modo report-only y permite `'unsafe-inline'` en scripts y estilos (`web/next.config.mjs`) | No bloquea un XSS si apareciera | Pasar a nonces y modo bloqueo cuando la consola no muestre violaciones en el flujo real |
| El limitador es un contador en memoria por instancia (`web/server/limits.mjs`, comentario `ponytail:`) | Los cupos efectivos se multiplican por `max-instances` (techo de 16 sesiones y 4 por IP en el servicio) | Mover a Memorystore si se sube `max-instances` |
| El `documentId` aparece en la URL de `/ws/agent?doc=<id>` y por tanto en los registros de peticiones de Cloud Run | Quien lea esos registros podría abrir la sesión de otro documento durante los 30 min de vigencia, con Origin válido; el id es un UUID v4 sin enumeración posible | Mover el id al primer mensaje del WebSocket o a una cabecera |
| No hay alerta de presupuesto | Un abuso sostenido o un error de configuración no avisa por gasto | La debe crear el administrador de facturación, filtrada al proyecto `agente-vocal-hackaton` (`docs/ARQUITECTURA.md` sección 9.9) |
| La clave de DeepSeek viaja en `Settings` a Deepgram | Deepgram la ve | Clave dedicada al evento y revocada al desmontar |
| El primer commit del historial contiene una cadena con un identificador de proyecto de Google Cloud equivocado | No es un secreto ni da acceso; solo un identificador incorrecto | Los documentos posteriores apuntan al proyecto correcto (`2a4b8f2`); no se reescribe el historial |
| Los límites de WhatsApp son por instancia (`web/server/whatsapp.mjs`, comentario `ponytail:`) | Con `max-instances` 2 el tope global real de 3 por hora puede llegar a 6 | Almacén compartido si debe ser exacto |
| El token de WhatsApp es de un usuario del sistema y de larga duración | Quien lo obtenga puede enviar mensajes con el número remitente | Rotarlo y revocarlo al terminar el evento, junto con las demás claves |
| Sin bloqueo progresivo | Un atacante persistente puede reintentar cada minuto | Aceptable mientras el techo de costo sea de 16 sesiones |
| Documentos y sesiones se pierden al reciclarse la instancia | Disponibilidad, no confidencialidad | Documentado en `docs/ARQUITECTURA.md` sección 12 |

## 5. Cómo reportar un problema

Abrir un issue privado o escribir directamente al equipo, con título, pasos para reproducir, resultado esperado, resultado obtenido, severidad (crítica, alta, media, baja) y el commit (`git log --oneline -1`). Para el QA, el formato y los casos están en `docs/GUIA-QA.md` y `docs/QA-CONVERSACIONES.md`; el break test original está en el historial de git de `docs/TESTING.md` (última versión en el commit 6eb3dd7, resumida en `docs/ARQUITECTURA.md` sección 11 Pruebas). No incluir claves ni documentos reales en el reporte. Si el problema es una clave expuesta, avisar de inmediato para rotarla: las claves del proyecto (incluido el token de WhatsApp si se activó) son de uso exclusivo del evento y se revocan al desmontar (`docs/PLAN.md` sección 7).
