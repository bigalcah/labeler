## Why

La revisión post-despliegue del estudio detectó dos problemas de uso:

- En la selección de categorías, el punto de color aislado no comunica con suficiente fuerza a qué categoría pertenece cada fila; se pidió que toda la barra de la categoría lleve su color, de contorno o de relleno.
- En la tarjeta, la sección `Reviews` muestra el badge `Available · N` incluso cuando ninguna revisión capturada tiene explicación escrita, y al desplegarla no aparece contenido porque el filtro vigente oculta esos eventos. En el estudio real solo 1.356 de 8.995 eventos de review tienen cuerpo, por lo que el caso es frecuente y confunde.

## What Changes

- Sustituir el punto de color por una barra de color estable aplicada a toda la fila de categoría (borde y relleno tenue) en la selección, la gestión y el resumen de progreso, conservando las señales no cromáticas (`check` + `Selected`, nombre y definición legibles).
- Mostrar un estado explícito dentro de las secciones de evidencia GitHub que capturaron registros pero quedan sin elementos desplegables tras el filtro de presentación (caso `Reviews` sin explicación escrita), indicando cuántos eventos se capturaron y que no hay explicaciones escritas; el enlace a GitHub permanece.
- Sin cambios de contrato de datos: migraciones, API, exportación, captura y snapshots quedan intactos.
- Sin cambios incompatibles: la presentación cambia, los datos y clasificaciones existentes no.

## Capabilities

### New Capabilities

Ninguna.

### Modified Capabilities

- `private-open-card-sorting`: el color de la categoría se presenta como barra de la fila o tarjeta (borde y relleno tenue) en todas las superficies del participante.
- `github-pr-explorer`: estado explícito de las secciones capturadas sin contenido desplegable (revisiones sin explicación escrita).

## Impact

- Vistas: `views/review.ejs`, `views/progress.ejs`, `views/partials/instance/data.ejs`.
- Cliente: `public/js/review.js`, `public/css/main.css`.
- Pruebas: `test/review-category-ux.browser.test.js`, `test/progress-render.test.js`, `test/progress.browser.test.js`, `test/card-v2.test.js`, `test/provider-fixture-card-view.test.js`, `test/pr-card-disclosure.browser.test.js` y `test/category-palette-css-consistency.test.js`.
- No cambia: `schema/migrations/**`, `util/study-*.js`, `routes/**`, exportación, captura GitHub y contratos de snapshot.
