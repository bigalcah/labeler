## Why

Retroalimentación post-despliegue: al clasificar, la categoría seleccionada queda enterrada en la lista alfabética, lo que obliga a buscarla cada vez y dificulta confirmar de un vistazo la clasificación actual. Debe estar siempre primero y separada del resto.

## What Changes

- Mostrar la categoría seleccionada en la primera posición de la lista de selección, con el resto conservando su orden estable.
- Separarla visualmente del resto con espaciado y una divisoria visible, sin depender del color.
- Reordenar al seleccionar con puntero y al crear una categoría (que queda seleccionada); la navegación por teclado permanece estable durante el recorrido con flechas y consolida el orden al salir el foco.
- Sin cambios de datos, API, migraciones ni exportación.

## Capabilities

### New Capabilities

Ninguna.

### Modified Capabilities

- `private-open-card-sorting`: orden y separación de la categoría seleccionada en la lista de selección.

## Impact

- Vistas: `views/review.ejs`.
- Cliente: `public/js/review.js`, `public/css/main.css`.
- Pruebas: `test/review-category-ux.browser.test.js` y suites de categorías que renderizan la vista.
- No cambia: `util/study-*.js`, `routes/**`, `schema/**`, exportación, progreso ni contratos HTTP.
