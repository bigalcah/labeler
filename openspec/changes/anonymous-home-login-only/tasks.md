# Tareas

## 1. Contrato HTTP failing-first

- [x] 1.1 `test/login-logout-http.test.js`: ampliar la prueba anónima de `GET /` para exigir HTTP 200, las tres frases exactas de bienvenida, un único enlace `Login` a `/login` y la ausencia en el HTML de `header`, `/queue`, `/progress`, `/logout`, identidad de participante y tarjetas privadas.
- [x] 1.2 `test/login-logout-http.test.js`: añadir una prueba de `GET /` con sesión válida que compruebe la identidad derivada de servidor, el header, los enlaces privados, las tarjetas existentes y logout, además de la ausencia de Login y de cualquier identidad suministrada por el cliente.
- [x] 1.3 `test/login-logout-http.test.js`: conservar o añadir las aserciones anónimas de `GET /queue` y `GET /progress` con respuesta HTTP 401 y sin contenido privado.
- [x] 1.4 `test/login-logout-http.test.js`: ejecutar las pruebas HTTP enfocadas contra la plantilla actual y confirmar que las nuevas aserciones fallan antes de modificar `views/index.ejs`.

## 2. Regresión de navegador failing-first

- [x] 2.1 `test/home-login.browser.test.js`: preparar el caso de navegador con Chromium real y fixtures para estados anónimo y autenticado, reutilizando el harness existente sin cambiar la aplicación.
- [x] 2.2 `test/home-login.browser.test.js`: cubrir el estado anónimo en 375, 768 y 1280 píxeles, verificando la bienvenida y Login visibles, la ausencia de header y enlaces privados en el DOM, y `scrollWidth <= clientWidth`.
- [x] 2.3 `test/home-login.browser.test.js`: cubrir el estado autenticado en 375, 768 y 1280 píxeles, verificando header, identidad, navegación y tarjetas privadas, la ausencia de Login y `scrollWidth <= clientWidth`.
- [x] 2.4 `test/home-login.browser.test.js`: ejecutar la regresión de navegador contra la plantilla actual y confirmar que falla antes de modificar `views/index.ejs`.

## 3. Implementación mínima de Home

- [x] 3.1 `views/index.ejs`: incluir `partials/header.ejs` una sola vez dentro de `if (participant)` y dejar un único `main` con dos ramas mutuamente exclusivas para los estados autenticado y anónimo.
- [x] 3.2 `views/index.ejs`: implementar la rama anónima con `section[aria-labelledby="welcome-title"]`, `h1#welcome-title`, las tres frases requeridas y un único enlace `href="/login"` con clases `btn btn-dark`, sin emitir navegación ni acciones privadas.
- [x] 3.3 `views/index.ejs`: conservar en la rama autenticada el logotipo, las tarjetas `PR cards`, `Pending cards` y `Progress`, la navegación, la identidad y logout existentes, sin mostrar Login.

## 4. Verificación de entrega

- [x] 4.1 Ejecutar las pruebas enfocadas HTTP y de navegador, y confirmar los estados anónimo y autenticado, las aserciones de ausencia en el DOM, las tres anchuras y la protección HTTP de `/queue` y `/progress`.
- [x] 4.2 Ejecutar `npm run lint:js` y corregir únicamente los problemas causados por este cambio.
- [x] 4.3 Ejecutar `openspec validate "anonymous-home-login-only" --strict` y confirmar que la validación estricta termina correctamente.
- [x] 4.4 Realizar QA manual en Chromium sobre Home anónima y autenticada a 375, 768 y 1280 píxeles, activar Login desde el estado anónimo, comprobar que no hay desbordamiento horizontal y verificar que no aparecen controles privados para una persona anónima.

## 5. Corrección normativa de copy y wrapping

Las tareas completadas de las secciones anteriores se conservan como historial de la implementación previa. La corrección siguiente sigue abierta porque la revisión visual independiente detectó que falta la explicación de categorías y privacidad en `views/index.ejs`, además de una viuda de una palabra en 375px. `spec.md:9` es normativo y prevalece sobre cualquier texto exacto obsoleto de estos registros históricos.

- [x] 5.1 `proposal.md`, `design.md` y `tasks.md`: reconciliar los artefactos con el párrafo canónico `Labeling is a research study for classifying pull requests into categories created by each participant. Your work is private to you. Log in to begin reviewing PR cards and track your progress.` y dejar explícito que `spec.md:9` tiene precedencia normativa.
- [x] 5.2 `test/login-logout-http.test.js` y `test/home-login.browser.test.js`: añadir o reabrir primero las aserciones failing-first para exigir el párrafo canónico, su contenido de categorías y privacidad, y la ausencia de la viuda en 375px; ejecutarlas contra la implementación actual y confirmar el fallo antes de tocar la vista.
- [x] 5.3 `views/index.ejs`: sustituir el copy anónimo obsoleto por un único párrafo canónico y envolver exactamente `track your progress.` con Bootstrap `text-nowrap` para evitar la viuda a 375px, sin CSS propio ni cambios de rutas, sesión, dependencias o alcance.
- [x] 5.4 Ejecutar los gates finales de la corrección: pruebas HTTP y de navegador enfocadas, comprobación de 375, 768 y 1280 píxeles, `npm run lint:js` y `openspec validate "anonymous-home-login-only" --strict`; no marcar esta corrección como completa mientras falte cualquier gate.
- [x] 5.5 Realizar QA visual independiente después de aplicar la corrección, comprobando en Chromium que el párrafo explica categorías y privacidad, que `track your progress.` no queda viudo a 375px, que no hay desbordamiento horizontal y que Home autenticada conserva su experiencia previa.
