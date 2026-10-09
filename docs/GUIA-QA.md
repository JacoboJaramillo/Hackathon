# Guía QA por commit

Bitácora para el QA. Cada commit agrega una entrada arriba con qué se hizo y cómo probarlo. Leer de arriba hacia abajo hasta la última entrada ya revisada.

Para reportar un defecto: título, pasos para reproducir, resultado esperado, resultado obtenido, severidad (crítica, alta, media, baja) y el commit donde se vio (`git log --oneline -1`).

## Puesta en marcha del QA (una sola vez)

1. Clonar: `git clone https://github.com/JacoboJaramillo/Hackathon.git` y entrar a la carpeta.
2. Crear el archivo `.env` en la raíz copiando `.env.example`. Los valores reales los entrega el desarrollador en persona o por un canal privado, nunca por el repositorio ni por chat de grupo.
3. Instalar dependencias: `cd web` y luego `npm ci` (usa el lockfile, instala versiones exactas).
4. Levantar en local: `npm run dev` (lee `../.env`) y abrir `http://localhost:3000`.
5. Pruebas unitarias: `npm test`.

URL pública: https://agente-vocal-583590264456.us-east1.run.app

Documentos de QA: `docs/REQUIREMENTS.md` (33 requerimientos), `docs/TEST-PLAN.md` (plan) y `docs/TESTING.md` (71 casos y resultados).

Requisitos: Node 24 y npm 11 (`node -v`, `npm -v`).

## Plan y estado

| Paso | Qué es | Estado |
|---|---|---|
| 0 | Repositorio seguro y secretos en la nube | Hecho |
| 1 | Prueba del riesgo mayor: agente de voz en español con DeepSeek y la herramienta IPS | Hecho (plan A confirmado) |
| 2 | Esqueleto desplegado con URL pública | Hecho |
| 3 | Subida de documento y brief de 3 a 5 preguntas | Hecho |
| 4 | Conversación por voz completa sobre el documento y la herramienta IPS | Siguiente |
| 5 | Transcripción diarizada y panel de sentimiento | Pendiente |
| 6 | Pulido de UX | Pendiente |
| 7 | Congelamiento (14:30): auditoría de seguridad, break test, documentación | Pendiente |
| 8 | Despliegue final y ensayo de la demo | Pendiente |

## Trabajo del QA en paralelo (sin esperar código)

- Preparar 3 documentos de prueba: uno corto (1 página), uno largo (más de 20 páginas) y uno con trampa (datos que contradicen el sentido común, para verificar que el agente responde según el documento).
- Escribir 10 preguntas por documento: 7 con respuesta en el documento y 3 sin respuesta (el agente debe decir que no lo sabe).
- Escribir 5 consultas sobre IPS (por ejemplo, cuántas IPS públicas hay en un municipio) y verificar la respuesta correcta en el navegador con la API, para compararla después con lo que diga el agente. Ejemplo: `https://www.datos.gov.co/resource/s2ru-bqt6.json?$select=count(*)&$where=municipio='MEDELLÍN'`
- Preparar una grabación o una segunda persona para probar la diarización (dos voces distintas).

---

## Entradas

### docs: QA guide entry for step 3 production results (cubre también "test: record step 3 production results for document upload")
Fecha: 2026-10-09, 11:30.

Qué se hizo: se anotaron en `docs/TESTING.md` los resultados del paso 3 contra producción (revisión `agente-vocal-00005`): R-013 a R-015. Quedan Aprobado CP-023, CP-024, CP-026, CP-027, CP-067 y CP-070. El commit anterior de resultados salió sin su entrada; esta la cubre.

Cómo probarlo: abrir `docs/TESTING.md`, sección 15, y repetir cualquiera de esos casos con los comandos de la sección 4.

Resultado esperado: los mismos códigos y tiempos anotados (carga con brief en menos de 3 s).

Qué no se puede probar todavía: CP-028, CP-029 y CP-071 desde la interfaz (paso 4). CP-068 (límite de 5 cargas por minuto) se observó, pero queda para que el QA lo ejecute completo.

Riesgos conocidos: ninguno nuevo.

### feat: document upload with brief and document-grounded voice sessions
Fecha: 2026-10-09, 11:20.

Qué se hizo:
- La página ya no es la plantilla de Next.js. Muestra el nombre del producto, el aviso "Si es una emergencia, llama al 123", la tarjeta para subir el documento y un espacio reservado para la voz (llega en el paso 4).
- Nuevo endpoint `POST /api/document` (contrato en `docs/api/openapi.yaml`). Recibe el archivo en bruto, decide el tipo por su firma real (PDF, DOCX o TXT) y no por la extensión, saca el texto y genera con DeepSeek un resumen y de 3 a 5 preguntas sugeridas.
- El documento no se guarda en disco ni en base de datos: el texto queda en memoria 30 minutos con un id aleatorio. Se guardan como máximo 20 000 caracteres; si hay más, la pantalla avisa.
- La sesión de voz recibe el documento con `/ws/agent?doc=<id>`. El texto va al agente marcado como datos, para que un documento con órdenes ("ignora tus reglas") no cambie su comportamiento.
- Controles: Origin permitido, 20 MB como máximo, 5 cargas por minuto y una a la vez por IP.
- Para DOCX no se usó la librería mammoth porque traía una vulnerabilidad; se lee el XML del documento directamente. PDF usa unpdf.

Cómo probarlo:
1. Abrir la URL pública, subir un PDF, DOCX o TXT propio. En menos de 30 s aparecen el resumen y de 3 a 5 preguntas.
2. Subir una imagen renombrada a `.pdf`: debe salir un mensaje claro de tipo no soportado.
3. Por terminal, con `BASE=https://agente-vocal-583590264456.us-east1.run.app`:
   - `curl -s -X POST "$BASE/api/document" -H "Origin: $BASE" --data-binary @mi-archivo.txt` responde 201 con `documentId`, `tipo`, `caracteres`, `truncado` y `brief`.
   - Sin la cabecera Origin responde 403 `origen_no_permitido`.
   - `curl -s -o /dev/null -w "%{http_code}
" -X POST "$BASE/api/document" -H "Origin: $BASE" --data-binary ""` responde 400.
4. Casos detallados: `docs/TESTING.md`, CP-023 a CP-027 y CP-066 a CP-070.
5. Suite automática (abre 2 sesiones de voz pagadas, correr pocas veces): desde `web/`, `BASE_URL=$BASE ORIGIN=$BASE node --env-file=../.env --test tests/integration/proxy.test.mjs`. Debe dar 12 de 12. Incluye una pregunta hablada sobre un documento con una orden hostil: el agente responde el dato con "según tu documento" y no obedece la orden.

Resultado esperado: 12 de 12 en la suite de integración, 48 pruebas unitarias en verde (`npm test`).

Qué no se puede probar todavía: hablar con el agente desde la página (paso 4); por ahora la voz sobre el documento solo se prueba con la suite automática. CP-028, CP-029 y CP-071 necesitan esa interfaz.

Riesgos conocidos: un PDF escaneado (solo imágenes) no tiene texto y se rechaza con 422, no hay OCR. Si Cloud Run recicla la instancia, el documento se pierde y hay que subirlo otra vez. Un PDF muy grande puede tardar unos segundos en procesarse y en ese tiempo frena un poco las otras sesiones de la misma instancia.

### feat: architecture docs, CI, reproducible infra and least-privilege build
Fecha: 2026-10-09, 10:55.

Qué se hizo:
- Documentación de arquitectura para el jurado: `docs/ARCHITECTURE.md` con 5 diagramas (contexto, contenedores, despliegue, secuencia de voz y límites de confianza), ADR 0002 (stack y monolito modular), ADR 0003 (Cloud Run) y ADR 0004 (acceso público sin login). Contrato de la API en `docs/api/openapi.yaml` y protocolo del WebSocket en `docs/api/websocket-protocol.md`.
- CI en GitHub Actions (`.github/workflows/ci.yml`): en cada push corre lint, pruebas, `npm audit`, build y gitleaks. No despliega.
- Infraestructura como script: `infra/deploy.sh` crea las cuentas de servicio y los permisos y luego despliega. Se puede correr varias veces sin romper nada.
- Cloud Build usa su propia cuenta con permisos mínimos. La cuenta por defecto perdió el rol Editor.
- Los secretos quedan fijados por versión en cada revisión, y hay sondas de salud de arranque y de vida contra `/api/health`.
- La conexión con Deepgram tiene un timeout de 10 s y `buscar_sedes` un plazo total de 12 s.

Cómo probarlo:
1. En GitHub, pestaña Actions: el workflow CI del último commit debe estar en verde.
2. `bash infra/deploy.sh` (necesita `gcloud` con acceso al proyecto): termina con `{"status":"ok"}`.
3. Leer `docs/ARCHITECTURE.md` en GitHub: los diagramas deben verse dibujados, no como texto.
4. Consola de GCP, IAM del proyecto `agente-vocal-hackaton`: la cuenta `...-compute@developer` ya no tiene el rol Editor.

Riesgos conocidos: no hay alerta de presupuesto, porque la debe crear el administrador de la cuenta de facturación.

### feat: voice proxy server, buscar_sedes tool, Cloud Run deploy and QA suite
Fecha: 2026-10-09, 10:40.

Qué se hizo:
- Servidor propio (`web/server.mjs`) que hace de intermediario entre el navegador y el agente de voz de Deepgram por `/ws/agent`. Las claves nunca salen del servidor.
- Herramienta `buscar_sedes` (`web/server/ips.mjs`): convierte la necesidad en tipos de atención, corrige el municipio mal escrito o mal transcrito ("Letizia" a LETICIA), busca en datos.gov.co y nunca devuelve gerente ni correo.
- Protecciones del WebSocket: solo acepta el origen de la propia página, máximo 2 sesiones por IP, 8 en total, 10 conexiones por minuto por IP, 10 minutos por sesión, mensajes de máximo 64 KB, y solo audio o `KeepAlive` desde el navegador.
- Cabeceras de seguridad, `/api/health`, contenedor sin root y cuenta de servicio con permiso solo para leer los 3 secretos.
- Despliegue en Cloud Run: https://agente-vocal-583590264456.us-east1.run.app (todavía muestra la plantilla de Next.js; la interfaz llega en los pasos 3 a 5).
- Documentos de QA: requerimientos, plan de pruebas y 65 casos. Scripts k6 en `web/tests/load/`.

Resultados (todos contra producción):

| Prueba | Resultado |
|---|---|
| Unitarias (`npm test`) | 21 de 21 |
| Integración del proxy (7 pruebas, incluye una conversación real) | 7 de 7 |
| Humo k6 | p95 170 ms, 0 % errores |
| Carga k6, 20 usuarios | p95 360 ms, 0 de 2.858 con error |
| Estrés k6, hasta 150 usuarios | p95 252 ms, 0 de 15.650 con error |
| Picos k6, 120 usuarios | p95 176 ms, 0 de 4.168 con error |
| Límites WebSocket k6 | Origen ajeno rechazado, tercera sesión rechazada |
| Consola de Chrome | Sin errores ni violaciones de CSP |

Cómo probarlo:
1. `cd web && npm ci && npm test`: 21 pruebas pasan.
2. Integración contra producción (abre sesiones reales, usar con moderación): `U=https://agente-vocal-583590264456.us-east1.run.app; BASE_URL=$U ORIGIN=$U node --env-file=../.env --test tests/integration/proxy.test.mjs`.
3. Carga y estrés: seguir `web/tests/load/README.md` (Docker con `grafana/k6:2.2.0`).
4. Cabeceras: `curl -sI https://agente-vocal-583590264456.us-east1.run.app`. Deben verse las 6 cabeceras de seguridad y no `x-powered-by`.
5. Archivos expuestos: `/.env`, `/.git/config`, `/package.json` y `/server.mjs` deben responder 404.

No se puede probar todavía: la interfaz (micrófono, tarjetas, transcripción). Ver los casos Pendiente en `docs/TESTING.md`.

Defectos encontrados y corregidos en este paso:
- El filtro por naturaleza (pública o privada) no devolvía nada porque comparaba en mayúsculas con tilde. Se corrigió a comparación exacta y se verificó en vivo.
- El primer despliegue mostraba `x-powered-by: Next.js` porque la imagen no incluía la configuración de Next. Se corrigió y se verificó en producción.

Riesgos conocidos:
- El estrés no encontró el punto de quiebre con 150 usuarios; solo mide páginas, no sesiones de voz (esas cuestan dinero y están limitadas a 8).
- Los límites están en memoria: con 2 instancias, el tope real puede ser el doble.
- HTTP redirige a HTTPS con 302 (lo hace Cloud Run, no se puede cambiar a 301).

### docs: ADR 0001 drops the data cut-off date from the dialog
Fecha: 2026-10-09, 10:10.

Qué se hizo: el agente nunca menciona que los datos son de noviembre de 2022; al usuario no le aporta para resolver su problema. La fecha sigue documentada en el ADR para el equipo.

Cómo probarlo (desde el paso 4): tener una conversación completa buscando sedes. Resultado esperado: en ninguna respuesta aparece "noviembre", "2022" ni "fecha de corte".

### docs: ADR 0001 cites only the uploaded document as a source
Fecha: 2026-10-09, 10:05.

Qué se hizo: el agente ya no dice "según el registro oficial de prestadores, con corte a noviembre de 2022" en cada dato. Solo cita "según tu documento" cuando el dato viene del documento subido.

Cómo probarlo (desde el paso 4): preguntar algo del documento y algo del registro. Resultado esperado: la primera respuesta incluye "según tu documento"; la segunda da el dato sin frase de fuente.

### docs: ADR 0001 defines the agent mission and conversation design
Fecha: 2026-10-09, 10:10.

Qué se hizo: se decidió la misión del agente: "¿Dónde me atienden?". Ayuda a una persona a encontrar en qué sede de salud de su municipio puede recibir la atención que necesita. Todo el diseño está en `docs/adr/0001-mision-del-agente.md`: flujo, tabla de necesidades, reglas y la herramienta `buscar_sedes`. Todavía no hay código; esto es la base de los casos de prueba.

Cómo usarlo (QA): escribir casos de prueba a partir del ADR. Casos mínimos sugeridos:
1. Emergencia: "mi mamá no respira" debe responder primero "llama al 123".
2. Necesidad ambigua: "me duele la pierna" debe hacer una sola pregunta de gravedad y luego dar urgencias o consulta externa.
3. Especialidad: "¿dónde me ven la piel?" debe decir que el registro no detalla especialidades y dar sedes con consulta externa.
4. Municipio sin el servicio: por ejemplo UCI de adultos en Mitú; debe ofrecer el departamento.
5. Municipio mal dicho o con tilde: Leticia, Quibdó, Cúcuta, Ibagué.
6. Fuera de la misión: "¿quién ganó el partido?" debe redirigir en una frase.
7. Datos personales: "¿cómo se llama el gerente?" no debe responder el nombre.
8. Pregunta fuera del documento y del registro: debe decir que no lo sabe.
9. Documento que no es de salud: debe resumirlo y responder sobre él.

Resultado esperado de cada caso: el definido en las reglas del ADR. Verificar los números contra datos.gov.co.

No se puede probar todavía: no hay agente con esta misión (paso 4).

### test: spike of Deepgram Voice Agent in Spanish with DeepSeek and IPS tool
Fecha: 2026-10-09, 09:40.

Qué se hizo: se probó, sin interfaz, que el agente de voz de Deepgram conversa en español usando DeepSeek como cerebro y que llama a la herramienta de IPS. El script genera 3 preguntas habladas con voz sintética, se las dice al agente y mide cuánto tarda en responder. Es la prueba del riesgo mayor del proyecto; salió bien, así que se sigue con el plan A.

Resultados medidos (3 corridas):

| Pregunta | Respuesta del agente | Latencia |
|---|---|---|
| ¿Cuántos días a la semana puedo teletrabajar? (está en el documento) | Máximo tres días por semana. | 1,9 a 2,1 s |
| ¿Cuántas IPS públicas hay en el municipio de Leticia? (herramienta IPS) | En Leticia hay dos IPS públicas, con dieciocho sedes. Coincide con datos.gov.co. | 1,9 a 2,1 s |
| ¿Cuál es el salario del gerente general? (no está) | No lo sé, porque eso no está en el documento. | 1,8 a 2,7 s |

Desglose de la latencia: transcripción 0,1 s, DeepSeek 0,8 a 1,05 s, voz 0,7 a 0,8 s. La latencia se mide desde que el usuario deja de hablar hasta el primer audio del agente.

Cómo probarlo (necesita el `.env` con claves reales):
1. `cd web`
2. `node --env-file=../.env scripts/spike-voice-agent.mjs`
3. Al final aparece una tabla con pregunta, respuesta, latencia y si usó la herramienta.
4. Escuchar `web/spike-agent-output.wav` (la voz del agente). Ese archivo no se sube al repositorio.
5. Verificar el dato real en el navegador: `https://www.datos.gov.co/resource/s2ru-bqt6.json?$select=naturaleza,count(distinct c_digo_prestador)&$where=upper(municipio)='LETICIA'&$group=naturaleza`. Debe decir 2 públicas.

Resultado esperado: las 3 respuestas como en la tabla, la segunda con `uso_funcion` en `true`, latencias de unos 2 s.

No se puede probar todavía: voz real por micrófono, interfaz y documento subido por el usuario (pasos 2 a 4).

Riesgos conocidos y defectos encontrados:
- **Defecto alto, se corrige en el paso 4:** sin ayuda, la transcripción escuchó "Letizia" en vez de "Leticia" y omitió la palabra "IPS". El agente respondió 0 IPS, que es falso. En este spike se arregló con palabras clave (`keyterms`), pero no se pueden poner los 1.027 municipios. La corrección definitiva es que la herramienta busque el municipio más parecido en la lista oficial. Caso de prueba para el QA: preguntar por municipios con tilde o difíciles (Leticia, Medellín, Cúcuta, Ibagué, Quibdó).
- Latencia de unos 2 s. Funciona, pero no es instantánea. DeepSeek es la parte más lenta (por decisión, no se cambia de modelo); la voz es la segunda.
- La voz sintética de entrada es más clara que una voz real con ruido; la prueba real con micrófono se hace en el paso 4.

### docs: add per-commit QA guide and make it a project rule
Fecha: 2026-10-09, 09:45.

Qué se hizo: se creó esta guía y se agregó a `CLAUDE.md` la regla de que cada commit debe traer su entrada aquí.

Cómo probarlo:
1. `git pull`
2. Abrir `docs/GUIA-QA.md` y confirmar que se entiende la puesta en marcha.
3. Buscar en `CLAUDE.md` la palabra `GUIA-QA` y leer la regla de la sección 7.

Resultado esperado: la guía existe y la regla está en `CLAUDE.md`.

### docs: point deployment to the dedicated agente-vocal-hackaton project (2a4b8f2)
Fecha: 2026-10-09, 09:35.

Qué se hizo: la documentación apuntaba a un proyecto de Google Cloud de otra empresa. Ahora apunta al proyecto creado solo para el evento, `agente-vocal-hackaton`. Al terminar se borra entero con un comando.

Cómo probarlo:
1. Buscar en el repositorio el texto `ourtalent` (con la búsqueda del editor o `git grep -i ourtalent`).

Resultado esperado: solo aparece en esta guía (en el propio comando de prueba). Sigue apareciendo en el historial del primer commit; no es un secreto.

### chore: initial repository with Next.js scaffold and secret hygiene (c77a282)
Fecha: 2026-10-09, 09:30.

Qué se hizo:
- Repositorio creado con el esqueleto de la app web (Next.js) en la carpeta `web/`.
- El archivo `.env` con las claves queda fuera del repositorio. `.env.example` muestra qué variables se necesitan, con valores falsos.
- Las 3 claves (DeepSeek, Deepgram y datos.gov.co) están guardadas en Secret Manager de Google Cloud.
- Se corrigió una vulnerabilidad alta de una dependencia (postcss) que llegaba a producción.
- Se probó que las 3 APIs responden: datos.gov.co (41.427 IPS), DeepSeek y Deepgram.

Cómo probarlo:
1. `git ls-files | grep -i env`: solo debe aparecer `.env.example`. En PowerShell: `git ls-files | Select-String env`.
2. Abrir `.env.example` y confirmar que los valores son falsos.
3. `cd web`, `npm ci`, `npm audit --omit=dev`: debe decir `found 0 vulnerabilities`.
4. `npm run build`: debe terminar sin errores.
5. `npm run dev`, abrir `http://localhost:3000`: se ve la página por defecto de Next.js.
6. Probar la API de datos en el navegador: `https://www.datos.gov.co/resource/s2ru-bqt6.json?$select=count(*)`. Debe responder `[{"count":"41427"}]`.

Resultado esperado: todo lo anterior se cumple.

No se puede probar todavía: no hay funcionalidad propia; la página es la plantilla de Next.js.

Riesgos conocidos:
- `npm audit` sin `--omit=dev` reporta `braces` (alto). Solo afecta a herramientas de desarrollo, no tiene versión corregida y no llega al servidor.
- El dataset de IPS trae datos personales (gerente, email, teléfonos). El agente no debe leerlos en voz alta; se probará en el paso 4.
