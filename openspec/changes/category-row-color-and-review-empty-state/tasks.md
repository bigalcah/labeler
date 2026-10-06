## 1. Preparación

- [x] 1.1 Confirmar que el trabajo parte de `develop` en una rama `feature/category-row-color-and-review-empty-state`, sin cambios de otras funcionalidades mezclados, y que existe la autorización explícita del propietario para este ciclo (implementar y desplegar tras la verificación y el pipeline CI/CD).

## 2. Barra de color de la categoría

- [x] 2.1 `views/review.ejs`: aplicar `category-slot-N` al `<li class="category-option">` y eliminar el `<span class="category-color-dot">`; conservar radio, nombre, definición, check, `Selected` y el botón de edición fuera de la etiqueta.
- [x] 2.2 `views/progress.ejs`: aplicar `category-slot-N` a la tarjeta de resumen (`.pr-progress-card`) y eliminar el punto de color.
- [x] 2.3 `public/js/review.js`: en `buildCategoryOption`/`updateCategoryOption`, asignar la clase de slot a la fila y dejar de crear o actualizar el punto; conservar el resto del comportamiento (selección, concurrencia, errores, `textContent`).
- [x] 2.4 `public/css/main.css`: borde y relleno tenue con `var(--category-color)` en `.category-option` y `.pr-progress-card`; estado seleccionado con anillo neutro, check y `Selected`; eliminar `.category-color-dot`. Sin estilos inline.
- [x] 2.5 Actualizar pruebas: `test/review-category-ux.browser.test.js` (barra por slot en la fila, ausencia de punto, estado seleccionado), `test/progress-render.test.js` y `test/progress.browser.test.js` (barra en el resumen), y verificar que `test/category-palette-css-consistency.test.js` sigue cubriendo las 12 clases.
- [x] 2.6 Medir contraste del borde y del texto sobre el relleno en navegador (≥3:1 del indicador, texto legible) y confirmar que no hay atributos `style` inline.

## 3. Estado de sección capturada sin contenido desplegable

- [x] 3.1 `views/partials/instance/data.ejs`: cuando una sección visible tenga `availability === "PRESENT"` y cero elementos tras el filtro, renderizar el estado explícito (Reviews: sin explicaciones escritas + conteo capturado; fallback genérico para otras secciones); conservar badge y enlace a GitHub.
- [x] 3.2 Actualizar `test/card-v2.test.js` y `test/provider-fixture-card-view.test.js` para el caso de revisiones todas sin cuerpo (estado visible, sin entradas inventadas, badge capturado) y `test/pr-card-disclosure.browser.test.js` para una sección capturada con 0 elementos elegibles (el estado aparece al desplegar; no hay botón de lotes).

## 4. Verificación

- [x] 4.1 Ejecutar `npm run lint:js` y las pruebas dirigidas con `node --test` hasta que pasen.
- [x] 4.2 Ejecutar `npm run quality` y `npm run docs:study-check` completos.
- [x] 4.3 Verificar en navegador (sesión de participante) la barra de color en selección, gestión y progreso, el estado de Reviews sin explicaciones y 375/768/1280 px.

## 5. Release

- [ ] 5.1 Commit con Conventional Commits en español y push de la rama; PR a `develop` con checks y merge autorizado.
- [ ] 5.2 Ejecutar literalmente el diff congelado `git diff --name-only origin/master...develop -- .github/workflows deployment/docker-compose.release.yml` y exigir salida vacía; PR de release a `master`.
- [ ] 5.3 Vigilar `quality → build → publish → deploy` y reportar al propietario tag `sha-<commit>`, release ID, digest, URL del workflow, hora UTC y smoke.
