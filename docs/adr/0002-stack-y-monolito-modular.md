# ADR 0002: Stack Next.js con servidor Node propio, en un monolito modular

Estado: aceptada. Fecha: 2026-10-09. Reemplaza la propuesta de stack de `docs/PLAN.md` sección 4 (FastAPI + React).

## Contexto

El producto es una conversación por voz en tiempo real: el navegador envía audio por un WebSocket que dura minutos y recibe audio y eventos por el mismo canal. La latencia entre el fin de la voz y el primer audio del agente es el atributo de calidad prioritario (RF-004, p50 de 2,0 s o menos). El equipo es de dos personas (un desarrollador y un QA) y el tiempo es el de un hackathon.

Durante el spike se eligió la Voice Agent API de Deepgram, que hace STT, orquestación del LLM y TTS en una sola conexión. Esa API recibe la configuración del LLM, incluida la clave de DeepSeek, en el mensaje `Settings`. En consecuencia, el navegador no puede conectarse directo a Deepgram sin exponer la clave: hace falta un proxy de WebSocket en nuestro servidor.

`docs/PLAN.md` proponía FastAPI (Python) con un pipeline propio de STT, LLM y TTS. Con la Voice Agent API ese pipeline ya no se escribe: el servidor solo releva audio, filtra mensajes y ejecuta la herramienta `buscar_sedes`.

## Decisión

- **Un solo proceso Node 24** (`web/server.mjs`, ESM sin compilar) que levanta Next.js 15.5 (React 19, TypeScript en la interfaz) y atiende en el mismo puerto el upgrade a `/ws/agent` con la librería `ws`.
- **Monolito modular**: la lógica del servidor vive en módulos con interfaz explícita (`server/limits.mjs`, `server/agent-settings.mjs`, `server/ips.mjs`) y `server.mjs` solo usa sus exports. Los módulos planeados (documento y brief, diarización, sentimiento) siguen la misma regla.
- **Sin base de datos**: el estado de una conversación vive en memoria dentro de su sesión WebSocket. No se guardan datos personales.
- Dependencias de producción: `next`, `react`, `react-dom` y `ws`. Nada más.

## Alternativas consideradas

| Alternativa | Por qué se descartó |
|---|---|
| FastAPI + React estático (`docs/PLAN.md`) | Dos lenguajes y dos toolchains para un solo desarrollador. Con la Voice Agent API ya no hay pipeline de audio en Python que justifique el cambio de lenguaje. Next.js da la interfaz y el servidor en un solo proyecto y un solo `npm ci` |
| Microservicios (gateway de voz, servicio de IPS, frontend) | Agrega red, despliegues múltiples, contratos versionados y fallos parciales que un equipo de dos no puede operar en horas. Un salto de red extra dentro del turno de voz suma latencia al atributo prioritario. CLAUDE.md sección 3 lo desaconseja salvo requisito del reto, y el reto no lo pide |
| Next.js en Vercel o funciones serverless | Las funciones serverless no mantienen WebSockets de varios minutos y cobran por duración. El proxy de voz necesita un proceso que viva toda la sesión. Separar la interfaz en Vercel y el proxy en otro lado son dos despliegues y dos orígenes, con CORS y Origin más complejos |
| Next.js con `output: standalone` y su servidor por defecto | El servidor por defecto de Next.js no permite agregar un manejador propio del upgrade de WebSocket sin modificarlo; un servidor personalizado de unas 150 líneas lo resuelve |
| Conexión directa del navegador a Deepgram con token temporal | La clave de DeepSeek seguiría viajando en el `Settings` que enviaría el navegador, y el navegador podría modificar el prompt o la herramienta. Descartado por seguridad |

## Consecuencias

- Un solo contenedor, un solo despliegue y un solo log. La puerta a microservicios queda abierta por las fronteras de módulo (ver `docs/ARCHITECTURE.md` sección 14).
- El estado en memoria obliga a que todo lo de una sesión ocurra en la misma instancia. Hoy se cumple porque la sesión es un único WebSocket; cuando exista la carga de documento por HTTP se necesita la afinidad de sesión de Cloud Run o enviar el documento por el mismo WebSocket (ADR 0003).
- Los límites de admisión en memoria no se comparten entre instancias; se acepta con `max-instances` 2.
- El servidor personalizado desactiva algunas optimizaciones automáticas de Next.js; no afectan a esta aplicación.
- Se depende de Deepgram para la orquestación del turno: si su Voice Agent API cae, no hay conversación. Se acepta a cambio de no escribir ni operar el pipeline de STT, LLM y TTS.
