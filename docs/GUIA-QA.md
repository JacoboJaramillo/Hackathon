# Guía QA por commit

Bitácora para el QA. Cada commit agrega una entrada arriba con qué se hizo y cómo probarlo. Leer de arriba hacia abajo hasta la última entrada ya revisada.

Para reportar un defecto: título, pasos para reproducir, resultado esperado, resultado obtenido, severidad (crítica, alta, media, baja) y el commit donde se vio (`git log --oneline -1`).

## Puesta en marcha del QA (una sola vez)

1. Clonar: `git clone https://github.com/JacoboJaramillo/Hackathon.git` y entrar a la carpeta.
2. Crear el archivo `.env` en la raíz copiando `.env.example`. Los valores reales los entrega el desarrollador en persona o por un canal privado, nunca por el repositorio ni por chat de grupo.
3. Instalar dependencias: `cd web` y luego `npm ci` (usa el lockfile, instala versiones exactas).
4. Levantar en local: `npm run dev` y abrir `http://localhost:3000`.

Requisitos: Node 24 y npm 11 (`node -v`, `npm -v`).

## Plan y estado

| Paso | Qué es | Estado |
|---|---|---|
| 0 | Repositorio seguro y secretos en la nube | Hecho |
| 1 | Prueba del riesgo mayor: agente de voz en español con DeepSeek y la herramienta IPS | Siguiente |
| 2 | Esqueleto desplegado con URL pública | Pendiente |
| 3 | Subida de documento y brief de 3 a 5 preguntas | Pendiente |
| 4 | Conversación por voz completa sobre el documento y la herramienta IPS | Pendiente |
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
