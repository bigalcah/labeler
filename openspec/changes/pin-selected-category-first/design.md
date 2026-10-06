## Context

Ver `proposal.md`. Estado actual:

- `views/review.ejs` (~82-112) renderiza `categories.forEach(...)` en el orden que devuelve el servicio (repositorio ordena por `raw_name`), y marca `is-selected`/`checked` con `card.category_id`.
- `public/js/review.js` refresca el estado de selección en `change` (línea ~207), agrega la categoría nueva al final (`list.append(item)`, ~141) y no reordena.
- `public/css/main.css` define `.category-selection-list { display: grid; gap: .5rem; }` y `.category-option` con barra de color, ring de selección, check y `Selected`.

Restricciones: CSP sin estilos inline; navegación nativa de radios por flechas; sin cambios de datos ni contratos.

## Goals / Non-Goals

**Goals:**

- La categoría seleccionada siempre primero y separada del resto (espaciado + divisoria), de forma reconocible sin color.
- Reordenar en selección con puntero y al crear; navegación por teclado estable.
- Mantener intactos datos, API, exportación y progreso.

**Non-Goals:**

- No cambiar el orden base (alfabético) del resto ni el orden del repositorio/servicio.
- No reordenar dinámicamente durante el recorrido con flechas.
- No añadir estilos inline ni dependencias.

## Decisions

### 1. Orden inicial en la vista

En `views/review.ejs`, construir `orderedCategories` antes del `forEach`: si `card.category_id` coincide con una categoría, esa va primera; el resto conserva el orden devuelto (sort estable por índice). Sin selección, el orden no cambia.

### 2. Reordenamiento en el cliente

En `public/js/review.js`:

- `moveSelectedToTop(list)`: mueve la fila `.category-option.is-selected` al inicio de la lista, conservando el orden relativo de las demás.
- Selección con puntero: un `pointerdown` en la lista marca el origen; en `change`, además de `refreshSelectedState`, se llama `moveSelectedToTop`.
- Teclado: `change` originado por teclado no reordena durante la navegación; en `focusout` de la lista (cuando `document.activeElement` queda fuera) se consolida el orden con `moveSelectedToTop`, preservando la navegación nativa por flechas.
- Creación: la categoría nueva queda seleccionada y se inserta al inicio (`list.prepend`) en lugar del `append` actual.

### 3. Separación visual

En `public/css/main.css`: `.category-option { position: relative; }` y `.category-option.is-selected { margin-bottom: .85rem; }` con una divisoria `::after` (borde inferior neutro) para separar del resto, además del ring/check/`Selected` existentes. La separación no depende del color.

### 4. Verificación

- Pruebas de navegador en `test/review-category-ux.browser.test.js`: orden inicial con la seleccionada primero, separación (margen/divisoria), reordenamiento tras clic, estabilidad durante teclado y consolidación al salir el foco, alta al primer puesto, sin estilos inline.
- Suites de categorías que renderizan la vista siguen verdes; `npm run quality` completo.

## Risks / Trade-offs

- [Reordenar con teclado rompería la navegación por flechas] → se reordena con puntero y al salir el foco, nunca durante el recorrido.
- [El salto del elemento tras el clic puede desorientar] → solo ocurre con puntero y con la fila seleccionada ya visible; la posición se conserva al recargar.
- [Márgenes/divisoria en listas largas] → la separación es única (una sola fila seleccionada).

## Migration Plan

1. Implementar vista, JS y CSS; actualizar pruebas.
2. Puerta de calidad y verificación en navegador.
3. Release con el flujo existente; sin pasos de datos.

## Open Questions

Ninguna.
