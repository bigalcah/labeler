## Context

El proveedor CSV ya define la identidad canónica de las 300 tarjetas y `study_card` conserva su pertenencia y orden. `pr_cards` y las tablas privadas de clasificación no deben convertirse en un almacenamiento mutable de respuestas GitHub. La motivación y el contrato observable están en `proposal.md` y en las especificaciones de esta change.

## Goals / Non-Goals

**Goals:**

- Añadir una frontera de proveedor GitHub REST reutilizable, autenticada y estrictamente de solo lectura.
- Separar identidad CSV, captura GitHub y decisiones privadas mediante snapshots versionados.
- Fijar un run completo e inmutable antes de que el estudio enriquecido pueda clasificarse.
- Hacer la ejecución reproducible, idempotente, paginada y operable como one-shot.
- Mantener el renderizado actual consumiendo un contrato de tarjeta con procedencia explícita.

**Non-Goals:**

- No seleccionar tarjetas desde GitHub ni reemplazar el CSV.
- No efectuar llamadas GitHub desde rutas de clasificación, navegador, Socket.io, webhooks o workers permanentes.
- No añadir purga automática de snapshots, exposición JSON cruda, taxonomía, adjudicación ni rediseño de interfaz.

## Decisions

### Frontera de ejecución

El enriquecimiento será un comando explícito de preparación/importación, antes de anunciar readiness. El servidor solo leerá snapshots del run promovido. Se descarta la alternativa de enriquecimiento bajo demanda porque expone credenciales, introduce fallos de red durante la clasificación y rompe la reproducibilidad.

### Modelo persistente y promoción

La migración `004_github_pr_api_enrichment` añadirá:

- `github_enrichment_run`: estudio, checksum CSV, configuración no secreta, versión de normalizador, estado, manifest checksum y timestamps.
- `github_run_page`: resultado por run, tarjeta, endpoint y página, con request fingerprint, ETag, checksums, estado, paginación y payload normalizado.
- `github_card_snapshot`: snapshot compuesto e inmutable, único por `(pr_card_id, snapshot_checksum)`.
- `github_enrichment_run_card`: una fila por `(run_id, pr_card_id)` que referencia el snapshot resultante.
- `study_enrichment_promotion`: una única fila por estudio que referencia un run `COMPLETED`; no admite `UPDATE` ni `DELETE`.
- `study_id` y `enrichment_run_id` en `pr_classification` y `pr_discard`.

Las decisiones tendrán FKs compuestas hacia `study_card`, `study_participant` y `github_enrichment_run_card`. Las filas existentes se backfillearán como decisiones CSV-only únicamente cuando cada tarjeta y participante resuelvan un solo estudio; una relación inexistente o ambigua abortará la migración. Una promoción se realizará bajo lock del estudio, después de comprobar ausencia de decisiones y exactamente 300 snapshots. Una tarjeta cuyo repositorio o Pull Request no exista en GitHub se conservará como una captura vacía auditable: sus endpoints quedarán `UNAVAILABLE`, no tendrá payload GitHub y su baseline CSV seguirá siendo visible; esto no reduce las 300 membresías ni los 300 snapshots requeridos.

### Cliente GitHub

Se usará un adaptador REST con headers de versión y `Accept` estándar, un único perfil de credencial neutral `default`, token fine-grained read-only, paginación por `Link`, ETags, un coordinador de cuota compartido y retries limitados por `Retry-After`/reset. La autenticación se inyectará por un secreto montado únicamente en `labeling-study-prepare`; `labeling-server` no recibirá ese secreto. La interfaz del adaptador permitirá sustituir posteriormente la fuente de credencial sin cambiar el contrato.

El coordinador será único para todo el run, no uno por worker. Cada respuesta actualizará sus señales de cuota (`X-RateLimit-Remaining`, `X-RateLimit-Reset`, `Retry-After` y señales de abuso secundario). La clasificación de límite será común para la capa de retry y el coordinador: incluirá `429`, headers de rate limit, `Retry-After` y el mensaje documentado de límite secundario en un `403`, sin confundirlo con un `403` de autorización. Antes de cada solicitud reservará una cuota con margen de seguridad, limitará la ráfaga mediante pacing global y reducirá la concurrencia ante `403`/`429`, `Retry-After`, latencia anómala o descenso rápido del remanente. La concurrencia inicial será 1, permanecerá entre 1 y 4 y solo aumentará después de ventanas estables con criterios temporales y de cuota; nunca se ignorará un reset anunciado ni se usará un número fijo de solicitudes como sustituto de los headers.

### Paginación, ETag y manifests

El fingerprint de página incluirá método, API base, ruta y query normalizadas, endpoint, versión API, `Accept` y cursor u ordinal, pero no `Authorization`. En `200`, la cadena continúa con el `Link` actual; en `304`, únicamente la página exacta reutiliza payload y `next` del baseline completado. El manifest compuesto se recalcula siempre; nunca se copia por el ETag de metadata de PR.

El checksum del snapshot será SHA-256 sobre un manifiesto canónico ordenado por endpoint y página, con estados, checksums normalizados y versión del normalizador. El checksum del run usará los 300 snapshots en orden `study_card.ordinal`.

### Proyección de lectura

`pr_cards` y `study_card` no serán actualizados por enriquecimiento. La consulta de tarjeta cargará el baseline, buscará la promoción única del estudio y construirá en memoria la proyección definida por `github-pr-ingestion`. Para campos superpuestos, title/body/author/state/merged/URL/fechas usarán GitHub no nulo del run promovido y, en su ausencia, CSV; `language` siempre conservará CSV. Las métricas GitHub solo prevalecerán cuando el endpoint esté `COMPLETE` o `COMPLETE_EMPTY`.

La evidencia CSV y GitHub permanecerá en namespaces separados. La proyección incluirá `enrichment.run_id`, `enrichment.snapshot_checksum`, `enrichment.completeness`, `enrichment.evidence` y un mapa `provenance` por JSON Pointer con `source`, `run_id`, `endpoint` y `status`. Un valor nulo, `UNAVAILABLE`, `TRUNCATED`, `PARTIAL` o `FAILED` nunca sobrescribirá un valor CSV disponible.

### Completitud y atomicidad del lote

Metadata de PR, commits, files, reviews, issue comments y review comments serán obligatorios; timeline y diff completo serán opcionales. Los estados terminales serán `COMPLETE`, `COMPLETE_EMPTY`, `UNAVAILABLE`, `TRUNCATED` y `FAILED`; `PARTIAL` solo existirá durante una ejecución y nunca será promocionable. Una página obligatoria fallida o una paginación incompleta marca el endpoint como `FAILED`.

Las páginas pueden persistirse como staging de un run `RUNNING`, pero ninguna consulta web las leerá. Un `404` de identidad en una tarjeta produce la captura vacía auditable y permite continuar con las siguientes tarjetas; otros fallos obligatorios marcan el run `FAILED`. Un agotamiento o pausa de cuota no marca el run como fallido: persiste el último cursor, página, fingerprint, estado de cuota sanitizado y próxima hora segura, y el mismo run se reanuda desde el checkpoint. La reanudación debe cargar `next_resume_at` y bloquear solicitudes hasta esa hora; el CLI no puede reportar una pausa como éxito ni permitir que el servidor arranque como si el lote hubiese terminado. Las páginas `COMPLETE`, `COMPLETE_EMPTY` y `PARTIAL` compatibles se reutilizan; el `nextUrl` persistido se consume para solicitar únicamente la primera página pendiente. Cualquier contenido conflictivo debe rechazarse, no ignorarse. La promoción es el único punto de publicación y no modifica una promoción previa.

### Retries y credenciales

La concurrencia será adaptativa, comenzará en 1 y permanecerá entre 1 y 4 salvo evidencia estable para aumentar; cada solicitud tendrá timeout de 30 segundos y como máximo cuatro intentos totales. Solo serán reintentables timeouts, transporte, `429`, `502`, `503`, `504` y `403` identificado como rate limit por headers o mensaje de límite secundario. El proceso respetará `Retry-After`, `X-RateLimit-Reset` y señales de límite secundario con backoff exponencial, jitter y margen de seguridad; una espera de cuota podrá superar el presupuesto normal de una página o run porque se reanudará desde el checkpoint, no se repetirá el lote. Si los cuatro intentos terminan por cuota, el resultado será `PAUSED` y el run conservará estado `RUNNING`; solo errores terminales no relacionados con cuota producirán `FAILED`. `401`, autorización `403`, `404`, malformación y errores de identidad serán terminales, excepto el `404` de identidad que conserva la omisión definida.

La configuración contendrá únicamente el perfil neutral `default`; no contendrá tokens inline ni un mapa `owner/name -> perfil`. Todos los repositorios de la muestra resolverán ese perfil. El perfil resolverá un secreto read-only mediante `GITHUB_TOKEN` o un archivo montado. Los logs aplicarán redacción a tokens, query strings sensibles y headers. El formato previo que trataba cada clave `owner/name` como alias será rechazado y deberá migrarse explícitamente a `default`. Un `404` de identidad se registrará sin cuerpo de respuesta y no se reintentará.

### Retención

No se conservarán responses GitHub crudas. Los normalizadores producirán únicamente los campos necesarios, y el body se descartará después de calcular su checksum. La evidencia normalizada privada permanecerá en snapshots inmutables sin purga automática durante este cambio y solo será legible mediante consultas del estudio promovido.

## Risks / Trade-offs

- [GitHub rate limits o cambios de API] → coordinador compartido basado en headers, margen de cuota, concurrencia adaptativa, pausa persistida hasta reset, checkpoints por página, ETags y evidencia de cobertura 300/300.
- [Payloads privados sensibles en la base] → no guardar cuerpos crudos, permisos read-only, redacción y acceso solo desde el estudio promovido.
- [Drift entre CSV y GitHub] → CSV sigue siendo autoridad de identidad; cada run conserva versión, checksum y momento de consulta.
- [Fallo a mitad del lote] → staging invisible, estado `FAILED` solo para errores terminales, pausa persistida para cuota, promoción atómica y reanudación idempotente.
- [Pausa no respetada tras reinicio] → cargar `next_resume_at`, bloquear solicitudes, conservar el mismo run y propagar `PAUSED` como resultado no exitoso del one-shot.
- [Repetición de páginas paginadas] → persistir y consumir `nextUrl`, reutilizar `PARTIAL` compatible y rechazar conflictos de fingerprint o contenido.
- [Ráfaga ante cuota disponible] → pacing global, concurrencia inicial 1 y aumento limitado a ventanas estables entre 1 y 4.
- [Cambio destructivo sobre clasificaciones] → FKs, promoción única y pruebas que impidan mutaciones de tablas privadas.

## Migration Plan

1. Crear un backup verificado antes de aplicar `004_github_pr_api_enrichment`.
2. Registrar `004` después de `003_private_pr_discard`; aceptar los ledgers válidos `001,003` y `001,002,003`, preservando `002` como migración externa.
3. Aplicar únicamente DDL aditivo y backfills transaccionales; no renombrar ni eliminar columnas consumidas por la imagen anterior.
4. Desplegar la imagen nueva con GitHub deshabilitado y verificar importación, clasificación y descarte CSV-only.
5. Ejecutar regresiones de cuota, pausa, reanudación por página y propagación de estado antes de cualquier ejecución real.
6. Habilitar el one-shot con el coordinador de cuota; permitir que pause hasta el reset anunciado y reanude el mismo run desde sus checkpoints sin repetir páginas completas.
7. Verificar en una ejecución controlada que el run alcanza 300/300 relaciones, que cada tarjeta tiene snapshot completo u omitido auditable, que no hay páginas pendientes, que no existen duplicados de solicitud y que la cuota no recibió respuestas de abuso antes de promoverlo.
8. Para rollback read-only, detener el stack nuevo y arrancar la imagen anterior mediante `docker-compose.rollback-readonly.yml`, sin preparación ni migraciones.
9. Para rollback escribible, restaurar el backup pre-004 en otra base aprobada; nunca borrar el ledger, ejecutar down migration ni restaurar sobre `labeling-data`.

## Open Questions

Ninguna. La retención, la promoción, la precedencia, la compatibilidad del ledger y el rollback quedan fijados en este diseño.
