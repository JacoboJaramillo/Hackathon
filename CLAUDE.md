# CLAUDE.md

Proyecto de hackathon. Equipo: 1 desarrollador + 1 QA. Este archivo es la fuente de verdad de las reglas del proyecto.

Producto: Reto 01 de Kognia Labs, Agente Vocal Cognitivo. Es un agente de voz que habla sobre un documento subido en vivo y consulta por API el dataset de IPS de datos.gov.co, con transcripción diarizada y panel de sentimiento. Misión del agente: "¿Dónde me atienden?", orientar al ciudadano sobre en qué sede de su municipio recibir la atención que necesita (ver `docs/adr/0001-mision-del-agente.md`). Requerimientos en `V2.xlsx`; plan, requerimientos inferidos y arquitectura en `docs/ARQUITECTURA.md`.

Despliegue: Google Cloud Run, proyecto `agente-vocal-hackaton` (creado solo para el evento), región `us-east1`. Los secretos van en Secret Manager. Al terminar el evento se desmonta todo (ver `docs/ARQUITECTURA.md`, sección 9.9 Costos y desmontaje).

## 1. Skills y herramientas obligatorias

Usar siempre, en cada sesión:

| Skill / herramienta | Uso |
|---|---|
| rtk | Proxy de CLI que reduce tokens. Los comandos se reescriben por hook. Verificar con `rtk gain`. |
| graphify | Obligatorio en este proyecto. Correr `/graphify` en cuanto exista código y re-correr tras cambios grandes. Consultar el grafo antes de explorar archivos a mano. |
| caveman | Respuestas del chat terse. No aplica a archivos persistidos: código, comentarios, commits y docs se escriben en prosa normal. |
| ponytail | Solución más simple que funcione. Escalera: ¿necesita existir? ¿ya está en el código? ¿stdlib? ¿nativo? ¿dependencia instalada? |
| karpathy-guidelines | Pensar antes de codificar, cambios quirúrgicos, criterios de éxito verificables, sin sobreingeniería. |
| web-security-audit | Modo build al escribir código sensible; modo audit antes de cada demo y antes del release. |

### Gestión de sesiones y modelos

- Haiku: búsquedas, renombrados, formato, tareas mecánicas.
- Sonnet: implementación diaria (default).
- Opus: arquitectura, diseño de seguridad, bugs difíciles, revisión final.
- `/compact` al terminar una unidad de trabajo o al acercarse a ~60% de contexto, indicando qué conservar.
- `/clear` al cambiar de tarea no relacionada. Nunca arrastrar contexto viejo.
- Subagentes para exploración amplia; el hilo principal solo recibe conclusiones.

## 2. Reglas de código

- Prohibido usar emojis en código, comentarios, commits, docs y logs.
- Comentarios solo cuando explican el porqué no obvio. Nada que repita lo que dice el código.
- Comentarios `ponytail:` para simplificaciones deliberadas con su techo y vía de mejora.
- Idioma: código e identificadores en inglés; documentación en español.
- Cambios mínimos y localizados. No refactorizar lo que no se pidió.
- Toda lógica no trivial deja una prueba ejecutable mínima.
- Sin dependencias nuevas si stdlib o lo ya instalado alcanza. Toda dependencia se verifica que exista en el registro oficial antes de instalarla (riesgo de paquetes alucinados).
- Convenciones: commits en formato Conventional Commits (`feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `security`).

## 3. Arquitectura

Decisión pendiente, con recomendación: **monolito modular** con fronteras estrictas, extraíble a servicios después.

Razón: con 2 personas y tiempo récord, microservicios agregan red, despliegues múltiples, tracing, contratos versionados y fallos parciales que consumen el tiempo que no existe. Un jurado valora un producto que funciona y está bien separado, no la cantidad de servicios.

Reglas que hacen la modularidad real y dejan la puerta abierta a microservicios:

- Un módulo por dominio (por ejemplo `auth`, `users`, `billing`). Cada uno con su API pública explícita.
- Un módulo nunca importa internals de otro, solo su interfaz pública.
- Cada módulo es dueño de sus tablas; ningún otro módulo las consulta directamente.
- Comunicación entre módulos por interfaces o eventos, nunca por acceso cruzado a datos.
- Contrato de API definido en OpenAPI antes de implementar.
- Config solo por variables de entorno. Servicios sin estado.

Si se elige microservicios por requisito del reto: máximo 2 a 3 servicios, un gateway único, contratos OpenAPI versionados, base de datos por servicio, docker compose para levantar todo con un comando.

## 4. Seguridad (objetivo: 10/10)

Aplicar `web-security-audit` en modo build desde la primera línea. Controles no negociables:

### Identidad y acceso
- Autorización verificada en el servidor en cada endpoint, por objeto (dueño del recurso) y por función (rol). Nunca confiar en IDs, roles o precios enviados por el cliente.
- Denegar por defecto. Rutas nuevas nacen protegidas.
- Contraseñas con argon2id o bcrypt. Nunca implementar criptografía propia.
- Tokens de acceso de vida corta, refresh con rotación y revocación. JWT: algoritmo fijado en el servidor, validar `exp`, `iss`, `aud`.
- Rate limit y bloqueo progresivo en login, registro, recuperación de contraseña y OTP.
- MFA para cuentas administrativas.

### Entrada y salida
- Validación de esquema en el servidor para todo input (tipo, longitud, rango, formato). Rechazar campos desconocidos.
- DTOs de entrada y de salida separados: sin mass assignment, sin devolver campos internos (hashes, flags, tokens).
- Consultas parametrizadas siempre. Nunca concatenar input en SQL, shell o rutas.
- Salida codificada según contexto. Sin `innerHTML` ni equivalentes con datos de usuario.
- Subidas de archivos: lista blanca de tipo real (no solo extensión), límite de tamaño, nombre generado, almacenadas fuera del webroot.
- Llamadas salientes con URL controlada por usuario: lista blanca de destinos (anti SSRF).
- Límites de tamaño de body, paginación obligatoria con tope, timeouts en toda llamada externa.

### Datos
- Secretos solo en variables de entorno o gestor de secretos. `.env` en `.gitignore` desde el primer commit. Rotar cualquier secreto que haya tocado el repositorio.
- Cifrado en tránsito (TLS) y en reposo para datos sensibles. No loguear datos personales ni tokens.
- Usuario de base de datos con mínimo privilegio. Base de datos sin exposición pública. Si es PostgreSQL/Supabase: RLS activado con políticas reales.
- Webhooks: verificar firma y rechazar repeticiones.

### Plataforma
- Headers: HSTS, CSP (primero report-only), `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, anti-clickjacking.
- CORS con lista explícita de orígenes. Nunca `*` en endpoints autenticados.
- Errores genéricos al cliente, detalle solo en logs del servidor. Sin stack traces ni banners de versión.
- Logging de eventos de seguridad (login fallido, cambios de permisos, accesos denegados) con IDs de correlación.
- Dependencias fijadas por lockfile, `npm audit` / equivalente sin críticos, escaneo de secretos (gitleaks) antes de cada push.
- Contenedores: usuario no root, imagen mínima, sin secretos en capas.

### Cadencia de auditoría
- Cada feature sensible: revisar contra esta sección antes de cerrar.
- Antes de la demo: `/web-security-audit` completo sobre repo y despliegue.
- El QA ejecuta el break test manual (acceder a recursos de otro usuario, saltar roles, manipular precios, inputs hostiles) sobre cada endpoint nuevo.

## 5. Documentación del proyecto

Mínima, viva y en el repositorio. Nada que se desactualice en horas.

| Archivo | Contenido |
|---|---|
| `README.md` | Qué es, cómo levantarlo con un comando, variables de entorno requeridas, cómo correr pruebas. |
| `CLAUDE.md` | Este archivo. Reglas para el agente. |
| `docs/ARQUITECTURA.md` | Arquitectura completa: módulos, flujo de datos, límites de confianza, integraciones, modelo de datos, DevOps, capacidad, resumen de seguridad y pruebas. |
| `docs/adr/NNNN-titulo.md` | Una decisión por archivo (contexto, decisión, consecuencias). Obligatorio para stack, arquitectura y autenticación. |
| `docs/api/openapi.yaml` | Contrato de la API. Fuente de verdad, se escribe antes del código. |
| `docs/SECURITY.md` | Modelo de amenazas breve, controles implementados, resultados de auditoría, deuda de seguridad conocida. |
| `docs/diagrams/` | Generador de los diagramas (`code/build.py`) y sus imágenes (`img/*.png`). |
| `docs/PRUEBAS-AUDIO.md` | Reporte de pruebas de audio y voz con lista de verificación. |
| `docs/QA-CONVERSACIONES.md` | Guion de frases para intentar romper el agente. |
| `docs/entregables/` | Documentos Word entregables y los scripts que los generan. |
| `docs/PRUEBAS.md` | Registro detallado de todas las pruebas. |
| `docs/CODIGO.md` | Documentación del código archivo por archivo. |
| `.env.example` | Todas las variables con valores falsos. Nunca valores reales. |
| `CHANGELOG.md` | Cambios por versión. |

### 5.1 Diagramas y herramienta

- **FossFLOW** (diagramas isométricos, MIT, PWA con soporte offline) para presentar la arquitectura y las integraciones. Se usa en el repositorio indicado (`github.com/victortassinari/FossFLOW`); el proyecto original es `stan-smith/FossFLOW`. Local: `git clone`, `npm install`, `npm run build:lib`, `npm run dev` en `http://localhost:3000`. Docker: `docker compose up`, guarda en `./diagrams`. Exporta e importa JSON.
- FossFLOW es una herramienta de diagramas de infraestructura, no de entidad-relación. El modelo de datos se mantiene como **Mermaid `erDiagram`** (texto versionable, se renderiza en GitHub) y, para la presentación, se muestra además una vista FossFLOW de los almacenes de datos y sus conexiones. Fuente de verdad: el ER en Mermaid.
- El generador de diagramas y sus imágenes se guardan en `docs/diagrams/`. Se exporta imagen de cada diagrama para el README y las diapositivas.
- Diagramas mínimos: contexto del sistema, contenedores/módulos, flujo de datos con límites de confianza, despliegue, secuencia de los flujos críticos (login, flujo principal del producto), integraciones, modelo de datos.

### 5.2 Documentación técnica que se presenta

1. Arquitectura: contexto, módulos, decisiones (ADR), despliegue, límites de confianza.
2. Diseño técnico: stack y justificación, patrones, manejo de errores, observabilidad, seguridad.
3. Modelo de datos: ER, diccionario, índices, migraciones, datos sensibles y cifrado.
4. APIs y servicios: contrato OpenAPI, autenticación, códigos de error, versionado, límites, ejemplos de uso.
5. Integraciones: tabla por integración con propósito, protocolo, autenticación, formato, reintentos y plan ante caída.
6. Trazabilidad y pruebas (5.3 y 5.4).

Orden de la presentación: problema, requerimientos, arquitectura (recorrido sobre el diagrama FossFLOW), modelo de datos, integraciones y APIs, seguridad, demo, resultados de pruebas y trazabilidad, siguientes pasos. Cada diagrama se explica de izquierda a derecha siguiendo un flujo real de usuario.

### 5.3 Trazabilidad de requerimientos

- Cada requerimiento tiene ID estable y criterio de aceptación medible.
- La trazabilidad vive en `docs/PRUEBAS.md` (requerimiento por prueba) y en `docs/ARQUITECTURA.md` sección 2 (requerimientos y umbrales).
- Cada commit, endpoint del OpenAPI (`x-requirement`) y caso de prueba referencia su ID de requerimiento. Los tests llevan el ID en el nombre o etiqueta.
- Regla: ningún requerimiento sin al menos un caso de prueba, y ningún caso de prueba sin requerimiento. Se revisa la matriz antes de la entrega.
- Los requerimientos no funcionales (rendimiento, seguridad, disponibilidad) llevan un umbral numérico verificable.

### 5.4 Plan de pruebas

El plan de pruebas (en `docs/ARQUITECTURA.md` sección 11) contiene: alcance, estrategia, entornos, datos de prueba, roles, criterios de entrada y salida, gestión de defectos (severidad y prioridad), riesgos, métricas y reporte. Tipos de prueba y herramientas sugeridas:

| Tipo | Objetivo | Herramienta sugerida |
|---|---|---|
| Unitarias | Lógica aislada | Del stack (pytest, jest, JUnit) |
| Integración | Módulos, base de datos y servicios externos juntos | Testcontainers, supertest |
| Contrato | API cumple OpenAPI; consumidores y proveedores alineados | Schemathesis, Pact |
| Funcionales / API | Cada requerimiento contra su criterio de aceptación | Postman/Newman, REST Client |
| Sistema / E2E | Flujos completos de usuario | Playwright |
| Humo (smoke) | El build desplegado arranca y funciona lo esencial | Script mínimo en CI |
| Sanidad | Verificación puntual tras un cambio | Subconjunto manual o automático |
| Regresión | Lo existente sigue funcionando tras cada cambio | Suite completa en CI |
| Aceptación (UAT) | El usuario valida contra los criterios | Checklist firmado |
| Carga | Comportamiento con la carga esperada | k6, Locust, JMeter |
| Estrés | Punto de quiebre y recuperación | k6, Locust |
| Picos (spike) | Subida brusca de tráfico | k6 |
| Resistencia (soak) | Fugas de memoria y degradación en horas | k6, Locust |
| Escalabilidad y volumen | Crecimiento de usuarios y de datos | k6, datos sintéticos |
| Seguridad | SAST, DAST, dependencias, secretos, autorización | semgrep, ZAP, trivy, gitleaks, `web-security-audit` |
| Autorización | Matriz anónimo, usuario A, usuario B, otro tenant, admin | Pruebas automatizadas de la matriz |
| Accesibilidad | WCAG 2.2 AA | axe, Lighthouse |
| Usabilidad | Flujos comprensibles | Prueba con usuarios y heurísticas |
| Compatibilidad | Navegadores y dispositivos | Playwright multi-navegador |
| Recuperación y resiliencia | Caída de servicios, backups, restauración | Pruebas de fallo manuales o chaos básico |
| Migración de datos | Migraciones suben y bajan sin pérdida | Scripts de verificación |
| Exploratoria | Descubrir lo que los casos no previeron | Sesiones con carta de prueba |

Para un hackathon se prioriza por riesgo: obligatorias unitarias de lógica crítica, integración, contrato, E2E del flujo principal, regresión en CI, seguridad y autorización, humo, y una corrida breve de carga y estrés sobre el endpoint más costoso con umbrales definidos (por ejemplo p95 de latencia y tasa de error). Las demás se documentan con su estrategia aunque se ejecuten parcialmente, indicando qué no se ejecutó y por qué.

## 6. Multiagentes

Usar subagentes en paralelo cuando el trabajo se pueda dividir en partes independientes. Objetivo: velocidad sin perder control.

Cuándo paralelizar:
- Exploración o búsqueda amplia en el código (agentes `Explore` o `cavecrew-investigator`).
- Implementar módulos distintos que no comparten archivos, tras fijar el contrato OpenAPI.
- Auditoría de seguridad en pistas independientes: inventario, autenticación, autorización, entrada de datos, consumo de recursos, configuración (ver `api-security.md` sección 17 de la skill).
- Revisión de código en paralelo con la escritura de pruebas.
- Investigación de varias opciones técnicas a la vez.

Cuándo no:
- Tarea de pocos pasos o un archivo: hacerla directo.
- Trabajo que depende del resultado anterior: va en secuencia.
- Dos agentes editando el mismo archivo: nunca.

Reglas:
- Fijar interfaces y contratos antes de lanzar agentes que implementan; cada agente es dueño de archivos distintos.
- Brief completo en cada agente: objetivo, archivos, restricciones, qué ya se descartó. Sin contexto implícito.
- Lanzar los agentes independientes en un solo mensaje para que corran a la vez.
- Modelo por tarea: Haiku para búsqueda y mecánico, Sonnet para implementar, Opus para diseño y revisión final.
- Agentes de auditoría son de solo lectura; las correcciones las aplica el hilo principal tras revisar.
- El hilo principal verifica el resultado de cada agente (build, pruebas) antes de darlo por bueno.
- Máximo 4 a 5 agentes simultáneos para no perder el control del merge.

## 7. Calidad y flujo de trabajo

- Ramas cortas por tarea; PR revisado por la otra persona o por `/code-review` antes de merge.
- CI mínimo: lint, pruebas, escaneo de secretos y de dependencias.
- Definición de hecho: funciona, tiene prueba, pasa lint, sin secretos, documentado si cambió el contrato.
- Cada cambio que afecte el comportamiento actualiza docs/PRUEBAS.md con su prueba y resultado.
- Reparto: el desarrollador construye; el QA escribe casos desde el contrato OpenAPI en paralelo, prueba contra los criterios de aceptación y ejecuta el break test.
- Congelar funcionalidades unas horas antes de la entrega; ese tiempo es para auditoría, pruebas y demo.

## 8. Pendientes de decisión

- Propuesto en `docs/ARQUITECTURA.md`, pendiente de confirmar: FastAPI (Python) + React, monolito modular en un servicio de Cloud Run, sin base de datos (vectores en memoria).
- Proveedores: STT Deepgram (diarización); LLM Claude Haiku 5.5 o Gemini Flash vía Vertex; TTS ElevenLabs Flash, Deepgram Aura o Cartesia.
- Faltan R01 a R07, el 30 % de los criterios y la hoja "02 CRITERIOS" del Excel.
- Al decidirlos: registrar un ADR, actualizar este archivo y correr `/graphify`.
