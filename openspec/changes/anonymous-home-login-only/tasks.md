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
- [x] 3.2 `views/index.ejs`: implementar la rama anónima con `section[aria-labelledby="welcome-title"]`, `h1#welcome-title`, el párrafo histórico `Labeling is a research study for classifying pull requests into categories created by each participant. Your work is private to you. Log in to begin reviewing PR cards and track your progress.` y un único enlace `href="/login"` con clases `btn btn-dark`, sin emitir navegación ni acciones privadas.
- [x] 3.3 `views/index.ejs`: conservar en la rama autenticada el logotipo, las tarjetas `PR cards`, `Pending cards` y `Progress`, la navegación, la identidad y logout existentes, sin mostrar Login.

## 4. Verificación de entrega

- [x] 4.1 Ejecutar las pruebas enfocadas HTTP y de navegador, y confirmar los estados anónimo y autenticado, las aserciones de ausencia en el DOM, las tres anchuras y la protección HTTP de `/queue` y `/progress`.
- [x] 4.2 Ejecutar `npm run lint:js` y corregir únicamente los problemas causados por este cambio.
- [x] 4.3 Ejecutar `openspec validate "anonymous-home-login-only" --strict` y confirmar que la validación estricta termina correctamente.
- [x] 4.4 Realizar QA manual en Chromium sobre Home anónima y autenticada a 375, 768 y 1280 píxeles, activar Login desde el estado anónimo, comprobar que no hay desbordamiento horizontal y verificar que no aparecen controles privados para una persona anónima.

## 5. Corrección normativa de copy y wrapping, historial

Las tareas completadas de esta sección documentan el trabajo ya implementado para el párrafo histórico anterior. No afirman por sí mismas que el nuevo copy sobre agentes de IA esté implementado ni probado; esa corrección se documenta en la sección 6. La corrección posterior de la tarjeta duplicada se documenta en la sección 7.

- [x] 5.1 `proposal.md`, `design.md` y `tasks.md`: documentar la implementación previa con el párrafo histórico `Labeling is a research study for classifying pull requests into categories created by each participant. Your work is private to you. Log in to begin reviewing PR cards and track your progress.`.
- [x] 5.2 `test/login-logout-http.test.js` y `test/home-login.browser.test.js`: añadir o reabrir primero las aserciones failing-first para exigir el párrafo histórico, su privacidad del trabajo, la ausencia de la viuda en 375px y la separación entre estados anónimo y autenticado; ejecutarlas contra la implementación histórica y confirmar el fallo antes de tocar la vista.
- [x] 5.3 `views/index.ejs`: implementar el párrafo histórico y envolver exactamente `track your progress.` con `<span class="text-nowrap">track your progress.</span>` para evitar la viuda a 375px, sin CSS propio ni cambios de rutas, sesión, dependencias o alcance.
- [x] 5.4 Ejecutar los gates finales de la implementación histórica: pruebas HTTP y de navegador enfocadas, comprobación de 375, 768 y 1280 píxeles, `npm run lint:js` y `openspec validate "anonymous-home-login-only" --strict`.
- [x] 5.5 Realizar QA visual independiente de la implementación histórica, comprobando en Chromium el párrafo de categorías creadas por cada participante y privacidad, que `track your progress.` no queda viudo a 375px, que no hay desbordamiento horizontal y que Home autenticada conserva su experiencia previa.

## 6. Implementación y verificación de la corrección aprobada

- [x] 6.1 `test/login-logout-http.test.js`: añadir primero las aserciones failing-first para exigir el párrafo canónico exacto, exactamente una acción Login a `/login`, la ausencia de header y marcado privado en Home anónima, la conservación de Home autenticada y el estado HTTP 401 de `/queue` y `/progress`; ejecutar y registrar el fallo antes de editar la vista.
- [x] 6.2 `test/home-login.browser.test.js`: añadir primero las aserciones failing-first con Chromium real para los estados anónimo y autenticado a 375, 768 y 1280 píxeles, incluido el texto canónico, la ausencia de header y marcado privado anónimo, la conservación de Home autenticada, el span `text-nowrap` exacto y la ausencia de desbordamiento horizontal; ejecutar y registrar el fallo antes de editar la vista.
- [x] 6.3 `views/index.ejs`: aplicar el cambio mínimo en la rama anónima para mostrar el párrafo canónico, envolver exactamente `track your progress.` con `<span class="text-nowrap">track your progress.</span>` y conservar un único Login, sin modificar la rama autenticada, rutas, sesión, CSS ni dependencias.
- [x] 6.4 Ejecutar de nuevo las pruebas HTTP y de navegador enfocadas, junto con `npm run lint:js`, y confirmar que pasan los estados anónimo y autenticado, el wrapping exacto, las tres anchuras y la protección de las rutas privadas.
- [x] 6.5 Realizar QA responsive manual en Chromium a 375, 768 y 1280 píxeles para Home anónima y autenticada, activar Login desde la visita anónima, comprobar que no hay header ni controles privados anónimos, que el párrafo no crea una viuda y que no existe desbordamiento horizontal.
- [ ] 6.6 Ejecutar la verificación del release con el flujo existente, incluyendo los gates de calidad, la construcción desde el commit revisado, la publicación de imágenes por digest y la inspección del paquete para confirmar trazabilidad y ausencia de cambios fuera de este alcance.
- [ ] 6.7 Tras una promoción autorizada a producción, verificar por HTTPS la Home anónima y autenticada con exactamente dos tarjetas de acción (`PR cards` y `Progress`) y una sola tarjeta hacia `/queue`, el único Login, la ausencia de marcado privado anónimo, el párrafo canónico, el wrapping responsive y el acceso protegido a `/queue` y `/progress`; conservar la evidencia y activar rollback si algún smoke test falla.

## 7. Corrección aprobada: tarjeta única de cola en Home autenticada

Las tareas completadas de las secciones anteriores documentan la implementación previa con tres tarjetas; esta sección registra la corrección. Ejecutarla antes de las tareas 4.1-4.2 de `restore-private-progress-list` para que su baseline de geometría autenticada incluya solo dos tarjetas, y antes de los gates de release 6.6-6.7.

- [x] 7.1 `test/home-login.browser.test.js`: actualizar primero la expectativa autenticada de `privateActionLinks` a `["/queue", "/progress"]`, exigir exactamente una tarjeta en `main` con destino `/queue` y ejecutar la regresión contra la vista actual para registrar el fallo.
- [x] 7.2 `test/login-logout-http.test.js`: sustituir primero la aserción de la tarjeta `Pending cards` por la exigencia de exactamente dos tarjetas de acción (`PR cards` hacia `/queue` y `Progress` hacia `/progress`), sin tarjeta `Pending cards` ni segundo enlace de tarjeta a `/queue`; ejecutar la prueba contra la vista actual y registrar el fallo.
- [x] 7.3 `views/index.ejs`: eliminar únicamente el bloque `col` de `Pending cards` en la rama autenticada; no modificar el header, la rama anónima, rutas, sesión, CSS ni dependencias.
- [x] 7.4 Ejecutar las pruebas HTTP y de navegador enfocadas, `npm run lint:js` y QA visual de Home a 375, 768 y 1280 píxeles; confirmar dos tarjetas centradas, ausencia de desbordamiento horizontal y ningún cambio en la rama anónima.
