# Requerimientos

Fuente: hoja "01 RETO" de `V2.xlsx` (R01 a R07 y la hoja "02 CRITERIOS" no fueron entregadas, por eso se infieren), `docs/PLAN.md` sección 3 y `docs/adr/0001-mision-del-agente.md`. Los IDs son estables: no se reutilizan ni se renumeran. La columna "Casos" apunta a `docs/TESTING.md`.

Prioridad: Alta (sin esto la demo falla), Media (puntúa pero la demo sobrevive), Baja (deseable).

## 1. Requerimientos funcionales

| ID | Requerimiento | Prioridad | Criterio de aceptación (medible) | Origen | Casos |
|---|---|---|---|---|---|
| RF-001 | Carga de documento | Alta | Acepta PDF, DOCX y TXT de hasta 20 MB. El tipo se verifica por contenido real (firma del archivo), no por extensión. Un archivo de otro tipo, corrupto, vacío o mayor al límite se rechaza con un mensaje claro y sin guardar el archivo. Un PDF sin texto (escaneado) produce un aviso. Máximo 5 cargas por minuto y 1 simultánea por IP | P2 | CP-023 a CP-026, CP-066 a CP-069 |
| RF-002 | Respuestas ancladas al documento | Alta | De 7 preguntas con respuesta en el documento, al menos 6 se responden correctamente. Los datos del documento no se mezclan con conocimiento externo | P4 | CP-028, CP-070, CP-071 |
| RF-003 | Brief inicial | Alta | Tras la carga, en 30 s o menos, se muestra de qué trata el documento y entre 3 y 5 preguntas sugeridas pertinentes | P3 | CP-027 |
| RF-004 | Conversación por voz | Alta | Con STT y TTS en streaming, el tiempo entre el fin de la voz del usuario y el primer audio del agente tiene p50 de 2,0 s o menos (medido en el spike: 1,8 a 2,7 s) y objetivo de 1,5 s. Se mide sobre al menos 10 turnos | P4 (20 %) | CP-004, CP-030 |
| RF-005 | Interrupción (barge-in) | Alta | Cuando el usuario habla mientras el agente habla, el audio del agente se corta en 300 ms o menos y el agente atiende la nueva pregunta | Criterio 20 % | CP-031 |
| RF-006 | Honestidad | Alta | Ante una pregunta cuya respuesta no está en el documento ni en el registro, el agente dice que no lo sabe. En 3 de 3 preguntas de prueba no inventa datos | P4 | CP-004, CP-012 |
| RF-007 | Transcripción diarizada | Alta | Transcripción en vivo con hablante separado (Hablante 1, Hablante 2, Agente) y marca de tiempo por intervención. Con 2 voces distintas, al menos 80 % de las intervenciones queda con el hablante correcto | P5 (15 %) | CP-032 |
| RF-008 | Sentimiento y emociones | Media | Panel con sentimiento por intervención y tendencia, actualizado en 2 s o menos tras cerrarse la intervención | P5 | CP-033 |
| RF-009 | Dataset IPS por API | Alta | La herramienta `buscar_sedes` consulta `s2ru-bqt6` en datos.gov.co con token y paginación. De 5 consultas de prueba, las 5 coinciden con la consulta directa a la API | Objetivo del reto | CP-001, CP-004, CP-021, CP-022 |
| RF-010 | Traducción de necesidad a tipo de atención | Alta | Las 15 categorías del ADR 0001 (`consulta_general` a `unidad_movil`) mapean a su lista fija de capacidades. El modelo nunca escribe la consulta: solo entrega el enum y el servidor construye la consulta con valores escapados | ADR 0001 | CP-006, CP-019 |
| RF-011 | Municipio aproximado | Alta | El municipio se resuelve contra la lista oficial por el nombre más parecido, sin tildes ni mayúsculas. "Letizia" resuelve a Leticia; Quibdó, Cúcuta e Ibagué se resuelven con y sin tilde | ADR 0001 | CP-009, CP-020 |
| RF-012 | Alternativa por departamento | Alta | Si el municipio no tiene sedes del tipo pedido, el agente lo dice y ofrece las del departamento (por ejemplo UCI de adultos en Mitú). El resultado indica el alcance (municipio o departamento) | ADR 0001 | CP-008 |
| RF-013 | Sin datos personales | Alta | El agente no pronuncia ni muestra nombres de gerentes ni correos. La respuesta de la herramienta no contiene columnas fuera de la lista blanca | ADR 0001 | CP-011 |
| RF-014 | Emergencia primero | Alta | Ante una frase de emergencia (no respira, inconsciente, sangrado abundante, dolor de pecho, intento de suicidio, convulsión), la primera frase del agente es "Llama al 123" o equivalente, antes de cualquier sede. En 5 de 5 frases de prueba | ADR 0001 | CP-005 |
| RF-015 | Una pregunta de orientación | Media | Si la necesidad está entre urgencias y consulta externa, el agente hace una sola pregunta de gravedad y después busca. Nunca diagnostica | ADR 0001 | CP-006 |
| RF-016 | Honestidad con especialidades | Alta | Ante una pregunta por una especialidad, el agente dice que el registro no detalla especialidades, da sedes del tipo de atención correspondiente y sugiere confirmar con la EPS | ADR 0001 | CP-007 |
| RF-017 | No mencionar la fecha de corte | Media | En una conversación completa buscando sedes no aparece "noviembre", "2022" ni "fecha de corte" en el audio ni en el texto del agente | ADR 0001, GUIA-QA | CP-014 |
| RF-018 | Cita solo del documento | Media | Un dato tomado del documento incluye "según tu documento". Un dato del registro se da sin frase de fuente | ADR 0001, GUIA-QA | CP-015, CP-071 |
| RF-019 | Salida de sedes | Alta | Por voz, máximo 3 sedes (nombre y dirección). En pantalla, tarjetas con todas las encontradas (hasta 20) con dirección, teléfono, naturaleza y capacidad | ADR 0001 | CP-016 |
| RF-020 | Fuera de la misión | Media | Ante una pregunta ajena a la misión, el agente redirige en una frase ("Puedo ayudarte a encontrar dónde atenderte o a entender tu documento") y no la responde | ADR 0001 | CP-010 |
| RF-021 | Documento que no es de salud | Alta | Un documento no médico se resume y se responde con rigor; la herramienta de sedes no se invoca salvo que la pregunta sea de atención en salud | ADR 0001 | CP-013 |
| RF-022 | Sin diagnóstico ni comparaciones | Alta | El agente nunca diagnostica, recomienda tratamientos o medicamentos, ni dice que una sede es mejor que otra. En 4 de 4 preguntas de prueba | ADR 0001 | CP-017 |
| RF-023 | Estilo de voz | Media | Cada turno del agente tiene máximo dos frases y una pregunta, sin listas ni formato. Se verifica en 10 turnos | ADR 0001 | CP-018 |

## 2. Requerimientos no funcionales

| ID | Requerimiento | Prioridad | Criterio de aceptación (umbral verificable) | Origen | Casos |
|---|---|---|---|---|---|
| RNF-001 | Despliegue público | Alta | URL HTTPS estable en Cloud Run (us-east1), accesible desde otra red y otro equipo sin instalar nada, con certificado válido | R08 (10 %) | CP-038 |
| RNF-002 | Experiencia de usuario | Alta | Estados visibles: escuchando, pensando, hablando. Cero errores en la consola del navegador durante un flujo completo | Criterio 25 % | CP-034, CP-035 |
| RNF-003 | Robustez y disponibilidad | Alta | `GET /api/health` responde 200 en menos de 500 ms. Disponibilidad de 100 % durante la ventana de evaluación (sin arranque en frío, `min-instances=1`). Si el WebSocket se cae, la interfaz lo indica y permite reconectar en 5 s o menos | M07 | CP-036, CP-037, CP-040 |
| RNF-004 | Seguridad del WebSocket y abuso | Alta | `/ws/agent` rechaza: Origin fuera de la lista blanca, tercera sesión simultánea desde una misma IP (máximo 2), conexiones sobre el límite por IP, sesiones sobre el tope global, mensajes sobre el tamaño máximo, tipos de mensaje desconocidos. La sesión se cierra al superar la duración máxima. Una sesión nunca accede a datos de otra. La consulta al registro no es inyectable y un documento con instrucciones hostiles no cambia las reglas del agente | CLAUDE.md sec. 4 | CP-029, CP-041 a CP-048, CP-057, CP-067, CP-068, CP-070 |
| RNF-005 | Cabeceras de seguridad | Alta | Toda respuesta HTML incluye HSTS, CSP en modo report-only, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy` y `Permissions-Policy` con micrófono solo para `self` | CLAUDE.md sec. 4 | CP-049 a CP-051 |
| RNF-006 | Secretos y exposición | Alta | Las claves viven solo en el servidor (Secret Manager) y no aparecen en el bundle del cliente. `/.env`, `/.git/config` y los source maps no responden 200. Los errores al cliente son genéricos, sin trazas. `.env` no está versionado y gitleaks no reporta hallazgos | CLAUDE.md sec. 4 | CP-002, CP-052 a CP-056 |
| RNF-007 | Rendimiento y carga | Alta | Smoke: p95 menor a 800 ms. Carga con 20 VUs: p95 menor a 1000 ms y errores menores a 1 %. Estrés (hasta 150 VUs): p95 menor a 3000 ms y errores menores a 5 %, con recuperación tras bajar la carga. Picos (120 VUs): errores menores a 5 %. Los límites del WebSocket rechazan el 100 % de los intentos excedentes | Plan de pruebas | CP-058 a CP-062 |
| RNF-008 | README de una página | Media | Contiene stack, arquitectura, decisiones, variables de entorno, cómo correr pruebas y qué se generó con IA. Un tercero levanta el proyecto en menos de 15 min siguiendo solo el README | E03, M04 | CP-039 |
| RNF-009 | Dependencias y repositorio limpios | Alta | `npm audit --omit=dev` con 0 vulnerabilidades. gitleaks sin hallazgos en lo versionado. Lockfile presente y `npm ci` exitoso | CLAUDE.md sec. 4 | CP-003, CP-064, CP-065 |
| RNF-010 | Regresión automatizada | Media | `node --test` en `web/server/*.test.mjs` con 0 fallos antes de cada despliegue y de cada merge | CLAUDE.md sec. 7 | CP-063 |

## 3. Verificación de cobertura

- Requerimientos: 23 funcionales (RF-001 a RF-023) y 10 no funcionales (RNF-001 a RNF-010), 33 en total.
- Casos de prueba en `docs/TESTING.md`: 65 (CP-001 a CP-065).
- Todo requerimiento tiene al menos un caso (columna "Casos") y todo caso apunta a un requerimiento existente. La matriz se revisa antes de la entrega.

## 4. Supuestos y pendientes

- Formatos de documento de hoy: PDF, DOCX y TXT. CSV, XLSX y MD del plan original quedan fuera hasta recibir R01 a R07.
- Límite de tamaño de 20 MB tomado de `docs/PLAN.md`; confirmar contra el valor implementado.
- Limitaciones de datos aceptadas (ADR 0001): sin especialidades, EPS, cupos, horarios ni disponibilidad en tiempo real.
