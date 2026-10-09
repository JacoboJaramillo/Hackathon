# Plan de pruebas

Producto: Agente Vocal Cognitivo "¿Dónde me atienden?" (Reto 01, Kognia Labs). Requerimientos en `docs/REQUIREMENTS.md`; casos en `docs/TESTING.md`; misión del agente en `docs/adr/0001-mision-del-agente.md`.

Calendario del día: congelamiento de funcionalidades a las 14:30, entrega a las 16:00. Las pruebas funcionales corren en paralelo al desarrollo; de 14:30 a 16:00 solo se audita, se prueba y se ensaya la demo.

## 1. Alcance

Dentro del alcance:
- Aplicación Next.js con servidor Node propio desplegada en Cloud Run (us-east1).
- WebSocket `/ws/agent` que hace de proxy hacia Deepgram Voice Agent (STT nova-3 en español, TTS aura-2 en español) con DeepSeek (`deepseek-chat`) como LLM.
- Herramienta `buscar_sedes` contra el dataset `s2ru-bqt6` de datos.gov.co.
- Controles de seguridad del WebSocket y del HTTP, `GET /api/health`.
- Pasos posteriores, a medida que se entreguen: subida de documento con brief, transcripción diarizada, panel de sentimiento y tarjetas de sedes.

Fuera del alcance:
- Pruebas internas de Deepgram, DeepSeek y datos.gov.co (se prueba solo la integración y el comportamiento ante su caída).
- Calidad clínica de las respuestas: el agente no diagnostica y no se evalúa como tal.
- Disponibilidad real de cupos, horarios, EPS y especialidades: el dataset no los contiene.
- Autenticación de usuarios: la aplicación no tiene login (ver matriz de autorización en `docs/TESTING.md`).

## 2. Estrategia

1. Prioridad por riesgo. El mayor riesgo de la demo es que el agente falle en vivo o que un tercero abuse de las claves y del costo. Por eso se cubren primero conversación, honestidad, límites del WebSocket y disponibilidad.
2. Pirámide corta. Pruebas unitarias de la lógica crítica (traducción de necesidad, resolución de municipio, validaciones, límites), una prueba de integración en vivo, y el resto manual con navegador o con scripts k6.
3. Cada caso referencia un requerimiento y cada requerimiento tiene al menos un caso (trazabilidad en `docs/REQUIREMENTS.md`, columna "Casos").
4. El QA escribe y ejecuta los casos desde los criterios de aceptación, no desde el código. El desarrollador ejecuta las pruebas automáticas antes de cada commit.
5. Los números del agente se verifican siempre contra la API de datos.gov.co, no contra el propio agente.
6. Cada commit trae su entrada en `docs/GUIA-QA.md`; el QA revisa esa entrada y ejecuta los casos que apliquen.

## 3. Entornos

| Entorno | Uso | Notas |
|---|---|---|
| Local | Desarrollo y pruebas unitarias | `cd web && npm ci && npm run dev` en `http://localhost:3000`; `.env` con claves reales entregado en privado, nunca por el repositorio |
| Cloud Run `agente-vocal` (us-east1, proyecto `agente-vocal-hackaton`) | Humo, E2E, seguridad, carga | Es el mismo entorno de la demo; las pruebas de carga se ejecutan antes del congelamiento y con límites de costo en mente |
| Navegadores | E2E manual | Chrome y Edge actuales, en Windows, con micrófono real |

Las pruebas de carga y estrés consumen cuota de Deepgram y DeepSeek solo si abren sesiones de voz reales; los scripts de `web/tests/load/` se limitan a HTTP y a intentos de conexión WebSocket sin audio, salvo indicación contraria.

## 4. Datos de prueba

- Tres documentos: uno corto (1 página), uno largo (más de 20 páginas) y uno con trampa (datos que contradicen el sentido común). Más un documento no médico, un PDF escaneado sin texto, un archivo corrupto, un ejecutable renombrado a `.pdf`, un archivo sobre el límite de tamaño y un documento con instrucciones hostiles ("ignora tus reglas").
- Diez preguntas por documento: 7 con respuesta en el documento y 3 sin respuesta.
- Cinco consultas de IPS con su respuesta verificada en la API (ejemplo: `https://www.datos.gov.co/resource/s2ru-bqt6.json?$select=count(*)&$where=municipio='MEDELLÍN'`). Dato de referencia ya verificado: Leticia tiene 2 IPS públicas.
- Municipios difíciles: Leticia (se transcribe como "Letizia"), Medellín, Cúcuta, Ibagué, Quibdó, Mitú (sin UCI de adultos).
- Frases de emergencia (5), de necesidad ambigua, de especialidad, fuera de misión y de datos personales, tomadas de `docs/GUIA-QA.md`.
- Dos voces distintas (segunda persona o grabación) para la diarización.

## 5. Roles

| Rol | Persona | Responsabilidad |
|---|---|---|
| Desarrollador | Dueño del código | Construye, corrige defectos, corre pruebas unitarias, de integración, humo y carga, aplica correcciones de seguridad |
| QA | Jacobo | Escribe y ejecuta casos, prueba el flujo en navegador, ejecuta el break test manual, registra defectos y resultados en `docs/TESTING.md` |

## 6. Criterios de entrada y salida

Entrada (para empezar a probar una funcionalidad):
- La funcionalidad está desplegada en la URL de Cloud Run o corre en local con `npm run dev`.
- Existe entrada en `docs/GUIA-QA.md` con el commit.
- `npm run build` y `node --test` pasan.

Salida (para dar el producto por probado, antes de las 16:00):
- 100 % de los casos de prioridad Alta ejecutados; 0 defectos abiertos de severidad Crítica o Alta.
- Al menos 90 % de los casos totales con resultado Aprobado; el resto con estado documentado (Bloqueado o No ejecutado, con causa).
- Pruebas de humo en verde sobre la revisión que se entrega.
- `npm audit --omit=dev` con 0 vulnerabilidades y gitleaks sin hallazgos.
- Break test manual ejecutado completo por el QA.
- Tres corridas consecutivas del guion de demo sin fallos.

Suspensión: si `GET /api/health` falla o las APIs externas están caídas, se detiene la ejecución y se registra como bloqueo.

## 7. Tipos de prueba

Se prioriza por riesgo. Responsable: Desarrollador (Dev) o QA (Jacobo).

### 7.1 Se ejecutan hoy

| Tipo | Objetivo | Herramienta | Comando o procedimiento | Umbral de aprobación | Responsable | Casos |
|---|---|---|---|---|---|---|
| Unitarias | Lógica aislada: traducción de necesidad a capacidades, resolución de municipio, validación de archivos y mensajes, límites | `node --test` | `cd web && node --test server/*.test.mjs` | 0 fallos | Dev | CP-019, CP-020, CP-063 |
| Integración en vivo | Servidor, Deepgram, DeepSeek y datos.gov.co juntos | `node --test` con `LIVE=1` | `cd web && LIVE=1 node --env-file=../.env --test server/*.test.mjs` | 0 fallos; respuestas de IPS idénticas a la API | Dev | CP-001, CP-022 |
| Contrato ligero | El WebSocket acepta solo los tipos de mensaje definidos y la herramienta devuelve el esquema acordado (sin columnas fuera de la lista blanca) | `node --test` | Pruebas del esquema de mensajes y de la respuesta de `buscar_sedes` | Esquema válido; campos desconocidos rechazados | Dev | CP-011, CP-045 |
| Funcionales / API | Cada requerimiento contra su criterio de aceptación | Navegador, `curl`, API de datos.gov.co | Casos de `docs/TESTING.md` secciones 2 a 5 | Resultado esperado de cada caso | QA | CP-005 a CP-028 |
| E2E manual con navegador | Flujo completo: abrir, subir documento, brief, conversar, ver transcripción y sentimiento | Chrome y Edge, micrófono real | Guion de demo P1 a P6 | Flujo sin fallos; latencia p50 de 2,0 s o menos | QA | CP-027 a CP-035, CP-038 |
| Humo | El despliegue arranca y lo esencial funciona | `curl` y k6 smoke | `curl -fsS https://<url>/api/health` y `k6 run web/tests/load/smoke.js` tras cada despliegue | `/api/health` 200; p95 menor a 800 ms | Dev | CP-037, CP-058 |
| Sanidad | Verificación puntual tras un cambio | Subconjunto manual | Repetir el caso del defecto corregido más CP-037 | Caso aprobado | QA | según defecto |
| Regresión | Lo existente sigue funcionando | `node --test` más humo | Suite completa antes de cada despliegue | 0 fallos | Dev | CP-063 |
| Seguridad | Cabeceras, archivos expuestos, secretos, dependencias, abuso del WebSocket | `curl`, navegador, gitleaks, `npm audit`, `web-security-audit`, cliente WebSocket (por ejemplo `wscat` o script de Node) | Casos de `docs/TESTING.md` secciones 7 a 9 | Todos los rechazos esperados; 0 hallazgos críticos o altos | Dev (controles) y QA (break test) | CP-002, CP-003, CP-041 a CP-057, CP-064, CP-065 |
| Autorización | La aplicación no tiene login: la matriz es anónimo contra límites y aislamiento entre sesiones | Cliente WebSocket, dos pestañas | Matriz de `docs/TESTING.md` sección 10 | Ninguna sesión ve datos de otra; límites aplicados | QA | CP-041 a CP-048 |
| Carga | Comportamiento con la carga esperada | k6 | `k6 run web/tests/load/load.js` (20 VUs) | p95 menor a 1000 ms, errores menores a 1 % | Dev | CP-059 |
| Estrés | Punto de quiebre y recuperación | k6 | `k6 run web/tests/load/stress.js` | Degradación controlada y recuperación en 60 s | Dev | CP-060 |
| Picos (spike) | Subida brusca de tráfico | k6 | `k6 run web/tests/load/spike.js` | Errores menores a 5 %, recuperación en 60 s | Dev | CP-061 |
| Límites del WebSocket | Los controles anti abuso se activan bajo presión | k6 | `k6 run web/tests/load/ws-limits.js` | 100 % de los intentos excedentes rechazados | Dev | CP-062 |
| Exploratoria | Descubrir lo que los casos no previeron | Sesión de 30 min con carta de prueba | Carta: "intentar que el agente rompa una regla del ADR" | Defectos registrados | QA | break test |

### 7.2 Se documentan y no se ejecutan hoy

| Tipo | Estrategia prevista | Por qué no se ejecuta |
|---|---|---|
| Resistencia (soak) | k6 o sesiones largas durante horas para detectar fugas de memoria | Un día de trabajo; las sesiones tienen duración máxima y el servicio no guarda estado entre sesiones |
| Escalabilidad y volumen | Crecimiento de usuarios y de documentos grandes | La demo es de bajo tráfico y `max-instances` está acotado por costo |
| Contrato formal (Schemathesis, Pact) | Contrato OpenAPI contra el servidor | No hay OpenAPI definido; se cubre con contrato ligero |
| Migración de datos | Scripts de subida y bajada | No hay base de datos |
| Compatibilidad | Playwright multinavegador y móviles | Solo se garantiza Chrome y Edge de escritorio; Firefox y Safari quedan sin probar |
| Accesibilidad | axe y Lighthouse (WCAG 2.2 AA) | Si sobra tiempo tras el congelamiento se corre Lighthouse una vez; no es criterio de salida |
| Usabilidad con usuarios | Prueba con 3 personas externas | No hay tiempo; se reemplaza por la exploratoria y el ensayo de demo |
| Recuperación y resiliencia | Caída de proveedores, restauración | Solo se prueba la reconexión del WebSocket (CP-036) y el mensaje ante caída de datos.gov.co si hay tiempo |
| E2E automatizado (Playwright) | Flujo principal automatizado | El micrófono y el audio real hacen costosa la automatización; el flujo se prueba manualmente |
| Aceptación (UAT) | Checklist firmado por el usuario | Se reemplaza por el ensayo de demo de tres corridas |

## 8. Gestión de defectos

Reporte: título, pasos para reproducir, resultado esperado, resultado obtenido, severidad, prioridad, commit (`git log --oneline -1`), evidencia (captura, audio o registro). Se registran en la sección de defectos de `docs/TESTING.md` y se avisa al desarrollador por el canal privado del equipo.

Severidad (impacto técnico):

| Severidad | Definición | Ejemplo |
|---|---|---|
| Crítica | Pérdida de seguridad, de claves o caída total | Clave visible en el cliente; `/.env` responde 200; el servicio no arranca |
| Alta | Función principal rota o respuesta falsa o peligrosa | Emergencia sin "llama al 123"; el agente inventa datos; límites del WebSocket no se aplican |
| Media | Función secundaria rota o degradada con alternativa | Sentimiento no se actualiza; tarjetas incompletas; latencia p50 sobre 2,0 s |
| Baja | Cosmético o menor | Texto desalineado; mensaje de error poco claro |

Prioridad (urgencia de corrección):

| Prioridad | Definición | Plazo |
|---|---|---|
| P1 | Bloquea la demo o la seguridad | Se corrige de inmediato, antes de seguir probando |
| P2 | Afecta un criterio puntuado | Se corrige antes de las 14:30 |
| P3 | Mejora sin impacto en la demo | Se corrige si hay tiempo o se documenta como deuda |

Regla de decisión: Crítica o Alta implican P1 o P2 y bloquean la salida. Media puede ser P2 o P3. Baja es siempre P3. Después de las 14:30 solo se corrigen defectos P1.

## 9. Riesgos

| Riesgo | Probabilidad | Impacto | Mitigación |
|---|---|---|---|
| Caída o lentitud de Deepgram, DeepSeek o datos.gov.co durante la demo | Media | Alto | Chequeo de `/api/health` y humo justo antes de la demo; revisión anterior estable lista; mensaje honesto ante caída |
| Latencia de unos 2 s percibida como lenta | Alta | Medio | Se mide y se reporta con honestidad; objetivo de 1,5 s; el desglose (DeepSeek 0,8 a 1,05 s, TTS 0,7 s) se explica |
| La transcripción deforma nombres de municipios | Alta | Alto | Resolución aproximada del municipio (RF-011) y casos CP-009 y CP-020 |
| Eco: el STT transcribe la voz del agente | Media | Medio | Pruebas con altavoces y con audífonos; cancelación de eco del navegador |
| Abuso de claves y costo por tráfico externo | Media | Alto | Límites por IP, tope global, duración máxima, `max-instances` y alerta de presupuesto; casos CP-041 a CP-048 |
| Un documento hostil cambia el comportamiento del agente | Media | Alto | Caso CP-029 y reglas en el prompt del sistema |
| Congelamiento a las 14:30 deja poco tiempo para corregir | Alta | Medio | Ejecutar las pruebas de cada paso al entregarse, no al final |
| Un solo QA y un solo desarrollador | Alta | Medio | Priorización por riesgo, automatización de humo y carga |
| Cuotas de las APIs agotadas por las pruebas de carga | Baja | Alto | Carga sin audio real; ejecutar antes del congelamiento y vigilar la cuota |

## 10. Métricas y reporte

Métricas:
- Casos ejecutados contra planificados, y porcentaje de Aprobado, Fallido, Bloqueado y No ejecutado.
- Cobertura de requerimientos: requerimientos con al menos un caso aprobado sobre el total (33).
- Defectos abiertos por severidad y tiempo medio de corrección.
- Latencia fin de voz a primer audio del agente: p50 y p95 sobre al menos 10 turnos, con cronómetro y registros del servidor.
- Tiempo de corte del audio del agente al interrumpir.
- Resultados k6: p95, tasa de errores y rechazos de límites.

Reporte:
- Se actualizan la columna "Estado" y la sección "Resultados" de `docs/TESTING.md` después de cada ejecución, con fecha, commit, ejecutor, resultado y evidencia.
- Corte intermedio a las 14:30 (estado al congelar) y reporte final a las 15:30 con el resumen de métricas, defectos abiertos y casos no ejecutados con su causa.
- La matriz de trazabilidad es la columna "Casos" de `docs/REQUIREMENTS.md`; se revisa antes de la entrega.
