## Context

Ver `proposal.md`. El estado actual relevante:

- La tarjeta del participante (`views/partials/instance/data.ejs`) renderiza el bloque de métricas (sección `02 / Signal`, línea 57), el volcado completo de evidencia CSV (`csv_evidence.all_text`, líneas 24-26 y 52-56) y las secciones GitHub `files`, `reviews`, `issue_comments` y `review_comments` (líneas 26 y 58-69). La divulgación usa `data-page-size="10"` y `public/js/pr-card.js` revela todos los registros restantes con un solo botón.
- `util/study-card-projection.js` construye `v2.metrics` y `v2.github_evidence`; el snapshot persistido vive en `github_run_page.normalized_payload` (migración `004`) y no depende de la vista.
- Las categorías se eligen con un `<select>` y se gestionan en una lista separada (`views/review.ejs` líneas 70-99), ambas con el mismo estilo; los modales solo piden nombre (líneas 131-183). `public/js/review.js` crea y renombra categorías y actualiza el DOM.
- `participant_category` tiene `raw_name`, `normalized_name`, `study_id`, `created_at`, `updated_at` (migración `010`), sin definición ni color. `util/study-read-repository.js` y `util/study-write-repository.js` son los accesos de lectura/escritura; `util/study-service.js` valida y orquesta.
- El resumen de progreso por categoría se renderiza en `views/progress.ejs` (líneas 146-181) a partir de `loadParticipantCategorySummary`.
- La exportación offline escribe `categories.csv` desde `util/study-export.js` (`loadCategories`, líneas 51-65) con encabezados fijos en `util/study-export-format.js` (`CATEGORIES_HEADERS`, líneas 9-11).
- Las migraciones se registran en `managedMigrations` de `util/study-schema.js`; la última es `012_global_normalized_username`.

Restricciones: privacidad por participante y estudio ya establecida; clasificación offline; sin bundler (EJS + JavaScript plano + CDN); migraciones aditivas; sin cambios en la captura ni en los payloads de snapshot.

## Goals / Non-Goals

**Goals:**

- Priorizar el contenido de la tarjeta: descripción, evidencia seleccionada del CSV y evidencia GitHub que explica el retrabajo, con vista previa acotada.
- Mantener íntegros snapshots, métricas y payloads: solo cambia lo que se muestra.
- Dotar a cada categoría de definición opcional privada y de un color estable de una paleta categórica fija, reutilizado en todas las superficies del participante.
- Integrar selección y gestión de categorías en una sola experiencia con selección distinguible sin depender solo del color.
- Incluir la definición en `categories.csv` y preservar la compatibilidad con categorías existentes.

**Non-Goals:**

- No modificar `github-pr-ingestion`, la captura, el almacenamiento ni los contratos de snapshot (`CardV2`, `github_run_page`).
- No añadir rutas HTTP, selectores de estudio/participante, borrado de categorías, colores elegidos por el usuario ni taxonomía jerárquica.
- No cambiar la paginación de `/progress` ni la exportación en navegador (sigue siendo operador-only).
- No rediseñar la tarjeta fuera de lo especificado (ni el encabezado, ni el formulario, ni la navegación).

## Decisions

### 1. Métricas: dejar de renderizar sin tocar la proyección

Se elimina la sección de métricas de `views/partials/instance/data.ejs` y la construcción de `metrics` solo para vista. `util/study-card-projection.js`, `v2.metrics` y el snapshot quedan intactos: la proyección CardV2 y el snapshot conservan los valores con procedencia y disponibilidad para el análisis y la auditoría del operador. Este cambio no añade métricas al paquete offline ni elimina o reordena sus columnas existentes; el paquete únicamente añade `category_definition` al final de `categories.csv`.

Alternativa descartada: eliminar las métricas de la proyección o del snapshot; rompe la trazabilidad y el requisito de mantenerlas almacenadas.

### 2. Evidencia priorizada con divulgación por lotes

En `views/partials/instance/data.ejs`:

- CSV: se muestran `Description` y `Selected CSV evidence`; se retira el bloque `All CSV evidence` (`csv_evidence.all_text`) de la tarjeta. El dato sigue en la proyección.
- GitHub: la lista visible queda en `reviews` (con cuerpo escrito y `CHANGES_REQUESTED` distinguido), `issue_comments` y `review_comments`. `files` sale de `visibleEvidenceSections`; el enlace a GitHub ya presente ("View full diff and deeper GitHub details") sigue siendo la vía para el listado completo.
- Cada sección conserva el badge de `captured_count` (siempre el conteo del snapshot, nunca el conteo filtrado de la vista) y usa `data-page-size="3"` como tamaño de vista previa.
- Divulgación acumulativa precisa: al cargar, los elementos visibles son `min(data-page-size, elementos elegibles)`; cada activación revela `min(data-page-size, restantes)` adicionales, nunca todos de golpe. Mostrar todos los elementos mediante lotes sucesivos es válido. Mientras queden elementos, el botón anuncia `Show N more`, donde `N = min(data-page-size, restantes)`; tras revelar el último lote, el botón se retira y se gestiona el foco conforme a la prueba de teclado.
- Las revisiones con cuerpo vacío o solo espacios se excluyen de la vista por el filtro existente y no cuentan como elementos elegibles.
- `public/js/pr-card.js` reemplaza el límite fijo de 10 y el revelado total por este comportamiento por lotes sobre los `[data-local-item]` de cada `[data-local-section]`; el control es un `<button type="button">` real, operable por teclado.

Alternativas descartadas: eliminar las secciones locales (pierde valor offline); mantener el botón que revela todo (saturación motivo de la retroalimentación); fijar el lote en 10 (el docente pidió compactar).

### 3. Definición de categoría en `participant_category`

Migración aditiva `013_category_definition_color`:

- `definition TEXT NULL`.
- Validación en `util/study-service.js`: si el valor no es texto → `422`; se recorta; vacío → `NULL`; longitud máxima 500 caracteres tras recortar (501 → `422`).
- `loadParticipantCategories`, `loadStudyCardPage` y `loadParticipantCategorySummary` devuelven `definition`; la vista la muestra al identificar la categoría (selección, gestión y resumen de progreso).
- La concurrencia optimista existente (`expected_updated_at`) se mantiene.

Contrato de cableado (`routes/categories/index.js` y `routes/categories/[id]/index.js`):

- Ambas rutas reenvían `definition` al servicio; el `PATCH` debe distinguir "clave enviada" de "clave omitida" para no borrar la definición al renombrar.
- `POST` con `definition` omitida → almacena `NULL`. `POST` con `definition: ""` o solo espacios → `NULL`. Números, arrays, objetos o `null` explícito → `422`.
- `PATCH` con `definition` omitida → conserva la definición existente. `PATCH` con `definition: ""` o solo espacios → limpia a `NULL`. `PATCH` con `null` explícito, números, arrays u objetos → `422`.
- Más de 500 caracteres tras recortar → `422`.
- El editor envía el área de texto vaciada como `definition: ""` (nunca `null`), de modo que limpiar la definición es un envío explícito y la omisión solo ocurre cuando el consumidor no incluye la clave.
- La traducción existente `expected_updated_at` → `expectedUpdatedAt` se conserva.

Alternativas descartadas: tabla separada (coste sin beneficio para 1:1); guardar el significado en `classification_remarks` (pertenece a la clasificación, no a la categoría; el docente pidió no olvidar qué significa la categoría).

### 4. Color categórico persistido, estable, accesible y compatible con CSP

- Columna aditiva `color_slot SMALLINT NOT NULL DEFAULT 0` con `CHECK (color_slot >= 0 AND color_slot < 12)`.
- Asignación al crear: dentro de `withTransaction` se bloquea la fila de membresía del participante en `study_participant` para `(study_id, reviewer_id)` (`SELECT ... FOR UPDATE`) y después se ejecuta el `INSERT` con `(COUNT(*) de categorías del participante y estudio) % 12` como sentencia posterior sobre el mismo cliente. El bloqueo serializa las altas: tras la espera, la sentencia de conteo ve un snapshot READ COMMITTED fresco que ya incluye la categoría de la transacción competidora, de modo que dos altas concurrentes no colisionan. La asignación es cíclica sobre 12 posiciones (`% 12`), no monótona; como no hay borrado de categorías, la posición se conserva al renombrar y reordenar. `createCategory` (servicio) es el único propietario de `withTransaction`; pasa el mismo cliente al repositorio, que ejecuta el bloqueo de membresía y después el INSERT sin abrir otra transacción ni adquirir otra conexión. La prueba concurrente invoca dos `createCategory`, o envuelve explícitamente cada llamada al repositorio en su propia transacción.
- Backfill de categorías existentes: `(ROW_NUMBER() OVER (PARTITION BY study_id, participant_id ORDER BY created_at, id) - 1) % 12`.
- Paleta fija en `util/category-palette.js`: contrato categórico fijo de 12 posiciones. Valores iniciales: `#4E79A7`, `#F28E2B`, `#E15759`, `#76B7B2`, `#59A14F`, `#EDC948`, `#B07AA1`, `#9C755F`, `#BAB0AC`, `#2F4B7C`, `#D37295`, `#499894`. Estos hex son muestras iniciales que PUEDEN sustituirse durante la implementación si la medición del contraste real del indicador renderizado cae por debajo de 3:1, sin cambiar el contrato de 12 posiciones.
- La paleta NO se afirma distinguible en escala de grises: `#59A14F` y `#D37295` tienen luminancia casi idéntica y varios tonos quedan por debajo de 3:1 contra blanco (`#F28E2B` 2.42:1, `#76B7B2` 2.29:1, `#EDC948` 1.61:1, `#BAB0AC` 2.12:1). El reconocimiento y la selección dependen del texto del nombre, un borde neutro y la marca de check / texto `Selected`; el color nunca es la única señal.
- Las respuestas de `POST /categories` y `PATCH /categories/:id` y las lecturas de servicio devuelven `color_slot` y `color` (hex resuelto en el servidor); el navegador no duplica la paleta.
- Compatibilidad con CSP: `util/security-headers.js` fija `style-src-attr 'none'`, por lo que se prohíben los atributos `style="..."` en EJS y JavaScript y se prohíbe debilitar la CSP. El mecanismo son clases de posición en la hoja externa `public/css/main.css`: `.category-slot-0 { --category-color: <hex>; }` hasta `.category-slot-11`. Tanto las filas renderizadas en el servidor como las creadas o editadas por JavaScript usan la clase `category-slot-N`; el color viaja como clase, nunca como estilo inline. Una prueba de consistencia verifica que las 12 clases CSS coinciden por posición con `util/category-palette.js`.
- No se impone unicidad de color: con más de 12 categorías se repiten tonos y el nombre y la definición siguen siendo la identificación autoritativa.

Alternativas descartadas: color derivado de hash del `id` (colisiones imprevisibles y aspecto inestable al comparar listas); color elegido por el usuario (alcance mayor, riesgo de contraste y de accesibilidad); atributo `style` inline (bloqueado por `style-src-attr 'none'`).

### 5. UX integrada, accesible y compatible con CSP

`views/review.ejs` reemplaza el `<select>` y la lista de gestión por **una sola lista de selección**:

- Cada fila es un `input type="radio"` nativo con `name="category_id"` y `required` cuando no hay selección (el formulario sigue publicando el mismo campo; no cambia la ruta de clasificación). El radio nativo garantiza operación por teclado (flechas y espacio) y foco visible; la etiqueta `<label>` envuelve el radio, el nombre y la definición.
- Los botones de edición quedan FUERA de la etiqueta del radio, de modo que activarlos nunca cambia la selección.
- La fila muestra: indicador de color decorativo (`aria-hidden`, clase `category-slot-N`, sin atributo `style`), nombre y definición breve (si existe, sin truncar de forma que obligue a abrir el editor); el botón de edición es secundario.
- La fila seleccionada añade borde neutro, ícono de check visible y el texto `Selected`; la selección es reconocible sin depender del color (nombre, borde y check/texto) y con lectores de pantalla (radio nativo + etiqueta).
- Los modales de creación y edición incorporan `Definition (optional)` con `maxlength="500"`; el botón de guardado deja de anunciar solo el nombre y refleja que también guarda la definición.
- `public/js/review.js` construye y actualiza las filas usando la clase `category-slot-N` según `category.color_slot`, `category.definition` y `textContent`/escapado seguro para textos hostiles; no usa estilos inline y conserva la concurrencia optimista, los mensajes de error existentes y la preservación del formulario ante un fallo de edición.

Alternativas descartadas: conservar `<select>` + lista (es la queja del docente); chips sin definición (peor escaneo de textos largos); estilos inline (bloqueados por CSP).

### 6. Consistencia en el progreso

`loadParticipantCategorySummary` y `loadStudyCardPage` devuelven `definition` y `color`; `views/progress.ejs` muestra el indicador de color en cada grupo y en cada fila clasificada, y la definición en el grupo. Así el color es el mismo en selección, gestión y progreso.

### 7. Exportación con definición

`CATEGORIES_HEADERS` añade `category_definition` **al final** (compatibilidad de orden para consumidores existentes); `loadCategories` selecciona `category.definition AS category_definition`; una definición ausente se serializa como celda vacía. El manifiesto y los checksums SHA-256 se recalculan desde los bytes finales del CSV. El paquete no elimina ni reordena columnas existentes, añade `category_definition` al final y NO añade columnas de métricas.

### 8. Migración y registro

`schema/migrations/013_category_definition_color.sql` sigue el patrón de las migraciones existentes: `BEGIN`, guarda de que `012_global_normalized_username` esté aplicada, `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, backfill determinista, `CHECK` e inserción en `labeler_migration` con `ON CONFLICT DO NOTHING`.

- La migración la ejecuta ÚNICAMENTE el runner (`util/study-schema.js`), que toma un advisory lock y salta las migraciones ya registradas en `labeler_migration`. Reejecutar el SQL crudo NO es seguro: el backfill es incondicional y recolorearía categorías ya asignadas, y el `CHECK` incondicional podría fallar. Por eso no se ofrece ni se documenta una ruta de repetición manual.
- `ADD COLUMN IF NOT EXISTS "color_slot" SMALLINT NOT NULL DEFAULT 0` ya rellena las filas existentes con `0` (PostgreSQL 17.6); no se añade un `SET NOT NULL` separado. Si la columna preexistiera con una definición distinta de la esperada, la guarda falla de forma cerrada (no se degrada ni se ignora).
- El `CHECK (color_slot >= 0 AND color_slot < 12)` se añade con el patrón de catálogo usado en la migración `010`: un bloque `DO $$` que consulta `pg_constraint` por `conname`/`conrelid` y solo entonces ejecuta `ADD CONSTRAINT`. NO se asume que PostgreSQL soporte `ADD CONSTRAINT IF NOT EXISTS`.
- Se registra en `managedMigrations` de `util/study-schema.js`; `labeling-study-prepare` la aplica a través de ese runner.
- Sin operaciones destructivas.

## Risks / Trade-offs

- [La definición puede contener datos que el participante considere sensibles] → permanece privada por participante/estudio en la aplicación; solo se exporta al paquete pseudonimizado del operador, igual que el nombre de la categoría.
- [Colisión de colores con más de 12 categorías] → aceptada por contrato; nombre y definición mandan; el color nunca es la única señal.
- [Algún tono inicial puede fallar contraste no textual contra el indicador renderizado] → se mide el contraste real (no solo el swatch sobre blanco) durante la implementación; los tonos pueden ajustarse o sustituirse sin cambiar el contrato de 12 posiciones. La selección nunca depende del color: nombre, borde y check/texto son señales adicionales.
- [Altas concurrentes de categorías] → la asignación de slot ocurre dentro de `withTransaction`, bloqueando la fila de membresía en `study_participant` antes del `INSERT` con conteo; el conteo corre como sentencia posterior sobre el mismo cliente y ve un snapshot fresco tras la espera.
- [CSP con `style-src-attr 'none'`] → no se usan atributos `style` inline; el color se aplica con clases `category-slot-N` de la hoja externa y no se debilita la CSP.
- [La vista previa de 3 registros puede quedarse corta] → el tamaño vive en `data-page-size` y puede ajustarse sin cambiar specs; el badge de conteo y el enlace a GitHub evitan la falsa sensación de completitud.
- [Consumidores de `categories.csv` que asuman columnas fijas] → columna añadida al final; los encabezados existentes no cambian de orden.
- [Tests de contrato existentes de la tarjeta, categorías, migraciones y ledgers] → se actualizan en las tareas (`card-v2.test.js`, `provider-fixture-card-view.test.js`, `study-category-runtime.test.js`, `category-rename-http.test.js`, `study-export.test.js`, `verification-contracts.test.js`, `study-schema-multi-study.test.js`, `study-bootstrap.test.js`) y se añade la prueba de la migración `013`.

## Migration Plan

1. Añadir la migración `013` y registrarla; aplicarla solo con el runner existente (`npm run migrate:study` o `labeling-study-prepare`). No reaplicar el SQL crudo.
2. Verificar con una segunda invocación del runner que slots, definiciones, IDs, timestamps y referencias de clasificación se preservan.
3. Desplegar servicio, vistas y JavaScript: las columnas nuevas son ignoradas por versiones anteriores (aditivas).
4. Rollback: detener el despliegue de la vista; las columnas y definiciones permanecen (sin pérdida); el snapshot y las decisiones no se tocan.

## Open Questions

Ninguna que cambie las specs, el enfoque o las tareas. El tamaño del lote de vista previa (3) es ajustable en implementación; los hex iniciales de la paleta pueden sustituirse por medición de contraste real, sin cambiar el contrato de 12 posiciones ni el mecanismo de clases CSP.
