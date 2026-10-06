## Why

La retroalimentación docente del estudio señala que la tarjeta del PR satura al participante: las métricas no aportan utilidad visual y la evidencia se presenta duplicando lo que el enlace a GitHub ya ofrece. Además, las categorías privadas no registran su significado y todas se presentan con el mismo color, lo que dificulta reconocerlas y recordar qué representan. Los datos capturados siguen siendo valiosos para el análisis y deben conservarse íntegros.

## What Changes

- Ocultar el bloque de métricas en la tarjeta del participante. Las métricas permanecen proyectadas y almacenadas en el snapshot y en CardV2, disponibles para el análisis y la auditoría del operador; este cambio NO añade su serialización al paquete offline ni elimina o reordena sus columnas existentes (el paquete solo añade `category_definition` al final de `categories.csv`).
- Compactar la tarjeta priorizando la intención del PR (descripción), la evidencia seleccionada del CSV y las revisiones y comentarios que explican el retrabajo.
- Retirar de la vista principal el listado exhaustivo de archivos y el volcado de evidencia CSV completa; se conserva el enlace a GitHub y la evidencia sigue almacenada.
- Presentar cada sección de evidencia con vista previa acotada y divulgación progresiva local, en lugar de desplegar todos los registros capturados.
- Añadir una definición opcional, editable y privada por categoría, visible al identificar la categoría y normalizada a ausente cuando queda vacía.
- Asignar a cada categoría un color estable de una paleta categórica fija, conservado al renombrar y reutilizado en la selección, la gestión y el resumen de progreso.
- Distinguir la categoría seleccionada con señales adicionales al color (marca visible y texto) y mantener nombre y definición siempre legibles.
- Incluir la definición de cada categoría en la exportación offline `categories.csv`.
- Sin cambios incompatibles: la migración es aditiva y preserva categorías, clasificaciones, snapshots y decisiones existentes.

## Capabilities

### New Capabilities

Ninguna.

### Modified Capabilities

- `github-pr-explorer`: presentación de la tarjeta del participante (métricas no visibles, priorización y compactación de evidencia, archivos fuera de la vista principal con enlace a GitHub).
- `private-open-card-sorting`: definición de categoría, paleta categórica estable, selección distinguible sin depender solo del color y campos exportados en `categories.csv`.

## Impact

- Vistas: `views/review.ejs`, `views/partials/instance/data.ejs`, `views/progress.ejs`.
- Cliente: `public/js/review.js`, `public/js/pr-card.js`, `public/css/main.css`.
- Rutas: `routes/categories/index.js` y `routes/categories/[id]/index.js` reenvían `definition` preservando si la clave fue enviada u omitida.
- Servicio y persistencia: `util/study-service.js`, `util/study-write-repository.js`, `util/study-read-repository.js`, `util/category-palette.js`, nueva migración aditiva en `schema/migrations/`; `util/study-card-projection.js` se conserva sin cambios de contrato.
- Exportación: `util/study-export.js`, `util/study-export-format.js` y sus pruebas.
- Pruebas: `test/verification-contracts.test.js`, `test/study-schema-multi-study.test.js`, `test/study-bootstrap.test.js`, `test/study-export.test.js`, `test/card-v2.test.js`, `test/provider-fixture-card-view.test.js`, `test/progress.browser.test.js`, `test/study-private-runtime-characterization.test.js` y las pruebas de categorías, servicio y migración `013`.
- Documentación: `docs/JAVASCRIPT-API.md`, `docs/ARCHITECTURE.md`, `docs/EXPORT-RUNBOOK.md` y `docs/PARTICIPANT-GUIDE.md`.
- No cambia: la captura y el almacenamiento de snapshots, métricas y payloads; los contratos de sesión, CSRF y privacidad de los endpoints existentes; la ingesta `github-pr-ingestion`.
