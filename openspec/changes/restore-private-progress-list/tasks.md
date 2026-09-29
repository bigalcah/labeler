## 1. Lectura privada y paginación

- [x] 1.1 Extender `util/study-read-repository.js` y su prueba de repositorio para leer `study_card` por `study_id` y `participant_id` derivados de sesión, ordenar por `study_card.ordinal`, enlazar parámetros y devolver filas, total y metadata suficientes para la página, además de una lectura agrupada completa independiente para todas las categorías y sus tarjetas `CLASSIFIED`.
- [x] 1.2 Cubrir en la prueba de repositorio los defaults `page=1` y `limit=20`, el máximo `limit=100`, el offset de página, el orden estable, los estados `PENDING`, `CLASSIFIED` y `DISCARDED`, la página fuera de rango vacía y el aislamiento Alice/Bob sin mutaciones; para el resumen, verificar conteos sobre toda la membresía, categorías sin uso con cero, grupos únicos en orden de ordinal e independencia respecto a `page` y `limit`.

## 2. Servicio y ruta autenticada

- [x] 2.1 Extender `util/study-service.js` y `routes/progress/index.js` para normalizar únicamente `page` y `limit`, cargar la página y el resumen agrupado completo como lecturas independientes desde el contexto de sesión y preservar el resumen privado y la protección de sesión existente.
- [x] 2.2 Extender `test/study-routes-http.test.js` y `test/login-logout-http.test.js` para verificar metadata y defaults, límite, enlaces normalizados, página vacía con `200`, acceso sin sesión y parámetros hostiles `study`, `study_id`, `participant`, `participant_id` y `reviewer_id` ignorados o rechazados sin cambiar la identidad; verificar que conteos, categorías de cero uso y grupos no cambien entre páginas ni desaparezcan en una página fuera de rango.

## 3. Lista y navegación accesible

- [x] 3.1 Extender `views/progress.ejs` para renderizar todas las filas de la página con ordinal, título, estado privado, categoría o motivo propio cuando corresponda, y el resumen independiente de todas las categorías privadas con conteo y PRs agrupados (incluidas las de cero uso), enlaces `/queue/:id`, controles previos y siguientes, página activa y estado vacío accesible de la lista paginada.
- [x] 3.2 Añadir `test/progress.browser.test.js` y cobertura de renderizado para comprobar el listado, el paginador y el estado fuera de rango, los conteos completos incluidos ceros, la agrupación única y estable por ordinal independiente de la página, los enlaces canónicos, la ausencia de selectores y `/instances`, la navegación de una tarjeta y la ausencia de datos de otro participante.

## 4. Home anónima

- [x] 4.1 Extender `test/home-login.browser.test.js` para guardar antes de editar la vista las cajas autenticadas de `header`, la primera fila de marca y la rejilla de tarjetas, y para comprobar el centro anónimo dentro de `2 CSS px` y la ausencia de overflow en `375x800`, `768x800` y `1280x800`.
- [x] 4.2 Modificar solo la rama anónima de `views/index.ejs` con utilidades Bootstrap existentes, sin CSS, JavaScript, posiciones absolutas ni cambios en el marcado o geometría autenticados; comparar las cajas autenticadas antes y después con tolerancia de `0px`.

## 5. Verificación del contrato

- [x] 5.1 Ejecutar las regresiones HTTP y de navegador, `npm run lint:js`, los diagnósticos LSP de cada archivo modificado y QA visual en `375`, `768` y `1280` píxeles, conservando evidencia sanitizada sin cookies, credenciales, dumps ni payloads.
- [x] 5.2 Ejecutar `openspec status --change "restore-private-progress-list" --json` y `openspec validate "restore-private-progress-list" --strict`, comprobar que todos los artifacts están presentes y confirmar que ningún archivo de producto, esquema, dependencia, configuración o CSS fue modificado fuera del alcance aprobado.

## 6. Límites explícitos

- [x] 6.1 Mantener ausentes `/instances`, `/instances/:id`, selectores de participante o estudio, resúmenes globales, exportación web, llamadas GitHub en runtime, cambios de esquema o dependencia y cualquier identidad autoritativa enviada por el cliente.
