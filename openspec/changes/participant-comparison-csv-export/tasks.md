## 1. Aprobación, rama y pruebas RED

- [x] 1.1 Flujo de trabajo: iniciar solo tras aprobación explícita mediante
  `/opsx-apply participant-comparison-csv-export`; no modificar código antes.
- [x] 1.2 Rama de trabajo: basar la rama feature en `develop`, usando Git Flow si está
  disponible; detener implementación si la rama actual es `master`.
- [x] 1.3 `test/study-export.test.js`: añadir primero pruebas RED del gate con cobertura
  exacta de tarjetas canónicas, una decisión terminal por tarjeta y dos personas distintas
  completas en el mismo estudio.
- [x] 1.4 `test/study-export.test.js`: probar las cuatro combinaciones 30x2, 30x3, 300x2 y
  300x3; esperar respectivamente 30 o 300 filas y 8 u 11 columnas.
- [x] 1.5 `test/study-export.test.js`: cubrir solicitante incompleto aunque otras dos
  terminen, solo una persona completa, otra participante de estudio y completitud aparente
  por porcentaje redondeado a 100 %.
- [x] 1.6 `test/study-export.test.js`: cubrir ordinal intermedio omitido, identidad y estudio
  falsificados, categoría inválida, textos nulos, descartes y tarjetas excluidas de la
  muestra; esperar fallo o salida exacta sin ampliar ámbito.
- [x] 1.7 `test/study-export-http.test.js`: crear pruebas RED HTTP con sesiones y tokens CSRF
  sintéticos en proceso; comprobar estados 401, 403, 409 y 500, cabeceras de privacidad,
  ausencia de CSV/adjunto en errores y rechazo de HTML como descarga.
- [x] 1.8 `test/study-export.browser.test.js`: crear prueba RED de navegador antes de
  implementar la interfaz; esperar cobertura de estados, accesibilidad, actualización,
  descarga válida y tratamiento de errores sin convertir HTML en CSV.
- [x] 1.9 `test/runtime-interface-boundary.test.js`: sustituir solo las expectativas de la
  ruta `/export`; conservar `/export/review` 404 y las demás comprobaciones de límites y
  protecciones.
- [x] 1.10 `test/multi-study-hostile-e2e.integration.js`: añadir prueba de carrera en
  runtime aislado; incluir a quien completa antes del snapshot y omitir hasta la siguiente
  descarga a quien completa después.
- [x] 1.11 `scripts/test-study-deployment.sh` y
  `test/deployment-harness-contract.test.js`: sustituir solo las aserciones de secreto,
  manifiesto y archivos del exportador antiguo; mantener evidencia y controles ajenos.
- [x] 1.12 `scripts/check-study-documentation.js` y
  `test/study-documentation-check.test.js`: actualizar el contrato estructurado y sus
  casos sin exigir el comando offline retirado.
- [x] 1.13 `test/study-export.test.js`: añadir pruebas RED de comas, comillas, Unicode,
  campos multilínea, CRLF y fórmulas, incluidos espacios iniciales y apóstrofos;
  esperar escape correcto y protección solo de salida, sin fusionar categorías similares.

## 2. Lectura consistente y serialización CSV

- [x] 2.1 `util/study-export-repository.js` o equivalente: implementar lectura de solo
  lectura en una conexión e instantánea `REPEATABLE READ` para muestra, membresía, gate y
  decisiones.
- [x] 2.2 `util/study-export-repository.js` o equivalente: exigir una decisión terminal
  por cada una de las 30 o 300 tarjetas canónicas persistidas y cero pendientes; no usar
  porcentajes.
- [x] 2.3 `util/study-export-repository.js` o equivalente: exigir al solicitante completo y
  otra persona distinta completa del mismo estudio; esperar que otras identidades o
  estudios no satisfagan el mínimo.
- [x] 2.4 `util/study-export-repository.js` o equivalente: fijar participantes completos
  desde la instantánea y en orden ordinal persistido; conservar huecos e ignorar ámbitos de
  identidad enviados por el cliente.
- [x] 2.5 `util/study-export-repository.js` o equivalente: obtener `pr_id` de
  `source_card_id` y URL efectiva persistida o URL CSV de origen; no llamar a la red.
- [x] 2.6 `util/study-export.js`: sustituir el paquete anterior por serialización completa
  en memoria, con cabeceras comunes y bloques exactos `usuario_N` de tres columnas.
- [x] 2.7 `util/study-export.js`: separar categoría, definición y observación de
  `CLASSIFIED`; mapear `DISCARDED` a `DESCARTADO` y dos celdas vacías. Mantener fila por
  tarjeta canónica aunque todas se descarten.
- [x] 2.8 `util/study-export.js`: aplicar protección de fórmulas solo a la salida y codificar
  UTF-8 RFC 4180 con CRLF, comillas escapadas y soporte de comas y saltos de línea.
- [x] 2.9 `util/study-export.js`: rechazar referencias de categoría o datos inválidos antes
  de publicar el búfer; no producir bytes ni adjunto parcial.

## 3. Rutas y estado de interfaz

- [x] 3.1 `routes/export/index.js`: implementar `GET /export` autenticado con estado de la
  sesión y el estudio asociado; responder 401 sin sesión.
- [x] 3.2 `routes/export/download/index.js`: implementar `POST /export/download` con los
  middlewares existentes de origen, CSRF y sesión; validar origen primero.
- [x] 3.3 `routes/export/download/index.js`: volver a comprobar sesión, estudio, gate y
  cobertura. Responder 401 sin sesión, 403 por origen/CSRF o gate, 409 por datos inválidos
  y 500 sanitizado por error interno.
- [x] 3.4 `routes/export/download/index.js`: enviar tras completar el CSV con adjunto UTF-8
  privado, `no-store` y `nosniff`; no filtrar SQL, stack, secretos ni CSV en errores o logs.
- [x] 3.5 `views/index.ejs`, `views/partials/header.ejs` y vista EJS de exportación: añadir
  tarjeta, enlace y página con estilos existentes, sin selectores ni rol administrativo.
- [x] 3.6 Vista EJS de exportación: mostrar incompleto, espera y listo; no revelar nombres,
  conteos ni progreso de pendientes. En listo, mostrar solo cantidad incluida y tamaño.
- [x] 3.7 Vista EJS y `public/js/export.js`: mostrar generación indeterminada con botón
  deshabilitado, `aria-busy` y región viva, sin porcentajes ficticios ni mover el foco.
- [x] 3.8 `public/js/export.js`: enviar POST same-origin con sesión y CSRF; verificar HTTP
  exitoso y `text/csv` antes de Blob, revocar URL y anunciar inicio, no guardado.
- [x] 3.9 `public/js/export.js`: manejar expiración, HTML, errores y reintento; no descargar
  respuestas de login/error y bloquear clics duplicados.

## 4. Retirada y documentación

- [x] 4.1 `package.json` y `scripts/export-study.js`: retirar el comando `export:study` y su
  punto de entrada; no dejar otra vía de exportación de operador.
- [x] 4.2 `util/study-export-input.js` y `util/study-export*.js`: retirar utilidades
  exclusivas del paquete offline/HMAC; conservar lectura compartida necesaria para la nueva
  descarga.
- [x] 4.3 Configuración y documentación operativa: retirar HMAC exclusivo del exportador,
  sin tocar credenciales ni mecanismos de backup.
- [x] 4.4 `README.md`, `SECURITY.md`, `docs/EXPORT-RUNBOOK.md`,
  `docs/STUDY-WORKFLOW.md`, `docs/PARTICIPANT-GUIDE.md` y `docs/OPERATIONS.md`:
  documentar contrato, privacidad, estados y comando retirado.
- [x] 4.5 `docs/ARCHITECTURE.md`, `docs/DEVELOPMENT.md`, `docs/JAVASCRIPT-API.md`,
  `docs/MULTI-STUDY-VALIDATION.md`, `docs/MAINTENANCE.md` y
  `docs/TROUBLESHOOTING.md`: actualizar referencias vigentes y preservar contexto histórico.

## 5. Validación y entrega

- [x] 5.1 Ejecutar `npm run lint:js` y, con `node --test`, `test/study-export.test.js`,
  `test/study-export-http.test.js`, `test/runtime-interface-boundary.test.js`,
  `test/study-documentation-check.test.js`, `test/deployment-harness-contract.test.js`
  y `test/ci-pipeline-freeze.test.js`; esperar lint y pruebas aprobados, incluido el contrato congelado.
- [x] 5.2 Suites automatizadas: ejecutar `npm run test:unit`,
  `npm run test:integration` y `npm run test:e2e` con prerrequisitos; esperar que no se
  omita silenciosamente ninguna suite.
- [x] 5.3 `scripts/test-study-deployment.sh` y `npm run test:deployment`: ejecutar runtime
  aislado para `test/multi-study-hostile-e2e.integration.js`; verificar ambos estudios y la
  carrera de snapshot.
- [x] 5.4 Documentación: ejecutar `npm run docs:study-check -- --root .`; esperar que el
  validador acepte el contrato vigente y detecte referencias antiguas no permitidas.
- [x] 5.5 `npm run quality`: ejecutar validación completa y registrar prerrequisitos
  externos faltantes; no atribuirle pruebas de integración no ejecutadas.
- [x] 5.6 `test/study-export.browser.test.js` y QA manual: probar 375, 768 y 1280 px,
  teclado, foco, expiración, error/reintento, clic duplicado, recarga, carrera del snapshot
  y descarga efectiva; analizar el archivo con `csv-parse`, nunca separando líneas.
- [x] 5.7 QA de privacidad: usar identidades y datos sintéticos; comprobar solo columnas y
  filas elegibles y ninguna escritura de producción.
- [x] 5.8 `.github/workflows/` y `deployment/docker-compose.release.yml`: confirmar siete
  workflows y compose release intactos byte por byte; no tocar archivos ni fingerprints.
- [x] 5.9 Cambio OpenSpec `participant-comparison-csv-export`: validar en estricto antes de
  revisión; aplicar solo con aprobación explícita y rama feature basada en `develop`.

Los prerrequisitos de los gates se preparan en un runtime aislado con datos sintéticos, nunca sobre producción.
Integración exige `STUDY_HTTP_BASE_URL`, `STUDY_HTTP_SESSION_COOKIE`, `STUDY_HTTP_CSRF_TOKEN`,
`STUDY_HTTP_REPLAY_CARD_ID`, `STUDY_HTTP_NAVIGATION_CARD_ID`, `STUDY_HTTP_CONCURRENT_CARD_ID`
y `STUDY_HTTP_CATEGORY_ID`, con las tres tarjetas distintas y pendientes para sus casos.
El gate E2E exige `STUDY_E2E_BASE_URL`. El harness prepara sus cuentas, sesiones, tokens y base aislados;
no se atribuye cobertura multiestudio al gate genérico de calidad.
