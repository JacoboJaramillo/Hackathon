# Protocolo del WebSocket `/ws/agent`

Contrato entre el navegador y el servidor para la conversación por voz. Implementación: `web/server.mjs` y `web/server/limits.mjs`. El upgrade HTTP y sus respuestas de rechazo también están en `docs/api/openapi.yaml`. Requerimientos: RF-002, RF-004, RF-005, RF-007, RF-008, RF-009, RF-019, RNF-004.

El servidor es un proxy filtrante hacia la Voice Agent API de Deepgram (`wss://agent.deepgram.com/v1/agent/converse`). El navegador nunca habla con Deepgram y nunca ve el mensaje `Settings`.

Por cada sesión el servidor abre además una segunda conexión de subida, a la API de transcripción en streaming de Deepgram (`wss://api.deepgram.com/v1/listen`, modelo `nova-3`, español, con diarización). Recibe una copia del mismo audio del micrófono y produce la transcripción por hablante (RF-007) y, sobre ella, el sentimiento por intervención con DeepSeek (RF-008). Ver la sección 4.3.

## 1. Conexión

```
GET /ws/agent HTTP/1.1
Host: agente-vocal-583590264456.us-east1.run.app
Upgrade: websocket
Connection: Upgrade
Origin: https://agente-vocal-583590264456.us-east1.run.app
Sec-WebSocket-Version: 13
Sec-WebSocket-Key: <clave aleatoria>
```

URL: `wss://agente-vocal-583590264456.us-east1.run.app/ws/agent`, con el parámetro opcional `?doc=<documentId>`. No usa subprotocolo.

`doc` es el UUID que devuelve `POST /api/document`. Si viene, el agente de esa sesión usa el texto del documento como contexto (RF-002). El documento vive solo en memoria de la instancia durante 30 minutos. Un `doc` con formato inválido, desconocido o vencido se rechaza con `404 Not Found` antes del handshake y antes de consumir cupo de sesión. Sin `doc`, la sesión funciona como siempre, solo con el registro de IPS.

Controles de admisión, en este orden, antes de completar el handshake:

| Orden | Control | Valor por defecto | Variable de entorno | Rechazo | Motivo en el log |
|---|---|---|---|---|---|
| 1 | Origin en la lista blanca | Coincidencia exacta | `ALLOWED_ORIGINS` (lista separada por comas) | `403 Forbidden` | `bad_origin` |
| 2 | Documento vigente, solo si viene `doc` | UUID v4 existente y no vencido (30 min) | Ninguna | `404 Not Found` | `doc_not_found` |
| 3 | Intentos de conexión por IP en los últimos 60 s | 10 | `MAX_CONNECTS_PER_MIN` | `429 Too Many Requests` con `Retry-After: 60` | `rate_limited` |
| 4 | Sesiones activas en la instancia | 8 | `MAX_SESSIONS` | `503 Service Unavailable` | `global_cap` |
| 5 | Sesiones activas de la misma IP | 2 | `MAX_SESSIONS_PER_IP` | `429 Too Many Requests` con `Retry-After: 60` | `ip_cap` |

Notas:

- Los rechazos responden con cuerpo vacío, `Connection: close` y cierre del socket.
- Todo intento que pasa los controles de Origin y de documento cuenta para la tasa, incluso si después se rechaza. Un `doc` inválido no cuenta ni consume cupo.
- La IP del cliente es la última entrada de `X-Forwarded-For` (la que agrega Cloud Run); si no hay cabecera, la dirección del socket.
- Los contadores son por instancia de Cloud Run.
- En producción, un upgrade a cualquier otra ruta se corta sin respuesta.

## 2. Formato de audio

| Sentido | Codificación | Frecuencia | Canales | Contenedor |
|---|---|---|---|---|
| Navegador a servidor | PCM lineal de 16 bits, little-endian (`linear16`) | 16 000 Hz | 1 | Ninguno, muestras crudas |
| Servidor a navegador | PCM lineal de 16 bits, little-endian (`linear16`) | 24 000 Hz | 1 | Ninguno, muestras crudas |

El audio viaja en frames binarios. El servidor no lo modifica en ningún sentido.

## 3. Mensajes del navegador al servidor

| Tipo de frame | Contenido | Qué hace el servidor |
|---|---|---|
| Binario | Audio PCM de 16 kHz, máximo 64 KB por frame | Lo reenvía al agente de Deepgram y, aparte, a la transcripción diarizada (sección 4.3). Si la conexión a Deepgram aún no abre, lo guarda en un buffer de hasta 50 frames y descarta los siguientes |
| Texto | `{"type":"KeepAlive"}` | Lo reescribe como `{"type":"KeepAlive"}` y lo reenvía. Sirve para mantener viva la sesión cuando el micrófono está en silencio |
| Texto | `{"type":"AskText","text":"..."}` | Pregunta tocada en la interfaz (sugerencias del brief). `text` debe ser texto de 1 a 300 caracteres. El servidor la reescribe como `{"type":"InjectUserMessage","content":"..."}` y la reenvía al agente, que la trata como un turno normal de la persona con las mismas reglas. Máximo 20 por sesión; las siguientes se ignoran |
| Texto | Cualquier otra cosa, incluido JSON inválido o cualquier otro `type` | Cierra la sesión con `1008 invalid_message` |

Esta lista blanca impide que el navegador envíe a Deepgram mensajes de control como `Settings`, `UpdatePrompt`, `InjectAgentMessage` o `FunctionCallResponse`.

## 4. Mensajes del servidor al navegador

Frames binarios: audio del agente, PCM de 24 kHz.

Frames de texto (JSON). Los siete primeros son eventos de Deepgram que se reenvían sin cambios; cualquier otro evento de Deepgram se queda en el servidor.

| `type` | Origen | Cuándo llega | Uso en la interfaz |
|---|---|---|---|
| `Welcome` | Deepgram | Al abrir la conexión de subida | Conexión establecida |
| `SettingsApplied` | Deepgram | Cuando Deepgram acepta la configuración | Listo para escuchar; el saludo del agente llega a continuación |
| `ConversationText` | Deepgram | Por cada intervención transcrita, con `role` (`user` o `assistant`) y `content` | Transcripción en pantalla |
| `UserStartedSpeaking` | Deepgram | Cuando detecta voz del usuario | Estado "escuchando" y barge-in: descartar el audio del agente pendiente de reproducir |
| `AgentThinking` | Deepgram | Mientras el LLM genera la respuesta | Estado "pensando" |
| `AgentStartedSpeaking` | Deepgram | Antes del primer audio de la respuesta | Estado "hablando" |
| `AgentAudioDone` | Deepgram | Cuando terminó de enviar el audio de la respuesta | Volver a "escuchando" cuando termine la reproducción local |
| `ToolResult` | Servidor | Tras ejecutar una función pedida por el agente | Tarjetas de sedes (RF-019) |
| `Transcript` | Servidor | Al cerrarse una intervención del micrófono en la transcripción diarizada | Transcripción por hablante con marca de tiempo (RF-007) |
| `Sentiment` | Servidor | Hasta unos 2 s después del `Transcript` con el mismo `id`, si la clasificación tuvo éxito | Panel de sentimiento y tendencia (RF-008) |
| `Error` | Servidor | Cuando Deepgram envía un error. La sesión sigue abierta | Mensaje genérico al usuario |

Los campos de los eventos de Deepgram son los de su Voice Agent API; la interfaz solo debe depender de `type` y, en `ConversationText`, de `role` y `content`.

### 4.1 `ToolResult`

```json
{
  "type": "ToolResult",
  "name": "buscar_sedes",
  "result": {
    "alcance": "municipio",
    "municipio": "LETICIA",
    "departamento": "AMAZONAS",
    "necesidad": "urgencias",
    "total_sedes": 2,
    "sedes": [
      {
        "sede": "NOMBRE DE LA SEDE",
        "prestador": "NOMBRE DEL PRESTADOR",
        "direccion": "CALLE 0 0 00",
        "telefono": "0000000",
        "naturaleza": "Pública",
        "nivel": null,
        "capacidades": [{ "tipo": "Urgencias", "cantidad": 3 }]
      }
    ]
  }
}
```

Los valores del ejemplo son ilustrativos. Reglas:

- `alcance` es `municipio` o `departamento` (este último cuando el municipio no tiene sedes del tipo pedido, RF-012).
- `sedes` trae como máximo 20 elementos ordenados por capacidad total descendente; `total_sedes` es el total encontrado. Cualquier campo de una sede puede ser `null`. Nunca hay nombres de gerentes ni correos (RF-013).
- Si la búsqueda no puede completarse, `result` es un objeto de error:

| `result` | Significado |
|---|---|
| `{"error":"parametros_invalidos"}` | El modelo envió argumentos que no pasan la validación |
| `{"error":"municipio_no_encontrado","sugerencias":["..."]}` | No hay un municipio cercano; hasta 3 sugerencias |
| `{"error":"servicio_no_disponible"}` | datos.gov.co falló o no respondió en 8 s |
| `{"error":"funcion_desconocida"}` | El agente pidió una función distinta de `buscar_sedes` |

El mismo `result`, serializado, es lo que el servidor devuelve a Deepgram en el `FunctionCallResponse`.

### 4.2 `Error`

```json
{ "type": "Error", "message": "El servicio de voz tuvo un problema. Intenta de nuevo." }
```

El texto es fijo. El detalle original queda en el log del servidor como `upstream_error`.

### 4.3 `Transcript` y `Sentiment`

```json
{ "type": "Transcript", "id": "t3", "speaker": 1, "text": "Necesito urgencias en Leticia.", "start": 12.4, "end": 14.1 }
```

```json
{ "type": "Sentiment", "id": "t3", "sentimiento": "negativo", "emocion": "preocupacion", "intensidad": 0.72 }
```

`Transcript`:

- `id`: `t1`, `t2`, ... secuencial dentro de la sesión. Es la llave que une la intervención con su `Sentiment`.
- `speaker`: entero que asigna la diarización de Deepgram, desde 0. Solo distingue voces dentro de la sesión; la interfaz lo muestra como "Hablante N+1". Las intervenciones del agente no llegan por aquí: siguen llegando como `ConversationText` con `role` `assistant` y la interfaz las etiqueta "Agente".
- `start` y `end`: segundos desde que abrió la transcripción diarizada, con un decimal.
- Agrupación: de cada resultado final se toman las palabras con su hablante; las palabras seguidas del mismo hablante con menos de 1 s de pausa forman una intervención. Una intervención se cierra cuando cambia el hablante, cuando Deepgram marca fin de frase (`speech_final`, 300 ms de silencio) o con `UtteranceEnd` (1 s sin palabras).

`Sentiment`:

| Campo | Valores |
|---|---|
| `sentimiento` | `positivo`, `neutral`, `negativo` |
| `emocion` | `calma`, `alegria`, `preocupacion`, `miedo`, `enojo`, `tristeza`, `frustracion`, `urgencia`, `confusion` (sin tildes) |
| `intensidad` | Número entre 0 y 1 con dos decimales |

- Se pide a DeepSeek (`deepseek-chat`, modo JSON, temperatura 0, máximo 60 tokens, tiempo límite 4 s) solo para intervenciones de al menos 2 palabras. El texto va entre delimitadores y se declara como datos, no instrucciones.
- La respuesta se valida contra las listas de arriba. Si falla, no responde a tiempo o no cumple el formato, no se envía ningún `Sentiment` para ese `id`; la interfaz debe tolerar intervenciones sin sentimiento. El log registra `sentiment_failed` con un motivo corto.
- Máximo 2 clasificaciones en curso por sesión; una intervención que llega con 2 en curso se queda sin sentimiento (se descarta, no se encola).
- La tendencia la calcula la interfaz a partir de la secuencia de `Sentiment`.
- Latencia medida en local: 1,2 a 1,3 s entre el `Transcript` y su `Sentiment`.

Comportamiento ante fallos de la segunda conexión:

- Si la conexión a `/v1/listen` falla al abrir o se cae, la sesión de voz sigue igual; solo dejan de llegar `Transcript` y `Sentiment`. El log registra `diarize_error`.
- El audio que llega antes de que abra se descarta (no se guarda en buffer). Si la conexión se atrasa más de 1 MB, los frames se descartan para no frenar el camino del agente.
- El servidor envía `{"type":"KeepAlive"}` cada 5 s y, al cerrar la sesión, `{"type":"CloseStream"}` antes de cerrar.
- Por privacidad, el texto transcrito nunca se escribe en el log; solo conteos (`diarize_end` con el número de intervenciones).

Costo: la transcripción diarizada se cobra por segundo de audio enviado, durante toda la sesión (hasta 10 minutos), además del agente de voz. Cada intervención de 2 o más palabras genera una llamada corta a DeepSeek.

## 5. Códigos de cierre

| Código | Razón | Quién cierra | Causa | Qué debe hacer la interfaz |
|---|---|---|---|---|
| 1000 | `client_closed` | Navegador | El usuario terminó la conversación | Nada |
| 1008 | `invalid_message` | Servidor | Texto distinto de `KeepAlive` o de un `AskText` válido | Es un error de la interfaz; no reintentar en bucle |
| 1009 | (lo pone la librería `ws`) | Servidor | Frame de más de 64 KB | Enviar frames más pequeños |
| 1011 | `upstream_closed` o `upstream_error` | Servidor | Deepgram cerró la sesión o la conexión falló | Mostrar el problema y ofrecer reconectar |
| 1011 | `client_error` | Servidor | Error en el socket del navegador | Reconectar |
| 4000 | `session_time_limit` | Servidor | La sesión alcanzó 10 minutos (`SESSION_MAX_MS`) | Avisar y ofrecer una conversación nueva |

Al cerrarse una sesión por cualquier motivo, el servidor termina las dos conexiones a Deepgram y libera el cupo.

## 6. Límites

| Límite | Valor |
|---|---|
| Tamaño máximo de frame del navegador | 64 KB |
| Frames guardados antes de abrir Deepgram | 50 |
| Duración máxima de la sesión | 10 minutos |
| Sesiones simultáneas por IP | 2 por instancia |
| Intentos de conexión por IP | 10 por minuto por instancia |
| Sesiones simultáneas totales | 8 por instancia, 16 con `max-instances` 2 |
| Sedes por `ToolResult` | 20 |
| Tiempo por consulta a datos.gov.co | 8 s por petición |
| Clasificaciones de sentimiento en curso | 2 por sesión |
| Tiempo por clasificación de sentimiento | 4 s |

## 7. Secuencia típica

1. El navegador abre el WebSocket y recibe `Welcome` y `SettingsApplied`.
2. Llega el saludo: `ConversationText` con `role` `assistant`, `AgentStartedSpeaking`, frames binarios de audio y `AgentAudioDone`.
3. El navegador envía audio continuamente. Al hablar el usuario llega `UserStartedSpeaking` y, al terminar, `ConversationText` con `role` `user`.
4. Llega `AgentThinking`. Si el agente busca sedes, llega `ToolResult` antes de la respuesta hablada.
5. Llega `ConversationText` con la respuesta, `AgentStartedSpeaking`, audio y `AgentAudioDone`.
6. Se repiten los pasos 3 a 5. Si hay silencio prolongado, el navegador envía `{"type":"KeepAlive"}` periódicamente.
7. El navegador cierra con 1000, o el servidor cierra con 4000 a los 10 minutos.

El orden exacto de `ConversationText`, `AgentThinking` y `AgentStartedSpeaking` lo decide Deepgram; la interfaz debe tolerar variaciones.

El diagrama de secuencia completo, incluidos Deepgram, DeepSeek y datos.gov.co, está en `docs/ARQUITECTURA.md` sección 3.4 (imágenes en `docs/diagrams/img/`).
