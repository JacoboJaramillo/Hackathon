# ADR 0003: Despliegue en Google Cloud Run

Estado: aceptada. Fecha: 2026-10-09.

## Contexto

El jurado evalúa una URL pública HTTPS desde otra red y otro equipo, sin instalar nada (RNF-001), con disponibilidad total durante la ventana de evaluación (RNF-003). La aplicación es un solo contenedor (ADR 0002) que mantiene WebSockets de varios minutos hacia el navegador y hacia Deepgram. Cada sesión cuesta dinero en proveedores externos, así que la plataforma debe permitir un techo de escala bajo. El equipo es de dos personas y el proyecto se desmonta al terminar el evento.

## Decisión

Cloud Run, servicio `agente-vocal` en el proyecto `agente-vocal-hackaton` (dedicado al evento), región `us-east1`.

| Parámetro | Valor | Razón |
|---|---|---|
| `timeout` | 3600 s | Cloud Run trata un WebSocket como una petición; el timeout es su duración máxima. La aplicación corta antes, a los 10 min |
| Afinidad de sesión | Activada | Las peticiones de un mismo navegador van a la misma instancia mientras exista. Necesaria cuando la carga de documento (HTTP) y la conversación (WebSocket) compartan estado en memoria |
| `min-instances` | 0, y 1 durante la evaluación del jurado | Sin costo fuera de la ventana; sin arranque en frío dentro de ella |
| `max-instances` | 2 | Techo de costo ante abuso: como mucho 2 x 8 sesiones simultáneas |
| `concurrency` | 40 | Cubre 8 sesiones de voz por instancia más las peticiones HTTP de páginas |
| CPU y memoria | 1 vCPU, 1 GiB, startup CPU boost | El proceso releva bytes y hace consultas HTTP; no procesa audio |
| Acceso | `allow-unauthenticated` | El jurado no tiene cuentas (ADR 0004) |
| Secretos | `deepseek-api-key`, `deepgram-api-key`, `datosgov-app-token` en Secret Manager, replicados en `us-east1`, inyectados como variables de entorno al desplegar | Ninguna clave en el código, la imagen ni el repositorio |
| Identidad en ejecución | Cuenta de servicio `agente-vocal-run` con solo `roles/secretmanager.secretAccessor` sobre esos tres secretos | Mínimo privilegio: no usa la cuenta por defecto de Compute Engine, que suele tener el rol de editor del proyecto |
| Construcción | Cloud Build con una cuenta de servicio dedicada de permisos mínimos, desde `web/Dockerfile`, imagen en Artifact Registry (`cloud-run-source-deploy`, `us-east1`) | Build reproducible sin Docker local |
| Proceso de despliegue | `infra/deploy.sh`, ejecutado por el desarrollador | Un solo comando y parámetros versionados. La CI de GitHub Actions corre pruebas, lint, gitleaks, `npm audit` y build, pero no despliega: no hay credenciales de GCP en GitHub |

Región `us-east1`: los proveedores de IA (Deepgram, DeepSeek a través de Deepgram) tienen su infraestructura principal en Estados Unidos, y la costa este tiene latencia razonable hacia Colombia. Los secretos se replican en la misma región.

## Alternativas consideradas

| Alternativa | Por qué se descartó |
|---|---|
| GKE | Un clúster para un contenedor es operación sin beneficio: nodos, ingress, certificados y actualizaciones. Costo mínimo mayor y más tiempo de montaje |
| App Engine estándar | No soporta WebSockets. App Engine flexible sí, pero despliega más lento, tiene costo mínimo de una instancia siempre encendida y menos control de escala |
| Vercel | Las funciones serverless no mantienen WebSockets largos (ADR 0002); habría que alojar el proxy en otra plataforma |
| Compute Engine (una VM) | Gestión manual de TLS, parches del sistema operativo y reinicios; sin escalado a cero |
| Cloud Run con despliegue desde la CI | Requiere credenciales de GCP en GitHub (federación de identidad o una llave). Se descarta para el evento por superficie de ataque y tiempo de montaje; queda como siguiente paso |

## Consecuencias

- HTTPS con certificado válido, WebSockets y escala a cero sin configurar infraestructura.
- Los límites de admisión de la aplicación son por instancia (ADR 0002): los cupos efectivos se multiplican por `max-instances`.
- La afinidad de sesión de Cloud Run es de mejor esfuerzo: si la instancia se reemplaza, la sesión se pierde y el usuario reconecta.
- Una sola región: una caída de `us-east1` deja el servicio caído. Aceptado para un evento de un día.
- Con `min-instances` 0 la primera petición tras un periodo sin tráfico sufre arranque en frío; se sube a 1 antes de la evaluación y se baja después.
- Desmontaje en un paso: borrar el proyecto elimina servicio, imágenes y secretos; después se revocan las claves en los proveedores (`docs/PLAN.md` sección 7).
