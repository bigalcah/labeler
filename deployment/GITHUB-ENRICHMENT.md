# Enriquecimiento GitHub

El enriquecimiento es opt-in y se ejecuta una sola vez durante `labeling-study-prepare`.
El servidor web no recibe credenciales ni realiza solicitudes GitHub: solo lee el run
completado y promovido para el estudio.

## Configuración

Usa un único token fine-grained de solo lectura compartido por las 300 tarjetas y sus
repositorios normalizados. La configuración solo admite el perfil neutral `default`;
no existe routing por repositorio ni se aceptan claves `owner/name`, perfiles
adicionales, prefijos o comodines.

```dotenv
GITHUB_ENRICHMENT_ENABLED=true
GITHUB_API_BASE=https://api.github.com
GITHUB_API_VERSION=2022-11-28
GITHUB_DEFAULT_ALIAS=default
GITHUB_CREDENTIAL_ALIASES={"default":{"tokenFile":"/run/secrets/github-token","permissions":["metadata","pulls","contents","issues"]}}
GITHUB_TOKEN_HOST_PATH=/absolute/external/github-token
```

Los permisos declarados son la frontera mínima del cliente: metadata del repositorio,
pull requests, contenido/archivos e issues/comentarios. El token se monta o expone solo
al proceso prepare desde `GITHUB_TOKEN_HOST_PATH` y nunca se persiste en páginas
normalizadas, snapshots, logs o errores.
El perfil debe declarar exactamente una fuente de secreto: `tokenEnv` o `tokenFile`,
pero nunca ambas. La validación falla antes de cualquier solicitud con códigos
sanitizados `INVALID_PROFILE`, `CREDENTIAL_NOT_FOUND` o
`INSUFFICIENT_PERMISSIONS`. El fingerprint de configuración usa valores canónicos y
permisos ordenados, pero nunca el token ni un hash del token.

## Ejecución y estados

El prepare valida el checksum del CSV, crea un run invisible y consulta metadata,
commits, files, reviews, issue comments y review comments. Timeline y diff son opcionales.
Las solicitudes tienen timeout de 30 segundos, concurrencia configurable de 1 a 8, hasta
cuatro intentos y presupuestos de cinco minutos por página y treinta minutos por run.

Un run solo puede quedar `COMPLETED` y promocionarse cuando existen los 300 snapshots y
todos los endpoints obligatorios terminaron correctamente. Los estados `COMPLETE_EMPTY`,
`UNAVAILABLE`, `TRUNCATED` y `FAILED` se conservan por endpoint; solo un run completo se
hace visible. Un fallo deja el run en `FAILED` y no altera tarjetas ni decisiones.

## Clasificación, límites y telemetría

Cada fetch real se registra como un intento. Una respuesta `429` se clasifica como
`RATE_LIMIT` y se reintenta. Una respuesta `403` solo se clasifica así cuando sus cabeceras
o su mensaje indican un límite primario o secundario; un `403` sin esas señales es un
`TERMINAL_HTTP` de permisos. Las respuestas `5xx` son `RETRYABLE_HTTP`; las demás
respuestas no recuperables son `TERMINAL_HTTP`, con `404` y `410` como `UNAVAILABLE`.

El cliente respeta `Retry-After` y, si no está disponible, `x-ratelimit-reset`. Cuando no
hay una indicación del servidor usa backoff exponencial para errores recuperables y una
espera de cuota predeterminada para límites. También reduce la concurrencia, mantiene un
margen de cuota y coordina el siguiente intento. Si la espera supera el presupuesto, el
prepare pausa con un checkpoint. Resume después de `retry_at` o del reset anunciado, sin
hacer fetch antes de ese momento, y conserva el mismo run, checksum y configuración.

Los eventos se guardan en `github_api_telemetry_event` como ledger append-only e idempotente.
Incluyen identificadores de evento, intento, ejecución, run, estudio y tarjeta, endpoint,
página, número de intento, fingerprint, marcas de tiempo y duración, clasificación,
decisión, estado HTTP, tipo y cuota de rate limit, reset, `Retry-After`, instante efectivo
de reintento, fuente de espera, espera programada, request ID, motivo de pausa y
checkpoint. La sanitización solo permite esos campos y una estructura de checkpoint limitada.
Nunca guarda URLs, tokens, cabeceras completas, cuerpos ni mensajes de GitHub.

El verificador de cobertura es de solo lectura y usa 300 tarjetas como denominador. Su
reporte conserva conteos por endpoint y campo, estados capturados y tarjetas omitidas.
`COMPLETE` significa que los intentos iniciados tienen su finalización; `INCOMPLETE`
indica que falta alguna finalización; `NOT_INSTRUMENTED` significa que
`attempt_telemetry_version` es nulo. En este último caso `event_count` es cero y los
conteos 403/429 son `null`, no cero. La ausencia histórica de eventos no permite certificar
que no ocurrieron respuestas 403 o 429.

Los límites operativos actuales son timeout de 30 segundos por solicitud, hasta cuatro
intentos, cinco minutos por página y treinta minutos por run. Timeline y diff siguen
siendo endpoints opcionales, y los límites de commits, archivos o patches se reflejan
como `TRUNCATED`, no como evidencia completa.

Para repetir una captura, ejecuta de nuevo el prepare con el mismo CSV después de revisar
el estado del run. El rerun crea un run nuevo y puede reutilizar validators de un run
completado; nunca actualiza una promoción existente. Un estudio que ya tiene decisiones
no puede recibir una promoción posterior. Los runs capturados permanecen inmutables y no
se trasladan ni reutilizan entre estudios.

Este delta añade únicamente la migración aditiva `006_github_api_telemetry.sql`; no modifica
runs ni promociones ya completados.

## Operación y rollback

Antes de aplicar la migración `004_github_pr_api_enrichment`, crea y verifica el backup
externo requerido por `STUDY_DATABASE_MODE=existing`. Conserva el archivo, manifiesto y
la imagen anterior para rollback. La ruta de rollback de solo lectura está en
[`ROLLBACK.md`](./ROLLBACK.md) y usa
`docker-compose.rollback-readonly.yml`; no ejecuta preparación ni migraciones y fuerza
`default_transaction_read_only=on`.

Para recuperar escritura, restaura el backup pre-004 en otra base aprobada y apunta allí
una instalación aislada. Nunca borres `labeling-data`, ejecutes `down -v` como rollback,
restaures sobre producción ni conviertas el launcher read-only en una ruta de escritura.
