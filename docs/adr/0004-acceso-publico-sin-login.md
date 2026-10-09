# ADR 0004: Acceso público sin inicio de sesión

Estado: aceptada. Fecha: 2026-10-09.

## Contexto

El jurado abre la URL desde su equipo, sin cuentas y sin instalar nada, y tiene un tiempo corto por proyecto (RNF-001). Un formulario de registro o de inicio de sesión agrega fricción a la demo y no protege nada valioso: el sistema no guarda datos de usuarios, no tiene recursos con dueño y el registro de IPS es público.

Lo que sí hay que proteger es el **costo y las claves**: cada sesión de voz abre una conexión facturada a Deepgram y consume DeepSeek. Un endpoint público de voz sin control es una forma de gastar el presupuesto del equipo o de usar sus claves como proxy gratuito de LLM y TTS. CLAUDE.md sección 4 pide autorización en cada endpoint; esta decisión la reemplaza por controles compensatorios.

## Decisión

El servicio es público (`allow-unauthenticated` en Cloud Run) y no tiene login. En su lugar, el WebSocket `/ws/agent`, que es lo único que genera costo, aplica estos controles en el servidor (`web/server.mjs`, `web/server/limits.mjs`):

| Control | Valor | Respuesta | Contra qué protege |
|---|---|---|---|
| Lista blanca de Origin | `ALLOWED_ORIGINS` (la URL de Cloud Run) | 403 antes del handshake | Que otra web use el agente desde el navegador de un visitante (cross-site WebSocket hijacking) |
| Tasa por IP | 10 intentos de conexión por minuto | 429 con `Retry-After: 60` | Bucles de reconexión y scripts |
| Cupo simultáneo por IP | 2 sesiones | 429 con `Retry-After: 60` | Una sola fuente acaparando sesiones |
| Cupo global | 8 sesiones por instancia | 503 | Techo de costo duro |
| Duración máxima | 10 minutos | Cierre 4000 | Sesiones abandonadas o abusivas que consumen sin límite |
| Tamaño de frame | 64 KB | Cierre 1009 | Agotamiento de memoria |
| Lista blanca de entrada | Solo audio binario y `{"type":"KeepAlive"}` | Cierre 1008 | Que el cliente envíe `Settings`, cambie el prompt, inyecte mensajes del agente o use la sesión como proxy de LLM con su propio prompt |
| Lista blanca de salida | Siete tipos de evento, `ToolResult` y `Error` saneado | El resto se descarta | Fuga de configuración o de detalles internos |
| Sin datos guardados | Todo en memoria de la sesión | No aplica | No hay nada que robar entre sesiones |
| IP del cliente confiable | Última entrada de `X-Forwarded-For`, la que agrega Cloud Run | No aplica | Evasión de los cupos falsificando la cabecera |

Además, `max-instances` 2 en Cloud Run limita el techo global a 16 sesiones y la alerta de presupuesto de facturación avisa ante un gasto anómalo.

## Alternativas consideradas

| Alternativa | Por qué se descartó |
|---|---|
| Login con usuario y contraseña | El jurado no tiene cuentas; crearlas o compartir credenciales en la demo es fricción y un secreto más que proteger |
| Código de acceso compartido en la URL | Se filtra con cualquier captura de pantalla; da una falsa sensación de control |
| Google Identity-Aware Proxy | Exige cuentas de Google autorizadas de antemano para cada jurado |
| Desafío anti-bot (CAPTCHA, Turnstile) | Agrega una dependencia y un paso visible para el jurado; queda como mejora si se observa abuso automatizado |

## Consecuencias y riesgos residuales

- Cero fricción para el jurado y ningún dato de usuario que proteger.
- **El Origin se falsifica fuera del navegador.** Un script puede abrir sesiones; queda limitado por la tasa, los cupos y la duración, pero obtiene una conversación real con el agente mientras dure. El agente solo hace lo que su prompt fijo y su herramienta permiten, así que el abuso posible es consumir minutos de voz, no usar las claves con otro propósito.
- **Rotación de IP.** Un atacante con muchas IP evade los cupos por IP; el cupo global y `max-instances` acotan el costo, pero puede ocupar todas las sesiones y dejar sin servicio al jurado hasta 10 minutos. Mitigación operativa: monitorear `ws_rejected` con motivo `global_cap` en Cloud Logging durante la evaluación y, si ocurre, rotar la URL o subir el cupo temporalmente.
- **Límites por instancia.** Los contadores viven en memoria de cada instancia; con 2 instancias los cupos efectivos se duplican.
- **Sin bloqueo progresivo.** Un cliente que excede la tasa vuelve a intentar al minuto siguiente; aceptado por la duración del evento.
- **Sin rate limit de aplicación en las páginas HTTP.** No generan costo de proveedores; quedan cubiertas por la escala acotada de Cloud Run.
- Si el producto pasa a producción real, esta decisión se revisa: autenticación ligera (por ejemplo, enlace mágico o cuenta de Google) y contadores compartidos en Memorystore.
