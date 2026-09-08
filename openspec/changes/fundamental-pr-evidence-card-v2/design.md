## Context

El cambio amplía el enriquecimiento GitHub existente (`github-pr-api-enrichment`) y debe consumir snapshots persistidos, no GitHub desde el runtime web. El CSV sigue siendo autoridad de muestra e identidad. El normalizador actual no retiene toda la información necesaria para una tarjeta de evidencia, la proyección confunde conteos de reviews con comentarios inline y la vista expone más payload crudo del necesario. El run `57e7fe7e-b503-4285-a734-dba40c9d2b42` terminó correctamente, pero no contiene ledger histórico suficiente para demostrar respuestas 403/429.

## Goals / Non-Goals

**Goals:**

- Definir una proyección `CardV2` estable, aditiva y versionada.
- Recuperar campos faltantes con semántica compatible y estados explícitos.
- Separar métricas de reviews, comentarios de PR y comentarios inline.
- Renderizar evidencia fundamental localmente, segura y útil para clasificar retrabajo.
- Auditar cobertura de las 300 tarjetas y registrar telemetría sanitizada en futuras capturas.

**Non-Goals:**

- Cambiar el CSV, la selección de muestra, la taxonomía o las decisiones privadas.
- Descargar o embebir diffs completos, blobs, CI, perfiles o historiales ilimitados.
- Completar `language` con estadísticas actuales del repositorio.
- Añadir webhooks, workers permanentes o solicitudes GitHub desde el navegador.
- Reconstruir telemetría 403/429 que no fue capturada en el run histórico.

## Decisions

### Proyección aditiva con procedencia por campo

Se añadirá un DTO `CardV2` con `Field<T>` y `EvidenceSection<T>`. Cada valor tendrá fuente (`CSV`, `GITHUB`, `DERIVED`), run, checksum, endpoint, estado y timestamp. La precedencia será GitHub no nulo para campos compatibles y CSV como fallback; `language` será CSV-only. Esto evita mutar el baseline y hace auditable por qué un dato aparece.

Alternativa descartada: sobrescribir columnas CSV o mantener un objeto GitHub crudo. La primera rompe reproducibilidad; la segunda amplía exposición y dificulta el contrato.

### Namespaces de evidencia separados

Los textos CSV existentes conservarán sus nombres y los arrays GitHub permanecerán agrupados por endpoint. No se fusionarán comentarios ni se recalcularán columnas históricas con concatenaciones. Los nombres de métricas distinguirán `review_event_count`, `changes_requested_review_count`, `review_comment_count` e `issue_comment_count`.

Alternativa descartada: usar `review_comments` como cantidad de revisiones, porque ese campo representa comentarios inline y produce una tarjeta semánticamente incorrecta.

### Snapshot local y paginación de presentación

La captura offline persistirá la evidencia necesaria; la vista recibirá una proyección ya sanitizada. Archivos, revisiones con explicación escrita y comentarios se mostrarán localmente con secciones colapsadas y paginación determinista. Timeline y Commits no se mostrarán como secciones participantes; las revisiones sin cuerpo permanecerán disponibles solo para métricas y auditoría, sin placeholder explicativo. El diff completo será un enlace explícito a GitHub.

Alternativa descartada: fetch bajo demanda en la vista, porque rompe clasificación offline, reproducibilidad y aislamiento de credenciales.

### Estados en vez de silencios

Cada endpoint distinguirá completo, vacío, no disponible y truncado. Los límites documentados de GitHub se conservarán como truncamiento con conteos, no como falsa completitud. Los endpoints requeridos que fallen impedirán promoción; fallas opcionales se mostrarán como no disponibles.

### Encabezados de evidencia con columnas estables

Cada `summary` de evidencia usará el mismo patrón de tres columnas: título flexible, etiqueta de fuente/disponibilidad alineada al final y control de expansión de ancho fijo. El título podrá envolver sin desplazar la etiqueta ni superponerse con ella. El patrón será compartido por la evidencia CSV y GitHub y conservará esas tres responsabilidades en escritorio, tablet y móvil.

Alternativa descartada: distribuir título, etiqueta y pseudoelemento con `justify-content: space-between`, porque la posición horizontal de la etiqueta cambia según el ancho del título y dificulta comparar estados entre filas.

### Ledger versionado de eventos

Se añadirá una migración aditiva con `attempt_telemetry_version SMALLINT NULL` en `github_enrichment_run` y una tabla append-only `github_api_telemetry_event` con:

- `event_id UUID PRIMARY KEY` y `event_type ATTEMPT_STARTED | ATTEMPT_FINISHED | PAUSE_COMMITTED | RESUME_STARTED`.
- `run_id`, `study_id`, `execution_id`, `pr_card_id`, `attempt_id`, endpoint, página, número de intento y fingerprint.
- `occurred_at`, `recorded_at`, duración, clasificación (`SUCCESS`, `NOT_MODIFIED`, `RATE_LIMIT`, `RETRYABLE_HTTP`, `TERMINAL_HTTP`, `TRANSPORT_ERROR`, `TIMEOUT`) y decisión (`ACCEPT`, `RETRY`, `PAUSE`, `UNAVAILABLE`, `FAIL`).
- Estado HTTP, código controlado de error, tipo de límite (`PRIMARY`, `SECONDARY`, `UNSPECIFIED`), cuota restante, reset, `Retry-After`, retry efectivo, origen de espera, duración programada y request ID sanitizado.
- Motivo de pausa, evento causal y snapshot del checkpoint cuando el evento sea de pausa.

`attempt_id` se genera antes de cada fetch y vincula exactamente un STARTED con un FINISHED. Un índice único parcial `(attempt_id, event_type)` hace idempotente la reentrega; contenido divergente produce conflicto. Inserts solo mientras el run está `RUNNING`; UPDATE y DELETE siempre se rechazan. No habrá TTL ni cascade porque el run es inmutable.

No se mantendrá una transacción abierta durante HTTP: STARTED se confirma antes del fetch y FINISHED antes de dormir o reintentar. En pausa, FINISHED pendiente, un único PAUSE_COMMITTED, páginas completas, cuota y checkpoint se confirman atómicamente. `run_card` se confirma antes de avanzar `cardOrdinal`.

La clasificación será estricta: 429 siempre es RATE_LIMIT; 403 solo lo es con `Retry-After`, cuota cero o señal secundaria reconocida; 403 con solo reset es terminal. Retry-After válido se normaliza a timestamp y prevalece junto al reset aplicable; sin hint se usa fallback de 60 segundos. Los hints del servidor no se multiplican exponencialmente.

El informe CLI/JSON incluirá `telemetry_status`, pares abiertos, intentos por endpoint/clasificación/status, retries, pausas, espera programada, cuota mínima y primera/última observación. Nunca incluirá URLs, tokens, headers completos, cuerpos, payloads, mensajes de error o query strings. El run histórico conservará versión NULL, eventos cero y conteos 403/429 NULL: esto prueba falta de instrumentación, no ausencia de rate limits.

Alternativa descartada: inferir rate limits desde el estado final de páginas, porque no permite distinguir una página exitosa tras retry de una primera respuesta exitosa.

### Promoción y compatibilidad

Antes de reutilizar el run existente se ejecutará un verificador de cobertura por campo y sección. Si faltan campos obligatorios que el snapshot no representó, se creará un run v2 nuevo. Un run distinto no reemplazará evidencia de un estudio con decisiones.

## Risks / Trade-offs

- [La API puede devolver datos modificados o eliminados desde el merge] -> Mostrar `captured_at`, procedencia y estado del snapshot; no presentarlo como reconstrucción histórica perfecta.
- [Los límites de 250 commits y 3.000 archivos impiden completitud absoluta] -> Persistir conteos capturados/reportados y marcar `TRUNCATED` con enlace a GitHub.
- [El contrato v2 puede requerir migración SQL] -> Mantener cambios aditivos, versionar normalizador y no tocar tablas baseline ni decisiones.
- [La tarjeta puede crecer demasiado] -> Paginación local, colapsado inicial y exclusión de payloads crudos.
- [El run histórico no prueba rate limits] -> Bloquear esa afirmación en el reporte y exigir ledger en futuras ejecuciones.

## Migration Plan

1. Verificar cobertura y estado de promoción del run existente sin mutarlo.
2. Añadir contrato/versionado, normalización y persistencia aditiva para los campos v2.
3. Ejecutar captura nueva solo si el verificador demuestra que el run existente no es compatible.
4. Promover atómicamente un run v2 completo antes de habilitarlo para el estudio.
5. Activar el proyector y la vista v2, conservando una ruta de lectura del contrato anterior para rollback read-only.
6. Validar aislamiento y payload HTML antes de permitir clasificación.

Rollback: detener la activación v2 y volver a servir el snapshot/promoción anterior en modo read-only; no borrar runs ni reescribir decisiones.

## Open Questions

Ninguna que cambie el contrato. La interfaz exacta de paginación y el límite visual por sección pueden fijarse durante implementación respetando los estados, el orden determinista y el requisito de clasificación offline.
