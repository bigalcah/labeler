## Context

Ver `proposal.md`. Estado actual relevante:

- `views/review.ejs` (líneas 84-107) renderiza cada categoría como `<li class="category-option">` con un `<span class="category-color-dot category-slot-N" aria-hidden="true">` decorativo; `views/progress.ejs` (líneas 166-172) usa el mismo punto en cada tarjeta de resumen.
- `public/js/review.js` construye y actualiza filas con `buildCategoryOption`/`updateCategoryOption` operando sobre `.category-color-dot`; `public/css/main.css` define `.category-color-dot` y `.category-slot-N { --category-color: <hex>; }` (sin estilos inline por CSP `style-src-attr 'none'`).
- `views/partials/instance/data.ejs` (línea 53) filtra las revisiones a aquellas con cuerpo no vacío; si el resultado es vacío, no renderiza `.pr-event-list` y la sección queda desplegable pero sin contenido, mientras el badge mantiene `Available · N` (conteo capturado). Datos reales del estudio: 1.356 de 8.995 eventos de review tienen cuerpo.
- `public/js/pr-card.js` solo actúa sobre secciones con `[data-local-item]`; sin elementos no añade control.

Restricciones: CSP sin estilos inline; paleta y clases `category-slot-N` ya validadas (≥3:1 contra blanco); selección nunca dependiente solo del color; sin cambios de datos ni contratos.

## Goals / Non-Goals

**Goals:**

- Que la fila completa de la categoría (selección, gestión y progreso) lleve su color estable en borde y relleno tenue, reemplazando el punto aislado.
- Que una sección capturada sin elementos desplegables muestre al abrirse un estado explícito con el conteo capturado, evitando la sensación de contenido roto.
- Mantener intactos datos, migraciones, API, exportación y snapshots.

**Non-Goals:**

- No cambiar la paleta ni la asignación de slots.
- No volver a mostrar revisiones sin explicación como entradas.
- No añadir estilos inline ni debilitar la CSP.

## Decisions

### 1. Barra de color en la fila de categoría

- La clase `category-slot-N` se aplica al contenedor de la fila o tarjeta (`li.category-option`, `.pr-progress-card`) en lugar de a un `<span>` decorativo.
- CSS en `public/css/main.css`:
    - `.category-option { border: 1px solid color-mix(in srgb, var(--category-color) 55%, #fff); border-left: 5px solid var(--category-color); background: color-mix(in srgb, var(--category-color) 7%, #fff); }`.
    - `.pr-progress-card { border-left: 5px solid var(--category-color); background: color-mix(in srgb, var(--category-color) 6%, #fff); }`.
    - La fila seleccionada conserva el borde de color y añade el anillo neutro, el check y el texto `Selected` (señales no cromáticas intactas).
- Se elimina `.category-color-dot` del CSS, de las vistas y de `review.js`.
- `color-mix` es soportado por los navegadores objetivo; el borde de color mantiene el contraste ≥3:1 ya validado de la paleta y el texto oscuro permanece sobre un fondo claro.

### 2. Estado de sección capturada sin contenido desplegable

- En `views/partials/instance/data.ejs`, cuando `section.availability === "PRESENT"` y la lista filtrada queda vacía, se renderiza un estado explícito dentro de la sección:
    - Reviews: `No written review explanations.` + `The local snapshot captured N review events without written text.`
    - Fallback para otras secciones: `No displayable records in this snapshot.`
- El badge del summary conserva `Available · N` (conteo capturado) y el enlace a GitHub permanece.
- `public/js/pr-card.js` no cambia: sin elementos no hay lotes; el estado queda visible al desplegar.

### 3. Verificación y despliegue

- Pruebas dirigidas de vistas/categorías/progreso/tarjeta y `npm run quality`; verificación de contraste y de que no hay estilos inline.
- Release con el flujo existente: rama `feature/` desde `develop`, PR a `develop`, diff congelado, PR a `master`, pipeline `quality → build → publish → deploy`. Sin migraciones nuevas.

## Risks / Trade-offs

- [Texto sobre relleno tenue con algún tono] → el relleno es bajo (6-7 %) y se verifica contraste de texto; si falla, se reduce el porcentaje sin cambiar el contrato.
- [Consumidores que esperaban un punto de color] → es un cambio de presentación interna; no hay contrato de datos.
- [La sección de reviews sigue mostrando `Available · N`] → el estado interno explica la ausencia de texto; el badge conserva el conteo capturado por trazabilidad.

## Migration Plan

1. Implementar vistas, JS y CSS; actualizar pruebas.
2. Ejecutar la puerta de calidad completa y verificación en navegador.
3. Desplegar con el release automático; sin pasos de datos.

## Open Questions

Ninguna.
