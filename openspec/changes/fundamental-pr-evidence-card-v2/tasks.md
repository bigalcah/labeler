## 1. Auditoría y contrato

- [x] 1.1 Implementar un verificador de cobertura para las 300 tarjetas y el run `57e7fe7e-b503-4285-a734-dba40c9d2b42`, con conteos por campo, sección, estado y tarjetas omitidas; validar contra `plans/merged_after_rework_cards_seed_20260510.csv` y los manifests persistidos.
- [x] 1.2 Definir y probar el contrato versionado `CardV2`, `Field<T>` y `EvidenceSection<T>`, incluyendo estados, procedencia, checksum, run y timestamp; cubrir campos faltantes, nulos y truncados.
- [x] 1.3 Documentar el mapeo semántico de métricas para separar eventos de review, reviews `CHANGES_REQUESTED`, comentarios inline y comentarios de PR; rechazar el uso de `review_comments` como conteo de reviews.

## 2. Captura y normalización GitHub

- [x] 2.1 Extender `util/github-pr-normalizer.js` para conservar únicamente metadata, métricas, archivos, reviews, comentarios de PR, comentarios inline y estados de endpoint requeridos por `CardV2`, sin retener objetos crudos innecesarios.
- [x] 2.2 Implementar recuperación fill-only de cuerpos, conteos de archivos/cambios y evidencia de revisión cuando el CSV esté incompleto, manteniendo `language` exclusivamente desde CSV.
- [x] 2.3 Marcar `EMPTY`, `UNAVAILABLE` y `TRUNCATED` con conteos capturados/reportados y razones para `404/410`, cuerpos nulos, límites de commits/archivos y patches ausentes.
- [x] 2.4 Añadir pruebas de normalización para payloads anidados, reviews sin body, comentarios inline, límites API y respuestas parciales; esperar semántica determinista y sin síntesis de motivos.

## 3. Persistencia, promoción y telemetría

- [x] 3.1 Añadir versionado y persistencia aditiva para la estructura v2, snapshot checksum y procedencia por endpoint/campo sin actualizar `pr_cards`, `study_card` ni checksums CSV.
- [x] 3.2 Crear la migración aditiva con `attempt_telemetry_version` nullable y `github_api_telemetry_event`, constraints por tipo de evento, índice único `(attempt_id, event_type)`, triggers append-only y conservación de runs históricos.
- [x] 3.3 Implementar persistencia idempotente de eventos STARTED/FINISHED/PAUSE/RESUME, conflicto por reentrega divergente y reporte `COMPLETE`/`INCOMPLETE`/`NOT_INSTRUMENTED`; verificarla en `test/github-pr-persistence.test.js`.
- [x] 3.4 Instrumentar cada fetch real con `attempt_id`, `execution_id`, clasificación HTTP completa, decisión, cuota normalizada, retry efectivo y request ID allowlisted; nunca persistir URLs, tokens, headers completos, cuerpos ni mensajes.
- [x] 3.5 Auditar el run histórico y producir `telemetry_status=NOT_INSTRUMENTED`, `event_count=0` y conteos 403/429 `null`; crear run v2 nuevo solo si el verificador de cobertura lo exige.
- [x] 3.6 Añadir pruebas de promoción atómica, compatibilidad con 300 tarjetas, rechazo de promoción posterior a decisiones y preservación de runs existentes.

## 4. Proyección runtime

- [x] 4.1 Extender `util/study-card-projection.js` con `CardV2`, precedencia GitHub no nulo/CSV fallback, `language` CSV-only y procedencia por JSON Pointer.
- [x] 4.2 Separar namespaces de evidencia CSV y GitHub, conservar textos CSV originales y calcular `total_changes` solo desde adiciones y eliminaciones completas.
- [x] 4.3 Proyectar únicamente datos permitidos al participante y excluir raw payload, secretos, correos, categorías, observaciones y progreso ajeno; cubrir fallback y aislamiento con pruebas runtime.

## 5. Tarjeta participante

- [x] 5.1 Actualizar `views/partials/instance/data.ejs` para mostrar encabezado de identidad, intención, estado, autor, fechas, lenguaje del dataset y métricas con etiquetas separadas de muestra/evidencia.
- [x] 5.2 Añadir secciones locales para archivos, reviews, comentarios de PR, comentarios inline y actividad suplementaria, con orden determinista, colapsado inicial y paginación sin fetch a GitHub.
- [x] 5.3 Mostrar estados `EMPTY`, `UNAVAILABLE` y `TRUNCATED`, distinguir visualmente `CHANGES_REQUESTED` y enlazar explícitamente el diff completo y detalles profundos a GitHub.
- [x] 5.4 Añadir pruebas de renderizado para escaping, allowlist de URLs, contenido multilinea, estados de sección y ausencia de payloads crudos o información privada.
- [x] 5.5 Simplificar la evidencia participante: ocultar Timeline, Commits y revisiones sin cuerpo, manteniendo las métricas y la evidencia persistida para auditoría.
- [x] 5.6 Añadir pruebas de renderizado que confirmen la ausencia de Timeline, Commits y placeholders de revisiones sin texto, sin alterar los conteos de review.
- [x] 5.7 Sustituir la distribución flex de los encabezados CSV/GitHub por tres columnas estables para título, badge y expansión; añadir una regresión de layout que compare los bordes finales de `CSV`, `Available`, `Truncated`, `Empty` y `Unavailable` a 375, 768 y 1280 píxeles, permitiendo wrap sin solapamiento.

## 6. Integración y documentación

- [x] 6.1 Integrar la selección del snapshot v2 promovido en el flujo del estudio sin cambiar la muestra común de 300 tarjetas ni el progreso privado por participante.
- [x] 6.2 Implementar la barrera transaccional de pausa y checkpoint: confirmar FINISHED, PAUSE_COMMITTED, páginas, cuota y checkpoint juntos; conservar el orden `run_card -> checkpoint` y bloquear promoción de runs instrumentados incompletos.
- [x] 6.3 Implementar resume seguro: cero fetch antes de `retry_at`, `RESUME_STARTED` al continuar, mismo run/checksum/configuración/versiones compatibles y no repetición de tarjetas confirmadas.
- [x] 6.4 Actualizar documentación operativa sobre clasificación HTTP, cobertura, ledger, límites API, rollback read-only y la imposibilidad de certificar telemetría histórica ausente.
- [x] 6.5 Ejecutar una captura controlada futura y guardar su reporte de cobertura y ledger sanitizado como evidencia verificable, sin incluir credenciales ni respuestas crudas.

## 7. Verificación final

- [x] 7.1 Ejecutar lint JavaScript, pruebas de normalización/proyección/renderizado/persistencia/telemetría/integración y el verificador determinista de las 300 tarjetas; corregir solo fallos introducidos por este cambio.
- [x] 7.2 Verificar manualmente que la clasificación funciona sin red GitHub, que cada participante recibe la misma evidencia y que ningún payload privado aparece en HTML o logs.
- [x] 7.3 Reconstruir y recrear `labeling-server` mediante el Compose normal, verificar en Playwright sobre `http://localhost:7755` que no aparecen Timeline, la sección Commits, reviews sin texto ni el placeholder, y confirmar que los badges conservan la alineación especificada en los tres viewports sin errores de consola.
