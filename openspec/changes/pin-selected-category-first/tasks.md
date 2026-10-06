## 1. Preparación

- [x] 1.1 Confirmar que el trabajo parte de `develop` en una rama `feature/pin-selected-category-first`, sin cambios ajenos mezclados, y que existe la autorización del propietario para este ciclo (implementar y desplegar tras verificación y CI/CD).

## 2. Orden y separación de la categoría seleccionada

- [x] 2.1 `views/review.ejs`: computar `orderedCategories` con la categoría seleccionada (`card.category_id`) primera y el resto en su orden actual; renderizar esa lista sin cambiar radios, CSRF ni `expected_revision`.
- [x] 2.2 `public/js/review.js`: agregar `moveSelectedToTop(list)` y llamarla al seleccionar con puntero (marcado vía `pointerdown` + `change`) y al salir el foco de la lista (`focusout`), sin reordenar durante la navegación por teclado; insertar la categoría nueva seleccionada con `prepend`.
- [x] 2.3 `public/css/main.css`: `position: relative` en `.category-option`, margen inferior extra y divisoria `::after` para la fila seleccionada; sin estilos inline y sin depender del color.
- [x] 2.4 Actualizar `test/review-category-ux.browser.test.js`: orden inicial (seleccionada primera), separación (margen/divisoria), reordenamiento tras clic, estabilidad con teclado y consolidación al salir el foco, alta al primer puesto, sin estilos inline.
- [x] 2.5 Verificar que las suites que renderizan la vista (`test/category-rename-http.test.js`, `test/category-palette-css-consistency.test.js`) siguen verdes.

## 3. Verificación

- [x] 3.1 Ejecutar `npm run lint:js` y las pruebas dirigidas con `node --test` hasta que pasen.
- [x] 3.2 Ejecutar `npm run quality` y `npm run docs:study-check` completos.
- [x] 3.3 Verificar en navegador una sesión de participante: seleccionada primera y separada al abrir una tarjeta clasificada, reordenamiento con clic, alta al primer puesto y 375/768/1280 px.

## 4. Release

- [ ] 4.1 Commit con Conventional Commits en español y push; PR a `develop` con checks y merge autorizado.
- [ ] 4.2 Diff congelado literal vacío antes del merge a `master`; PR de release.
- [ ] 4.3 Vigilar `quality → build → publish → deploy` y reportar tag `sha-<commit>`, release ID, digest, URL, hora UTC y smoke.
