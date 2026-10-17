# Checkpoint de implementacion

Fecha: 2026-10-16. Rama: `feature/participant-comparison-csv-export`, creada desde `develop` con Git Flow.

## Preservacion

- Apply autorizado por `/opsx-apply participant-comparison-csv-export`.
- Ampliacion a dos pruebas aprobada explicitamente por el usuario: `ok actulizalas y continua`.
- El cierre de validacion se realizo sin commits ni push. Posteriormente el usuario autorizo
  explicitamente `si, commits atomicos y push`; conservar los archivos ajenos sin incluirlos.
- Pipeline congelada: siete workflows y `deployment/docker-compose.release.yml`, baseline `b409233`.
- No tocar el contenedor del usuario `labeling-database` ni datos de produccion.

## Estado recuperable

- Implementados nucleo CSV, snapshot read-only, rutas protegidas, interfaz y retiro offline/HMAC.
- Actualizados harness, prueba de carrera PostgreSQL y documentacion/checker.
- Pruebas focalizadas del nucleo/HTTP/boundary/docs/harness/freeze: 53 aprobadas, sin skips.
- Browser/Home reejecutados por el coordinador: 5/5 aprobadas, capturas actuales en `screenshots/`.
- Worker runtime verifico `test:deployment` (1/1), `test:integration` (6/6) y `test:e2e` (1/1).
- Worker docs verifico checker (4/4), `docs:study-check`, lint JS y Markdown.
- Evidencia runtime: `/tmp/opencode/participant-comparison-csv-export-evidence/`.
- QA manual propia: siete escenarios aprobados, incluida descarga real analizada con `csv-parse`,
  teclado, foco, duplicados, rechazo de HTML, reintento y expiracion. Artefacto: `parent-manual-qa.json`.
- Capturas propias actuales: `parent-captures/ready-375.png`, `ready-768.png` y `ready-1280.png`.
- Huella de categorias y decisiones identica antes y despues de la QA; solo datos sinteticos.
- Fixture propia eliminada mediante `runtime.mjs cleanup`; recibo `fixture-cleanup.txt`.
  Contenedor, volumen, proceso de aplicacion y configuracion secreta propios retirados.
  El contenedor del usuario `labeling-database` permanece intacto.
- La evidencia temporal no es un artefacto permanente; comprobar que existe antes de citarla.

## Verificacion de cierre

- Progreso registrado: 45/45. Todas las tareas de implementacion y validacion tienen evidencia.
- Las tareas 3.8 y 5.6 quedan comprobadas tras corregir y verificar el anuncio de exito con Orca.
- Bloqueo de alcance resuelto: las dos pruebas se adaptaron tras aprobacion explicita.
  `test/login-logout-http.test.js` exige las tres tarjetas y el enlace Export, conservando
  identidad de sesion, CSRF, logout y rechazo de identidad falsificada.
  `test/legacy-inventory.test.js` valida positivamente las dos implementaciones nuevas en rutas
  historicas, rechaza consumidores SQL legacy y conserva ausencia de todas las rutas restantes.
  Inventario JSON, hash historico, SQL y pipeline permanecen sin cambios.
- Baseline RED reproducido: 10/12 aprobadas, exactamente los dos fallos esperados.
  Tras adaptar las dos pruebas: 12/12 aprobadas; conjunto de seguridad/boundary/freeze/HTTP: 41/41.
- La primera unit con cuatro CPU ejecuto 506 pruebas: 505 aprobadas y un fallo intermitente
  del probe de login visual. Ese archivo se reejecuto solo y paso 3/3, sin cambios.
- Unit final con `taskset -c 0,1 npm run test:unit`: 506/506 aprobadas, cero fallos/skips,
  codigo 0. Afinidad limitada a dos CPU para que Node ejecute un worker, sin cambiar runner,
  timeouts ni conjunto de pruebas. Evidencia completa del tool:
  `/home/javier/.local/share/opencode/tool-output/tool_14731ee22001LDIkvhJgRsYMIw`.
- 5.2 incluye las ejecuciones de integracion (6/6) y E2E (1/1) de esta misma implementacion,
  cuyos logs sinteticos retenidos se revisaron otra vez; no se atribuyen a unit ni quality.
- Quality final con `taskset -c 0,1 npm run quality`: codigo 0, lint JS/CSS/Markdown aprobado,
  unit 506/506 aprobadas, cero fallos/skips. No se modificaron el runner ni los timeouts.
  Evidencia completa del tool:
  `/home/javier/.local/share/opencode/tool-output/tool_14736ec9a001xCPpya38S6WlWi`.
- Se conserva tambien el intento inmediatamente anterior, fallido por el probe intermitente de
  login visual (505/506), en `tool_14734723e001m11MMPQlWSYZLg`. La repeticion aprobada no elimina
  esa observacion ni acredita estabilidad de la prueba fuera del entorno comprobado.
- Antes de la ampliacion aprobada, `npm run quality` termino con codigo 1:
  lint aprobado; unit 506 pruebas, 502 aprobadas y 4 fallidas, sin skips. Ademas de las dos
  expectativas obsoletas, hubo fallos intermitentes ajenos de login visual y backup.
- Playwright MCP no pudo conectar en dos intentos; la QA propia se ejecuto directamente con
  Chromium/CDP sobre la aplicacion HTTPS y PostgreSQL reales de la fixture aislada.
- Lint JS, los 53 tests focalizados, docs checker y OpenSpec estricto pasaron en el ultimo control.
- Verificacion propia de archivos modificados y evidencia de workers.
- Oracle completo la revision sin fallos demostrados de logica/privacidad; la aceptacion de
  anuncios que dejo abierta se verifico posteriormente con el lector real.
  Sesion: `ses_eb938264cffeNFKHp4PfAi6Ujj`.
- La prueba inicial Orca reprodujo ausencia del anuncio de exito. La correccion mantiene el panel
  ocupado, situa la region viva como hermana dentro de la misma tarjeta y publica el exito despues
  de retirar `aria-busy`. La regresion comprueba estructura y orden de mutaciones.
- Orca 46.1 actual, aislado en DBus/AT-SPI y display Xephyr propios, emitio realmente preparacion
  durante la espera, las tres frases de exito, error y expiracion. Chrome completo la descarga.
  Evidencia sanitizada: `orca-run-WIWa3K/orca-speech-evidence.json`; sin fragmentos pendientes.
- Capturas actuales 375/768/1280 y metricas: `orca-run-xTgaiZ/`; layout conservado.
- Revision independiente del fix y capturas: PASS, sesion `ses_eb8e84651ffe7D1TXH1H7ocL8u`.
  Este veredicto fue acotado a UI; los gates globales se completaron posteriormente.
- Coordinador reejecuto core, HTTP, browser y Home tras la correccion: 33/33 aprobadas.
- Gates finales unit/quality/docs/OpenSpec estricto y congelacion comprobados.
- Revision de entrega del delta final: Oracle APPROVE, confianza alta,
  sesion `ses_eb8c65eccffe3fLAGpFRIhwYOF`. Confirma adaptaciones, evidencia y preservacion;
  mantiene documentado el riesgo intermitente ajeno del probe de login visual.
- Cambio listo para entrega y eventual archivo OpenSpec. La revision no autoriza por si sola
  commits, push ni despliegue; la publicacion Git tiene autorizacion posterior independiente
  del usuario. No se ha solicitado merge, PR, archivo OpenSpec ni despliegue.

## Observaciones

- El registro de tareas background se perdio entre turnos; usar archivos y sesiones persistidas para recuperar.
- `rg` no esta instalado. Grafo `labeler`: generacion `2026-09-29T23:06:40Z`; leer fuente nueva.
- LSP tuvo timeouts en ejecuciones anteriores; no contarlos como diagnosticos limpios.
- Un test ajeno de backup fallo intermitentemente en paralelo y paso por separado; reevaluar en gates finales.
- Ejecucion historica anterior de `npm run test:unit`: 506 pruebas, 503 aprobadas y 3 fallidas, sin skips.
  Dos fallos son las expectativas obsoletas descritas; el tercero es timeout intermitente de
  `test/study-backup-process.test.js:133`. Esta suite de backup reejecutada sola paso 6/6.
- No interpretar un mensaje automatico de continuacion como aprobacion de ampliar el alcance.
