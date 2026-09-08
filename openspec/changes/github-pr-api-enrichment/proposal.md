## Why

El estudio ya selecciona una muestra reproducible de 300 Pull Requests mediante CSV, pero varias tarjetas necesitan evidencia y metadatos que GitHub es la fuente autorizada para proporcionar. Esta capacidad debe activarse como un cambio separado para conservar la frontera histórica del MVP y permitir capturas reproducibles sin exponer credenciales ni sobrescribir decisiones privadas.

## What Changes

- Mantener el CSV, `pr_cards` y `study_card` como baseline inmutable y autoridad exclusiva de muestra, identidad, contenido, checksums y ordinal.
- Añadir capturas GitHub autenticadas como una proyección aditiva; el enriquecimiento nunca actualiza el contenido CSV persistido.
- Agrupar las 300 capturas en un `enrichment_run` versionado y promover exactamente un run completo e inmutable por estudio antes de cualquier clasificación o descarte.
- Vincular cada clasificación y descarte al estudio y al `enrichment_run` promovido que produjo la evidencia visible; las decisiones CSV-only conservan un run nulo explícito.
- Capturar validadores, estado y checksums por endpoint y página; un `304` solo puede reutilizar la página exacta de un run completado compatible.
- Definir endpoints obligatorios y opcionales, estados `COMPLETE`, `COMPLETE_EMPTY`, `UNAVAILABLE`, `TRUNCATED`, `PARTIAL` y `FAILED`, retries acotados y promoción atómica del lote.
- Omitir del enriquecimiento, sin abortar el lote, las tarjetas cuyo repositorio o Pull Request no exista en GitHub (`404`); conservar su baseline CSV y una captura auditable sin payload GitHub.
- Ajustar la ejecución a los límites primarios y secundarios de GitHub mediante un coordinador de cuota compartido, pausas hasta el reset anunciado y reanudación checkpointed, para completar las 300 tarjetas sin ráfagas ni repetición innecesaria de páginas.
- **BREAKING** Usar un único perfil neutral `default` para un token GitHub read-only compartido por todos los repositorios de la muestra, sin routing ni aliases por repositorio, sin persistir ni exponer tokens.
- No persistir bodies crudos de respuestas GitHub; conservar únicamente contenido normalizado, checksums, ETags y metadatos sanitizados.
- Mantener la migración SQL `004` sin cambios adicionales para esta corrección de configuración; los runs completados y promociones existentes permanecerán intactos y el rollback de la imagen anterior seguirá siendo read-only.

## Capabilities

### New Capabilities

- `github-pr-api-enrichment`: captura autenticada, normalización, versionado y persistencia de evidencia GitHub para las tarjetas CSV.

### Modified Capabilities

- `github-pr-ingestion`: cambia el contrato operativo para permitir un enriquecimiento offline posterior a la selección CSV, manteniendo CSV como fuente de muestra e identidad.
- `github-pr-explorer`: amplía la evidencia local disponible con campos GitHub capturados, sin requerir solicitudes desde el navegador.
- `study-management`: mantiene CSV como autoridad y fija una única promoción inmutable de enriquecimiento por estudio, vinculada a todas las decisiones participantes.

## Impact

- Afectará el proveedor de tarjetas, la persistencia de snapshots, el comando de preparación/importación y la documentación de despliegue; el plan de reanudación puede requerir una migración SQL aditiva para estados de pausa y checkpoints, sin modificar el baseline CSV ni decisiones.
- Añadirá configuración de un único perfil de credencial GitHub read-only, límites de API y política de captura; ningún secreto se almacenará en el repositorio, logs, HTML o fixtures. El formato anterior que usaba claves `owner/repository` como aliases requerirá migración de configuración.
- Un estudio que ya contenga clasificaciones o descartes no podrá promover posteriormente evidencia distinta; el run nuevo permanecerá inmutable pero no promocionado ni visible para ese estudio. Trasladar o reutilizar runs entre estudios queda fuera de alcance.
- Las credenciales solo estarán disponibles para el proceso one-shot de preparación; el servidor web y el navegador no recibirán tokens.
- El rollback sobre la base migrada será exclusivamente read-only con la imagen anterior; un rollback escribible requerirá restaurar un backup pre-migración en otro destino aprobado.
- No incluye webhooks, workers permanentes, selección de muestra desde GitHub, cambios de taxonomía, adjudicación, exportaciones ni rediseño de la UI.
