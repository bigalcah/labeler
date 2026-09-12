# Enriquecimiento GitHub

El enriquecimiento es opcional y se ejecuta únicamente durante `labeling-study-prepare`. El servidor web, el navegador y
la clasificación no reciben credenciales ni realizan solicitudes GitHub. Solo pueden leer snapshots del estudio que ya
fueron completados y promovidos.

La configuración base `deployment/docker-compose.yml` desactiva el enriquecimiento y no monta ni requiere un token
GitHub. Para activarlo, usa siempre el override dedicado:

```bash
docker compose --env-file deployment/.env \
  -f deployment/docker-compose.yml \
  -f deployment/docker-compose.github-enrichment.yml \
  up --build -d
```

## Perfil y configuración

El run siempre se vincula a un estudio persistido y a su cardinalidad persistida. Solo se aceptan `expected_card_count=30`
o `expected_card_count=300`. El proceso carga el `study_id`, checksum y membresía ordenada del estudio seleccionado, y
exige exactamente 30 o 300 tarjetas según esa fila persistida. Nunca usa el conteo del token, del navegador o de un
argumento que contradiga la base.

El mismo contrato sirve para `pr-card-sorting-local` con 300 tarjetas y para `pr-card-sorting-validation-30` con 30. El
CSV selecciona la muestra; GitHub solo aporta snapshots opcionales. Un token fine-grained de solo lectura puede cubrir las
tarjetas y repositorios normalizados del perfil en preparación. La configuración solo admite el alias neutral `default`;
no existe routing por repositorio ni se aceptan claves `owner/name`, perfiles adicionales, prefijos o comodines.

```dotenv
GITHUB_ENRICHMENT_ENABLED=true
GITHUB_API_BASE=https://api.github.com
GITHUB_API_VERSION=2022-11-28
GITHUB_DEFAULT_ALIAS=default
GITHUB_CREDENTIAL_ALIASES={"default":{"tokenFile":"/run/secrets/github-token","permissions":["metadata","pulls","contents","issues"]}}
GITHUB_TOKEN_HOST_PATH=/absolute/external/github-token
```

`GITHUB_TOKEN_HOST_PATH` es una ruta absoluta a un archivo externo protegido, no el token. Añádela solo al archivo local
`deployment/.env` cuando se use el override; no añadas el valor del token a ningún archivo `.env` ni al repositorio.

Los permisos declarados son la frontera mínima del cliente: metadata del repositorio, pull requests,
contenido/archivos e issues/comentarios. El token se monta o expone solo al proceso prepare desde
`GITHUB_TOKEN_HOST_PATH` y nunca se persiste en páginas normalizadas, snapshots, logs o errores.

El perfil debe declarar exactamente una fuente de secreto: `tokenEnv` o `tokenFile`, pero nunca ambas. La validación falla
antes de cualquier solicitud con códigos sanitizados `INVALID_PROFILE`, `CREDENTIAL_NOT_FOUND` o
`INSUFFICIENT_PERMISSIONS`. El fingerprint de configuración usa valores canónicos y permisos ordenados, pero nunca el
token ni un hash del token.

## Ejecución y estados

El prepare valida el checksum del CSV, crea un run invisible y consulta metadata, commits, files, reviews, issue comments
y review comments. Timeline y diff son opcionales. Las solicitudes tienen timeout de 30 segundos, concurrencia
configurable de 1 a 8, hasta cuatro intentos y presupuestos de cinco minutos por página y treinta minutos por run.

Un run solo puede quedar `COMPLETED` y promocionarse cuando existen exactamente los snapshots del estudio persistido,
30 o 300, y todos los endpoints obligatorios terminaron correctamente. Los estados `COMPLETE_EMPTY`, `UNAVAILABLE`,
`TRUNCATED` y `FAILED` se conservan por endpoint; solo un run completo se hace visible. Un fallo deja el run en `FAILED`
y no altera tarjetas ni decisiones.

## Clasificación, límites y telemetría

Cada fetch real se registra como un intento. Una respuesta `429` se clasifica como `RATE_LIMIT` y se reintenta. Una
respuesta `403` solo se clasifica así cuando sus cabeceras o su mensaje indican un límite primario o secundario; un `403`
sin esas señales es un `TERMINAL_HTTP` de permisos. Las respuestas `5xx` son `RETRYABLE_HTTP`; las demás respuestas no
recuperables son `TERMINAL_HTTP`, con `404` y `410` como `UNAVAILABLE`.

El cliente respeta `Retry-After` y, si no está disponible, `x-ratelimit-reset`. Cuando no hay una indicación del servidor
usa backoff exponencial para errores recuperables y una espera de cuota predeterminada para límites. También reduce la
concurrencia, mantiene un margen de cuota y coordina el siguiente intento. Si la espera supera el presupuesto, el prepare
pausa con un checkpoint. Resume después de `retry_at` o del reset anunciado, sin hacer fetch antes de ese momento, y
conserva el mismo run, checksum y configuración.

Los eventos se guardan en `github_api_telemetry_event` como ledger append-only e idempotente. Incluyen identificadores de
evento, intento, ejecución, run, estudio y tarjeta, endpoint, página, número de intento, fingerprint, marcas de tiempo y
duración, clasificación, decisión, estado HTTP, tipo y cuota de rate limit, reset, `Retry-After`, instante efectivo de
reintento, fuente de espera, espera programada, request ID, motivo de pausa y checkpoint. La sanitización solo permite esos
campos y una estructura de checkpoint limitada. Nunca guarda URLs, tokens, cabeceras completas, cuerpos ni mensajes de
GitHub.

El verificador de cobertura es de solo lectura y usa la cardinalidad persistida del estudio como denominador, 30 o 300.
Su reporte conserva conteos por endpoint y campo, estados capturados y tarjetas omitidas. `COMPLETE` significa que los
intentos iniciados tienen su finalización; `INCOMPLETE` indica que falta alguna finalización; `NOT_INSTRUMENTED` significa
que `attempt_telemetry_version` es nulo. En este último caso `event_count` es cero y los conteos 403/429 son `null`, no
cero. La ausencia histórica de eventos no permite certificar que no ocurrieron respuestas 403 o 429.

Los límites operativos actuales son timeout de 30 segundos por solicitud, hasta cuatro intentos, cinco minutos por página
y treinta minutos por run. Timeline y diff siguen siendo endpoints opcionales, y los límites de commits, archivos o
patches se reflejan como `TRUNCATED`, no como evidencia completa.

Para repetir una captura, ejecuta de nuevo el prepare con el mismo CSV después de revisar el estado del run. El rerun
crea un run nuevo y puede reutilizar validators de un run completado; nunca actualiza una promoción existente. Un estudio
que ya tiene decisiones no puede recibir una promoción posterior. Los runs capturados permanecen inmutables y no se
trasladan ni reutilizan entre estudios.

Este delta añade únicamente la migración aditiva `006_github_api_telemetry.sql`; no modifica runs ni promociones ya
completados.

## Operación y rollback

Antes de aplicar la migración `004_github_pr_api_enrichment`, crea y verifica el backup externo requerido por
`STUDY_DATABASE_MODE=existing`. Conserva el archivo, manifiesto y la imagen anterior para rollback. La ruta de rollback
de solo lectura está en [`ROLLBACK.md`](./ROLLBACK.md) y usa `docker-compose.rollback-readonly.yml`; no ejecuta
preparación ni migraciones y fuerza `default_transaction_read_only=on`.

Para recuperar escritura, restaura el backup pre-004 en otra base aprobada y apunta allí una instalación aislada. Nunca
borres `labeling-data`, ejecutes `down -v` como rollback, restaures sobre producción ni conviertas el launcher read-only
en una ruta de escritura.

## Límites de evidencia

Este documento describe el contrato y la operación preparada, no una captura live verificada. No hay llamadas GitHub
durante la clasificación ni un worker permanente. La captura live sigue pendiente, al igual que el E2E histórico de
aislamiento, el E2E público en VPS, la aceptación real de backup y restore externos y el cierre documental formal.
