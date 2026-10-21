# Evidencia de implementación local

## Autorización y límites

Autoridad: usuario humano, mediante `/opsx-apply copilot-369-release-pipeline` en esta
conversación, reiterado tras la interrupción de la primera ejecución. Aprobó el plan
corregido y la excepción acotada para estas rutas congeladas:

- `.github/workflows/shared-validation.yml`
- `.github/workflows/release.yml`
- `deployment/docker-compose.release.yml`

Incluye fingerprints, contratos y política acotada previstos. Los otros cinco
workflows y `.github/CODEOWNERS` deben conservarse. Solo autoriza implementación y
pruebas locales aisladas. No autoriza commits, push, merge, publicación, acceso ni
mutaciones de producción, cutover real ni levantamiento de HOLD.

## Rama y preservación

`git flow feature start copilot-369-release-pipeline` creó
`feature/copilot-369-release-pipeline` desde `develop`, commit `b5cddf3`.
El estado inicial no tenía modificaciones tracked; contenía archivos/directorios
untracked previos, incluidos estos artefactos OpenSpec. Se conservan sin stash,
traslado, borrado ni commit. `develop` estaba 28 commits por delante de
`origin/develop`; no se hizo fetch, merge ni rebase.

## Baseline reproducible

`git diff b409233 -- .github/workflows deployment/docker-compose.release.yml`
no mostró diferencias. El inventario contiene exactamente siete workflows. Los
SHA-256 iniciales, obtenidos con `sha256sum .github/workflows/*.yml
deployment/docker-compose.release.yml .github/CODEOWNERS`, son:

```text
54308ecff8eaf4a8663288c10549ef7582d6aabea17c116b2c3874c225e3571b  .github/workflows/eslint.yml
454b34470b1b2135c4fa52ec8d8d2188fb62eeb51da051deb2c3fd20976e290e  .github/workflows/hadolint.yml
2b353de68107949afa1c236272ac35ebacc80cabe8819c533405d81c6dde38fd  .github/workflows/markdownlint.yml
95d16131b01cb2810d21cb05e32315f9cef3bb5863fdfd0d9d94d401cc76e57b  .github/workflows/pr-validation.yml
a5652aa72e65d49cafad76e807eddb1d801ee5ec6aad331e3e9b676e4dacb20b  .github/workflows/release.yml
18cbb8b5d4092cb16a7d962d269c23c9a2a03d1b974ee8e2dcaa86b1fc92035e  .github/workflows/shared-validation.yml
9edc9ccf3fd2c248343a78efb1c33acb42e41f357a24e187b8d1c79e909c21cd  .github/workflows/stylelint.yml
e29073914a704bdaeef3845efadc1e8e1b802efba56b10f09e373daf19798a96  deployment/docker-compose.release.yml
9c527527fdbb6da9f60bd6aaa6ca8cc7f2542f6c4604f3339ab92f60a1c40787  .github/CODEOWNERS
```

CODEOWNERS se compara contra el checkout inicial, no contra `b409233`, donde aún
no existía. No se modifica.

## Gates separados

HOLD permanece vigente. Ningún resultado local demuestra adopción en host,
protección administrativa, owner review, aprobación real de `production`, backup,
restore, elegibilidad de cutover ni despliegue real. Las tareas operativas que
exigen esa evidencia permanecen pendientes. No se contactará producción para
obtenerla bajo esta autorización.

Herramientas comprobadas: Docker Server `29.9.1`, Git Flow AVH `1.12.3`.
La revisión documental anterior no cuenta como evidencia runtime.

## Verificaciones locales iniciales

- `node --test test/ci-pipeline-freeze.test.js`: 2/2, cero skips/cancelaciones.
- Auditoría literal `git diff --name-only origin/master...develop --
  .github/workflows deployment/docker-compose.release.yml`: salida vacía en la
  baseline. No autoriza ni realiza merge; se repetirá al cerrar las ediciones.
- `openspec --version`: `1.9.0`.
- `openspec validate --all --strict --no-interactive --json`: 26/26 válidos
  (22 cambios y 4 specs), cero fallos. Es validación local, no runner limpio CI.
- `docker build --file deployment/server/Dockerfile --tag
  labeler-copilot369-local:b5cddf3 .`: exit 0. Tag exclusivamente local; no publicación.
- `docker run --rm --network none --read-only --cap-drop ALL --entrypoint
  sha256sum labeler-copilot369-local:b5cddf3` con las cuatro rutas canónicas:
  CSV 369 `fad0881b9e40b1b68a577e84ad60c90d48fcebe79db8d55d05613fc1746794fb`,
  sidecar 369 `1837bc7a8cbd366349c8bc207cc236a0dec9d0b04f7f63325ee525884faf3f3a`,
  CSV 30 `1607cfe84cb687a2cc7b4c56d3e0abf106b1a1044810d7390663ef1d691b63ab`,
  sidecar 30 `5049b9357468ce98bd4f83057ea3e59178a5d03793f97800252d7e3e87e7dc1a`.
  Acredita presencia/bytes, no digest publicado ni la imagen final integrada.

No hay servidor LSP configurado para Markdown; no se reportan diagnósticos
Markdown como comprobados. Los artefactos sí pasan la validación OpenSpec.

## Checkpoint de integración (no final)

- `node --test test/release-manifest.test.js`: 10/10, cero skips/cancelaciones.
- Driver manual sobre `createReleaseManifest` y `parseReleaseManifest`: produjo
  v2 con orden 369/30 y rechazó una clave `schemaVersion` duplicada.
- `npm run lint:js`: tras correcciones del productor, exit 0 en este checkpoint.
- `npm run lint:css` y `npm run lint:md`: exit 0.
- `npm run validate:study-profiles` sin `STUDY_PROFILES_INPUT`: rechazó la entrada
  ausente (`STUDY_PROFILES_INPUT_INVALID`); no acredita validación de perfiles.
- `npm run test:unit`: NO pasó; la ejecución intermedia alcanzó el límite de
  120 segundos. Mostró fixtures del launcher aún v1 incompatibles con el productor
  v2 en transición y timeouts `Page.loadEventFired` en pruebas Chromium de Home y
  Progress. No se presenta como fallo preexistente demostrado ni como éxito.
  Salida capturada por la herramienta en
  `/home/javier/.local/share/opencode/tool-output/tool_14c5f7e490019y2bg2fasN7ptO`.
- Diagnósticos LSP de los cuatro archivos JS del productor: timeout, incluso
  después de una segunda solicitud. ESLint pasó, pero no sustituye ni se reporta
  como diagnóstico LSP limpio.

Estos resultados pertenecen a un árbol en edición, no son la validación final
integrada ni evidencia CI. El cierre debe volver a comprobar el árbol final con
selección completa y concurrencia acotada, sin reducir aserciones ni ocultar el
fallo inicial.

## Reanudación y bloqueo contractual

La reanudación confirmó la misma feature y 6/87 tareas. Los ocho IDs background
anteriores devolvieron `Task not found`; no se asumió que siguieran trabajando.
Solo existían el productor y sus fixtures. La corrección del productor preserva
ahora el patrón histórico de `workflow`, admite IDs grandes de Actions y rechaza
nombres de secretos; `node --test test/release-manifest.test.js` pasó 11/11.
Se cierran únicamente 2.1, 2.2 y 3.1-3.3: progreso 11/87.

Dos delegaciones nuevas escribieron el mecanismo host/preparación y el harness/CI.
Sus llamadas largas devolvieron timeout de inactividad del gestor, no una entrega
verificada. La delegación CI sí cerró después con reporte y dejó de editar. La
delegación host no entregó reporte final, incluso tras solicitarle cesar ediciones;
su sesión tampoco pudo leerse con `session_read`/`session_info`. No se presenta
como aprobada ni se asume que siga ejecutándose. Los archivos escritos se
conservan como implementación pendiente de revisión, sin marcar sus tareas.

### Decisión necesaria antes de continuar el estado durable

`design.md` exige exactamente doce claves raíz del journal (línea 244), pero su
enumeración de las líneas 175-177 y el ejemplo de las líneas 190-206 contienen
once: `formatVersion`, `status`, `operationId`, `releaseId`, `generation`,
`target`, `databaseIdentity`, `effectiveSchema`, `effectiveDataBundle`,
`lastVerifiedAt`, `evidenceRef`.

`deployment/host/records.py` añadió `origin` como duodécima clave y
`deployment/host/README.md` lo reconoce explícitamente. Esa resolución no está en
el contrato aprobado y no debe aceptarse tácitamente. Se solicita decidir si
`origin` será la duodécima clave, o si el journal se mantendrá en las once claves
enumeradas y el origen residirá solo en los recibos. No se modificaron los
artefactos de diseño/spec para legitimar la decisión del implementador. Las tareas
de journal, transiciones y su integración permanecen pendientes y HOLD continúa.

### Verificaciones efectivamente ejecutadas

- Oracle diagnosticó la dependencia de Chrome 155 del almacén de credenciales de
  escritorio para perfiles temporales. Se añadió `--password-store=basic` solo a
  los launchers de tests aislados; no se cambiaron aserciones, timeouts o retries.
  Home, Progress, categorías y exportación: 16/16 en la ejecución focalizada.
  La prueba focalizada adicional de security-headers mostró 2/3 por un probe de
  layout ausente; posteriormente sus tres pruebas pasaron dentro de la selección
  unitaria completa. No se oculta el fallo focalizado ni se atribuye su causa al
  keyring sin evidencia adicional.
- `npm run lint`: JS, CSS y Markdown exit 0; los cinco archivos de navegador
  editados devolvieron diagnósticos LSP limpios.
- `node --test test/deploy-vps.test.js`: 12/12, cero skips/cancelaciones. El wrapper
  ejecuta toda la selección Python en Docker root aislado sin socket Docker ni red.
  Ejecutar Python directamente como usuario no root había fallado las guardas de
  propiedad; ese comando no es la configuración válida del ensayo privilegiado.
  Los resultados verdes del borrador no resuelven la discrepancia contractual.
- Imagen `labeler-readiness-local:copilot369-apply`: build local exit 0, después de
  una primera ejecución cancelada por timeout de 120 segundos. No se publicó.
- `LABELER_READINESS_TEST_IMAGE=labeler-readiness-local:copilot369-apply npm run
  test:unit`: ejecución completa, 563 tests, 561 pasan, 2 fallan, cero skips y cero
  cancelaciones. Fallan el freeze fingerprint aún antiguo y la aserción de que
  `release.yml` no debe pasar opciones v1. No es gate verde.
  Salida: `/home/javier/.local/share/opencode/tool-output/tool_14db58c08001ILacSDrLuBZSrD`.
- `LABELER_READINESS_TEST_IMAGE=labeler-readiness-local:copilot369-apply npm run
  test:integration`: timeout de 300 segundos tras 22 pruebas satisfactorias; sin
  resumen final, no se declara aprobado ni inventario completo ejecutado.
- La delegación CI ensayó `npm run test:deployment`; el prepare rechazó la falta
  de handoff privilegiado. Su recibo `/tmp/labeler-deployment-evidence-zedi15/cleanup-receipt.json`
  informa recursos aislados eliminados; falta integrar/verificar ese recorrido
  completo por el padre antes de darlo por satisfecho.
- La integración interrumpida dejó el contenedor sintético
  `labeler-copilot-369-c979d01b-30fd-4577-bd06-b4d090c1b90d`. Se comprobó que era
  `postgres:17.6-alpine`, tmpfs descartable y puerto loopback, y se eliminó solo
  ese ID (`0e8e16dc872e`). Ningún volumen del proyecto fue eliminado.
- `pgrep` no encontró procesos de tests, harness o unittest host aún activos al
  terminar estas comprobaciones. No se lanzan nuevos subagentes ni se delega trabajo
  pendiente para después de la pausa.

### Freeze sin cierre ficticio

Solo difieren de `b409233`, entre las rutas congeladas,
`shared-validation.yml` y `deployment/docker-compose.release.yml`. Los otros cinco
workflows y CODEOWNERS conservan sus hashes iniciales. `release.yml` aún está sin
actualizar. Los fingerprints no se actualizaron para convertir un árbol sin
integración final en baseline aprobada. Hashes actuales de borrador:

```text
6088383a4a0e82730f02829dd4a57af5e76411d9a0ecdb64b0896bd8dd6f4e86  .github/workflows/shared-validation.yml
fb6316592ff713692b9dd9ad9fc79df396c9f68ff3d277de6269717dc05e715d  deployment/docker-compose.release.yml
```

No hubo commits, push, merge, publicación ni acceso SQL a la base existente. No
hay evidencia de CI remoto, protección administrativa, adopción host, backup,
restore o cutover productivos. Esas tareas permanecen pendientes.

## Ejecución posterior a la aprobación de origin

El usuario aprobó explícitamente conservar `origin` como duodécima clave; diseño,
spec y tarea 5.2 se reconciliaron antes de esta continuación. El bloqueo histórico
11/12 campos está resuelto y no se utiliza como motivo de la nueva pausa.

### Trabajo integrado y comprobado

- `release.yml` invoca las ocho opciones v2, sin CSV ni flags de esquema v1, y
  ambas construcciones declaran `org.opencontainers.image.revision`. El ensayo
  local ejecutó el empaquetado con referencias sintéticas por commit/digest,
  comprobó los cuatro archivos fuente físicos y rechazó entradas extra/duplicadas.
- Freeze: `deployment/ci-pipeline-fingerprints.json` conserva los ocho hashes de
  `b409233` y fija los tres pares before/after autorizados. Los seis contratos de
  freeze pasaron, incluidas mutaciones de hash y ruta. Los cinco workflows restantes
  y CODEOWNERS conservan sus bytes. La auditoría literal de refs imprimió vacío;
  no incluye cambios uncommitted ni demuestra readiness de merge.
- El harness conserva un propietario root con flock durante prepare. Rechaza
  contexto ausente y ruta falsificada, comprueba el binding candidato/DB y verifica
  después la eliminación del helper, su contexto y los recursos de ambas fixtures.
- Se corrigió una espera circular: `docker logs --follow` permanecía abierto
  mientras el propietario esperaba la orden de terminar. La espera nueva usa logs
  finitos y un deadline, sin soltar el lock. Tres regresiones verifican ready con
  propietario vivo, timeout visible y salida prematura. También se corrigieron la
  reescritura del JSON de Compose protegido y la propagación de NODE_TEST_CONTEXT,
  que podía omitir inadvertidamente la selección HTTP hija.
- Los marcadores privados de las seis cuentas ya no se contienen entre sí; una
  regresión comprueba las 30 parejas distintas. Se corrigió un parámetro que
  confundía source_card_id con el UUID de pr_card y se mantuvieron ventanas de
  fingerprints bidireccionales separadas de las mutaciones esperadas del estudio.

### Resultados completos y límites

- `LABELER_READINESS_TEST_IMAGE=labeler-readiness-local:copilot369-apply npm run
  test:unit`: última selección completa, 575/575, cero skips/cancelaciones.
  Salida conservada: `/home/javier/.local/share/opencode/tool-output/tool_156dba45a001Pm38vhn1VAKFje`.
- Selección completa de integración dentro del harness: 61/61 en los diez archivos
  de fixtures. Los otros dos archivos del inventario se ejecutaron en sus etapas
  runtime y deployment; la etapa deployment terminó fallida, no omitida.
- HTTP privado: 6/6. E2E hostil HTTPS: 1/1, con seis sesiones independientes,
  controles de Origin/CSRF, privacidad, notas/edición, clasificación/descarte,
  navegación, progreso, logout y exportaciones 369/30. Se comprobaron 368/369 y
  29/30 pendientes rechazados, y salidas completas de 8 y 11 columnas.
- Caddy: `/login` 200, Actuator y subrutas 404. Salud interna: 1/1 en la red Docker,
  sin publicar un puerto de servidor como sustituto del borde HTTPS.
- Segundo prepare readonly con decisiones persistidas: fingerprints 369 y 30
  idénticos; se verificó también el rechazo de drift antes del arranque público.
  Recibos en `/tmp/opencode/labeler-copilot369-evidence.5wW73r/`, especialmente
  `successive-release.txt`, hashes before/after, `multi-study-hostile-e2e.log` y
  `cleanup-receipt.json`. El workload global fue fallido por el escenario legacy;
  cleanupVerified y ausencia de los recursos asignados sí fueron verdaderos.
- `npm run lint`: JS, CSS y Markdown exit 0. OpenSpec global estricto: 26/26.
- No se afirma aprobación del gate final de deployment, ni revisión final del
  conjunto host. Las tareas host no revisadas y los gates administrativos siguen
  pendientes pese a los contratos locales satisfactorios.

Se marcan 37/87 tareas, únicamente por los resultados anteriores: además de las
once previas, 3.5, 6.1-6.6, 7.1-7.12, 8.1-8.2 y 9.1-9.4/9.6. La contabilización
del inventario 8.2 no significa que la suite deployment sea satisfactoria.

### Bloqueo nuevo: esquema físico después del retiro legacy

La fixture ahora separa correctamente el rechazo del release ordinario y la
operación explícita de retiro. Oracle confirmó que esa separación de pruebas es
compatible con el alcance: no se habilitó retiro automático ni se cambiaron sus
guardas. Con backup sintético y confirmación, el comando existente retiró legacy;
su reejecución fue idempotente y el backup corrupto se rechazó sin cambiar DB.

El prepare posterior sigue fallando en la guarda física, reproducido también por
el padre mediante `scripts/test-study-deployment.sh --legacy-only`. Ese modo es
solo un diagnóstico focalizado: CI conserva la ejecución completa sin ese flag.
Se comparó el catálogo retirado con otra base descartable creada exclusivamente
mediante las migraciones gestionadas hasta 014, en transacciones READ ONLY y sin
consultar filas de participantes o credenciales.

La evidencia exacta es
`/tmp/opencode/labeler-retired-catalog-evidence.g6NnF6/retired-schema-catalog-diff.json`:

- Fuentes de migración iguales a las fijadas; la base nueva satisface el contrato,
  la retirada no.
- Falta `participant_category_participant_id_fkey`, que referencia `reviewer(id)`.
  Faltan también sus cuatro triggers RI.
- Sobran los índices `pr_classification_participant_id_updated_at_idx`,
  `study_card_pr_card_id_idx` y `study_participant_reviewer_id_idx`, redundantes
  respecto de los índices gestionados. Sus cuatro columnas de catálogo explican
  la diferencia adicional de pg_attribute; no son columnas de datos perdidas.
- Tras normalizar los OIDs TOAST con la lógica existente, quedan cuatro
  dependencias de índices solo en la retirada y tres dependencias de FK solo en
  la nueva. El ruido OID eliminado no explica las diferencias estructurales.

El esquema legacy inicial no declaraba aquella FK y creaba los índices citados.
La migración 001 usa CREATE TABLE IF NOT EXISTS y no reconcilia esa tabla ya
existente; 002 retira legacy pero no normaliza esos objetos protegidos.

No se cambió SQL ni la aceptación física, ni se añadió una huella alternativa
para ocultar el fallo. Normalizar la base requiere planificar una migración
adicional, con validación de datos y guardas, fuera de las tareas actuales que
preservan 001-014 y el contrato fijado. Si la FK no valida en una base real,
corresponde resolución operativa separada; no se eliminarían datos para forzarla.
Se pausa para decidir ese alcance, no para pedir nuevamente aprobación del plan,
de origin o de la excepción de pipeline ya concedidos.

Todos los subagentes nuevos finalizaron y devolvieron el ownership. Los ensayos
descartables registraron cleanupVerified; al comprobar procesos y contenedores
no quedaron tests/helpers activos y solo estaba el contenedor preexistente
`labeling-database`, sin operaciones SQL sobre él. HOLD continúa; no hubo commit,
push, merge, publicación ni cutover real.

## Reanudación local del 2026-10-20

El usuario confirmó explícitamente la continuación mediante `/opsx-apply
copilot-369-release-pipeline`, limitada a implementación y pruebas locales
aisladas, sin commit, push ni acceso a producción. La rama comprobada sigue
siendo `feature/copilot-369-release-pipeline`; se preservan las modificaciones y
archivos no rastreados preexistentes. OpenSpec informa 86/104 tareas completadas
al iniciar; ese conteo no sustituye la verificación del árbol actual.

Comprobaciones iniciales ejecutadas por el coordinador:

- OpenSpec CLI `1.9.0`; validación global estricta: 26/26 válidos.
- `node --test --test-concurrency=1 test/release-manifest.test.js
  test/ci-pipeline-freeze.test.js`: 17/17, cero fallos, skips, cancelaciones y TODOs.
- `git diff --check`: sin errores.
- `python3 -B deployment/release-host-control.py --version`: consumidor v2,
  fingerprint agregado inicial
  `5578782c611959284f7fdffe0cf731209b0ad4fa590c123e9222829cc5ecc536`.
  Un intento anterior usó erróneamente `node` sobre ese archivo Python y falló
  por extensión desconocida; no ejecutó el consumidor ni alteró estado.

Estos resultados son preliminares, no un cierre integrado. Se detectó que
`test/runtime-failure-rehearsal.integration.js` no estaba asignado al inventario
explícito de integración. Se trabaja por separado en esa integración, la
continuación post-015 y los fixtures de generación/publicación.

Antes de los ensayos de esta reanudación ya estaban activos `labeling-database`
y `real-rehearsal-19898b87-7c9f-41dc-927c-3232e8c37c3c-db`. No son recursos
creados por esta ejecución y no se eliminan ni se consultan mediante SQL.
La evidencia nueva se conservará bajo
`/tmp/opencode/copilot369-resume.9R7hS7/`. HOLD permanece vigente; no hay evidencia
nueva de CI remoto, controles administrativos ni operaciones productivas.

## Cierre local segun plan del 2026-10-20

Autorizacion actual: `/opsx-apply copilot-369-release-pipeline`, limitada a las
tareas 1-4 de `.omo/plans/copilot-369-release-closure.md`. OpenSpec permanece como
fuente de requisitos. La revision del plan no encontro contradicciones con este
cambio; no autoriza commits, push, merge, administracion ni operaciones en VPS.

El intento nuevo usa `/tmp/opencode/copilot-369-release-closure-f65Lz98e/`, con
permisos 0700. Cada comando capturado tiene salida `.log` y metadatos `.json`
con comando, fechas UTC, exit code, imagen configurada y SHA-256 del log. La
baseline `initial.json` registra HEAD
`b5cddf3ec214de0e224de75fb0027a4f08b35591`, permisos y hashes de los archivos
evaluados; `initial.diff` conserva el diff tracked previo. Su huella agregada es
`1a323c86b2822c5f77ad65406a95c2d64a771e93ec09d8a8cab5f3e66620976a`.
La rama sigue siendo `feature/copilot-369-release-pipeline`, basada en `develop`.
Se conserva todo el trabajo previo, sin stash, traslado ni descarte.

### Tarea 1: inventario reparado y comprobado

- `task-1-before.log` y `task-1-probe-before.log`: fallos reproducidos, exit 1,
  por la suite de fallos sin asignacion en el inventario.
- Se registro `test/runtime-failure-rehearsal.integration.js` exactamente una vez
  en `fixture`, sin relajar la igualdad estricta del inventario. El resultado
  contiene 14 suites fixture, una runtime y una deployment.
- `task-1-parent-final.log`: `node --test test/quality-gates.test.js`, exit 0,
  17/17, cero fallos, skips, cancelaciones y TODOs. Incluye casos negativos en
  copias temporales: suite presente sin asignacion y asignacion duplicada.
- `task-1-parent-probe.log`: probe real de `integrationTestPlan()`, exit 0,
  con el inventario completo impreso. El harness sigue consumiendo la etapa
  fixture mediante `npm run test:integration`.
- LSP no encontro diagnosticos en `scripts/quality-gate-inventory.js`. Las
  solicitudes de diagnosticos frescos del test agotaron el timeout del servidor;
  no se reportan como limpias ni se modifica la configuracion del tooling.

### Imagen de prerrequisito

`image-prerequisite-build.log`: construccion del arbol actual mediante
`docker build -f deployment/server/Dockerfile -t labeler-release-closure:local .`,
exit 0. `image-prerequisite-identity.log` registra el ID local inmutable
`sha256:5feaaeba62e1fdcfb540b5981a24ce8882a7724434f41a5862994121931324f8`.
`image-prerequisite-tree.json` registra la huella agregada
`b5eb5a41beeb6653fa8f5b84205344bde31c7629577cad5ef0c20627227bcd6f`.
La correccion final del caso negativo solo afecta tests, que no se copian en la
imagen. Las tareas 2/3 reciben explicitamente `LABELER_READINESS_TEST_IMAGE`;
el gate final debe volver a construir y verificar el arbol integrado.

El build emitio avisos de npm audit, incluidos 15 hallazgos en dependencias de
produccion (5 moderados, 9 altos y 1 critico). No se han investigado ni corregido
en este alcance; no se ejecuta `npm audit fix` ni se cambian dependencias.

Comprobaciones preliminares, no cierre integrado: freeze/manifiesto 17/17 y
OpenSpec global estricto 26/26. Versiones capturadas: Node 22.22.2, npm 10.8.2,
OpenSpec 1.9.0 y Docker Compose 5.6.0. Los contenedores preexistentes
`labeling-database` (`06db6b9aa40b`) y
`real-rehearsal-19898b87-7c9f-41dc-927c-3232e8c37c3c-db` (`89175bdbc4a2`)
no pertenecen a este intento y no se consultan por SQL ni se eliminan.

No se cierra ninguna casilla adicional con estos resultados focalizados.
Las tareas 2/3 y el gate integrado de la tarea 4 siguen pendientes de evidencia.
HOLD y todos los gates remotos/administrativos/productivos permanecen vigentes.

## Revalidacion final local: cierre bloqueado

Tras las nuevas solicitudes del usuario de continuar, se comprobo que
`/tmp/opencode` estaba vacio. Los logs y snapshots del intento
`copilot-369-release-closure-f65Lz98e` ya no estaban disponibles. Se conserva arriba
el registro historico, pero sus resultados y los resúmenes de subagentes no se
usan para cerrar casillas. No se reconstruyen ni se atribuye una causa a la
perdida de esos archivos.

La evidencia nueva esta en `/tmp/opencode/copilot-369-final-1TUUyPri/`, directorio
0700. Los comandos tienen `.log` y `.json` con comando, fechas UTC, exit code,
imagen configurada y hash del log. `validated-code.json` registra HEAD
`b5cddf3ec214de0e224de75fb0027a4f08b35591` y la huella agregada del arbol evaluado
`621e348be2aaaec9a7bb2c7acf9d06b6e3554a226e14a2e229b488b54873dbea`.
`checked-code.json`, posterior a los gates, tiene la misma huella. El diff
tracked completo se conserva con esos snapshots, sin descartar trabajo previo.

### Imagen y gates ejecutados

- `image-validated-build.log`: build del arbol final, exit 0. El ID usado por
  unidad y deployment es
  `sha256:9dbfb6b67934736909c5ed5a1c2f98ffd9ef3a3a18c7edad6347704f38e229a3`.
  Los rebuilds cacheados conservan el manifiesto de plataforma
  `sha256:2e0e5bf51037185c82f0fb954401a00de080e7125151c268bb56dddc00823241`;
  las attestations producen IDs de indice distintos. No se confunden con una
  imagen publicada ni con CI remoto.
- `image-sources.log`: los cuatro hashes canonicos dentro de la imagen coinciden.
- `lint.log`: primer lint final fallido, 90 errores de formato en helpers del
  ensayo runtime. Se corrigio solamente la indentacion del switch del broker y
  la expresion de dos espacios del log SQL. `sql-parser-regression-before.log`
  conserva el fallo detectado durante esa correccion; el probe posterior cuenta
  una lectura y rechaza un UPDATE. No se debilitaron aserciones ni reglas ESLint.
- `lint-final.log`: JS, CSS y Markdown, exit 0.
- `unit-final.log`: seleccion completa de 78 archivos, 592/592, cero fallos,
  skips, cancelaciones y TODOs; exit 0. Incluye el wrapper host que ejecuta toda
  la seleccion Python `test_release_host_*.py` en Docker root aislado sin socket.
  El hash del log es
  `c735c860f516f703358ba087749e0980c8dbf29030f5dc446c36f8b971784d77`.
- `openspec.log`: OpenSpec 1.9.0, validacion global estricta 26/26, exit 0.
- `freeze.log`: freeze y manifiesto, 17/17, exit 0. No se cambiaron hashes de
  politica, CODEOWNERS ni workflows para hacer pasar el gate.
- `deployment-final.log`: `npm run test:deployment`, exit 1, sin timeout. El
  inventario selecciono los 14 archivos fixture; ejecuto 103 pruebas de
  integracion, 101 satisfactorias y 2 fallidas, cero skips y cancelaciones.
  El hash del log es
  `710d61aa8d05108b369a55b544d989527866f0a12d9843a5dd57d414bc17987b`.

### Casillas cerradas con evidencia nueva

- **2.11:** la suite unitaria completa ejecuta los casos de reserva durable y
  crash antes del floor, reconcile y continuacion de la reserva exacta,
  candidato/attempt/imagen/hash/DB ajenos, replay, prefijos de publicacion,
  completion contradictorio y rollback que conserva floor. Referencias:
  `test_release_host_state.py`, `test_release_host_failures.py`,
  `test_release_host_publication.py` y `test_release_host_commands.py`.
  Esto acredita fixtures sinteticos, no publicacion ni recuperacion real.
- **11.14:** los tres archivos de normalizacion ejecutaron sus 35 pruebas
  satisfactoriamente dentro de la seleccion completa del harness: seis casos
  host, siete bootstrap/ledger y 22 de normalizacion. Las dos fallas pertenecen
  exclusivamente a `runtime-failure-rehearsal.integration.js`. Se comprobaron
  prepare vacio real y orden 369/30, Runtime.maintenance y ambos scripts reales
  de migracion/cutover, ledger sin reaplicacion, rechazo con historial primario,
  preservacion de 30, Copilot readonly sin migrador, dump custom y restore
  aislado post-015, rechazo de recibo con origen pre-015 y reconcile tras commit
  sin recibo. Los contratos host de autorizacion y checkpoint tambien pasaron
  dentro de la seleccion Python de `unit-final.log`.

La prueba de 11.14 es compuesta: el controlador acredita admision, autorizacion,
lock y baseline; los adapters acreditan los entrypoints/SQL reales. El helper
directo de prepare no retiene el lock del padre y el helper de maintenance no
acredita autoridad por si solo. No se presentan como E2E host autorizado completo.
El negativo de backup usa un recibo con origen pre-015, no un restore de un
archivo pre-015. El positivo si ejecuta pg_dump custom y pg_restore sobre otro
cluster descartable; los globals del recibo siguen siendo una fixture.
La consulta readonly de Oracle considero suficiente esta composicion para el
contrato actual, no aprobo el gate final. Resumen: `coverage-review.md` externo.

### Bloqueo reproducido y limpieza

El ensayo **smoke** termina en `failureStage=runtime`, antes del fallo HTTPS
previsto. El ensayo **rollback** tampoco alcanza las dos publicaciones exitosas
previas a su inyeccion: falta la operacion `fault`. En ambos recibos se observa
`up` con exit 1 antes de esas fases. No se conoce aun la causa del arranque
fallido; no se atribuye a flakiness, carga o configuracion sin diagnostico.
No se repite el gate para buscar un verde ni se aumentan sus timeouts.

El HTTP privado paso 6/6 y el E2E hostil HTTPS de seis cuentas termino
satisfactoriamente antes de la integracion. Las etapas posteriores a integracion,
incluidas preservacion entre releases y recorrido existing del harness, no se
ejecutaron. Por tanto, no hay gate de deployment verde ni hito local completo.

`harness/cleanup-receipt.json` indica workloadExitCode 1, cleanupVerified true,
ausencia de los recursos asignados y eliminacion del directorio temporal. El
padre verifico tambien los siete recibos del ensayo runtime y la ausencia real
de sus 56 recursos mediante Docker inspect; `recovery-cleanup.log` conserva
paths y hashes de esos recibos. Solo sigue corriendo el contenedor preexistente
`labeling-database`, con el mismo ID `06db6b9aa40b`; no se consulto por SQL ni se
reinicio. El otro contenedor preexistente del intento anterior ya no figuraba
en la baseline de este intento; no se atribuye su desaparicion a esta ejecucion.

El diagnostico separado `operational-v1-blocker.log` sigue fallando cerrado antes
de crear una fixture: la imagen v1 cacheada carece de procedencia ligada a
revision. No se modifica ni sustituye esa exigencia; **10.13 permanece abierta**.

Estado tras estos cierres acotados: **88/104**. Las tareas 8.3, 10.1, 10.2 y 11.16
no se cierran con este gate fallido. Todos los gates externos siguen abiertos y
HOLD permanece. Tras los timeouts iniciales, los diagnosticos JS frescos de los
archivos cambiados terminaron limpios. Python LSP no esta instalado y su
instalacion fue rechazada previamente; no se reporta como limpio ni se instala.
No hay servidor LSP para Markdown. El chequeo Markdown adicional de tasks.md
detecto cuatro errores MD013 preexistentes en las lineas 249, 250, 253 y 265;
esas lineas no fueron modificadas y no se reformatean dentro de este cierre.

La tarea 4 queda **BLOQUEADA**. Siguiente accion tecnica: diagnosticar por que el
runtime de las fixtures smoke/rollback falla antes de la inyeccion esperada,
corregir unicamente la causa demostrada y renovar el gate integrado completo.
No se realiza revision de gate final aprobatoria mientras QA siga fallando.
No hubo commits, push, merge, publicacion, cambios administrativos ni operaciones
en VPS. La documentacion no autoriza esas acciones ni levanta HOLD.

## Diagnostico autorizado de las fixtures runtime

El usuario autorizo continuar el diagnostico y la correccion acotada del arranque
smoke/rollback, manteniendo los limites locales de las tareas 1-4. El intento
usa `/tmp/opencode/copilot-369-runtime-4RGBriCI/`, directorio privado 0700, y
conserva la evidencia anterior, incluido el gate integrado fallido.

La comparacion ejecutada del mismo flujo smoke, con la misma imagen
`sha256:9dbfb6b67934736909c5ed5a1c2f98ffd9ef3a3a18c7edad6347704f38e229a3`,
aislo la causa sin modificar codigo productivo:

- `smoke-before.log`: con la umask habitual, startup satisfactorio, servidor
  saludable y fallo HTTPS deliberado con curl 28; failureStage smoke, exit 0
  del driver de comprobacion.
- `smoke-umask-before.log`: con umask 077, Caddyfile propiedad del UID 1000 y
  permiso efectivo 0400 (configMode 256). El servidor sigue saludable, pero
  Caddy termina con exit 1 y el mensaje exacto
  `open /etc/caddy/Caddyfile: permission denied`. El controlador se detiene en
  failureStage runtime y el driver falla, exit 1.

El harness hereda umask 077. writeFile con mode 0444 no garantiza ese modo final:
la umask elimina las lecturas de grupo/otros. Caddy no es propietario de ese
archivo y ejecuta con capacidades reducidas, de modo que no puede leerlo. No
se trata de PostgreSQL, de un timeout insuficiente ni del fallo HTTPS previsto.
Los dos ensayos diagnosticos cerraron sus recursos descartables mediante finally.

La correccion prevista se limita a fijar explicitamente el modo efectivo del
Caddyfile publico despues de crearlo y a ejercitar la umask restrictiva en los
ensayos existentes. No modifica secretos, capacidades, timeouts, SQL ni contratos
productivos. Los resultados de la regresion y del gate completo se registraran
despues de verificarlos; por ahora el progreso permanece en 88/104 y HOLD sigue.

### Gate completo posterior a la correccion de umask

La correccion verificada fija solamente `Caddyfile` a 0444 en
`test/support/real-runtime-rehearsal-fixture.js`. Los casos existentes de runtime,
smoke y rollback crean sus fixtures con umask 077 y restauran la mascara previa
mediante finally. No se cambiaron secretos, capacidades, timeouts ni aserciones.
El wrapper `test/deployment-harness.integration.js` conserva ahora los recibos
maquina JSONL de los gates en el directorio privado de evidencia, tambien cuando
la ejecucion termina correctamente; no archiva salida arbitraria de la app.

El padre repitio el mismo driver bajo umask 077 despues del fix:
`smoke-umask-after.log` muestra configMode 292 (0444), capacidades de Caddy
reducidas sin cambios, servidor saludable y llegada al fallo HTTPS deliberado.
El driver termino con exit 0. La regresion `regression-red.log` conserva el
fallo anterior al chmod, exit 1. El contraste demuestra la causa, no una mera
repeticion que pase ocasionalmente.

Existe una limitacion adicional de evidencia: el ejecutor informo un primer
ensayo focal de 6/7 por `Connection terminated unexpectedly` durante el setup
PostgreSQL de backup, entre 20:33:17Z y 20:39:27Z. Sobrescribio ese log con una
repeticion de 7/7. No se conserva el original ni hay logs de ciclo de vida que
permitan clasificar su causa. `reported-setup-failure.md` registra expresamente
la perdida, los metadatos informados y sus limites; no se usa el rerun focal
como evidencia sustitutiva del cierre integrado.

El gate integrado nuevo del padre se ejecuto una vez sobre el codigo corregido,
sin retries automaticos, con estos resultados retenidos en este intento:

- `lint.log`: lint completo, exit 0.
- `unit.log`: 78 archivos, 592/592, cero fallos, skips, cancelaciones y TODOs;
  exit 0, hash
  `f9c4e666d23f1a0ed4cb3f22fc4234367644ef93c99c6f772137d839f4149122`.
- `openspec.log`: validacion global estricta con CLI 1.9.0, 26/26, exit 0.
- `freeze.log`: freeze/manifiesto, 17/17, exit 0.
- `deployment.log`: `npm run test:deployment`, exit 0, de 21:06:00Z a 21:33:17Z,
  dentro del timeout original. Hash
  `8650367ecb349fbf222c470a7a583654577aa8a1f4744c290b66835b20ad6493`.
- `harness/quality-gate-receipts.jsonl`: seleccion explicita de los 14 archivos
  fixture, 103/103 integracion; E2E interno 1/1. Ambos recibos tienen executed
  true, exitCode 0 y cero skips/cancelaciones/TODOs; el archivo tiene modo 0600.
- `harness/multi-study-hostile-e2e.txt`: recorrido hostil completado, exportaciones
  de 369 con dos/tres participantes y 8/11 columnas, y validacion de 30 aislada.
- `harness/successive-release.txt` y pares before/after: prepare sucesivo readonly,
  fingerprints persistentes identicos de primaria 369 y validacion 30.
- Los recibos de normalizacion prueban checkpoint con parada, continuacion fresca
  y finalizacion del caso sintetico existing; no se omite la ruta posterior a 015.
- `harness/cleanup-receipt.json`: workloadExitCode 0, cleanupVerified true,
  directorio temporal eliminado y ambos propietarios de handoff limpiados.
- `evidence-check.log`: el padre contrasto el inventario exacto, los contadores,
  los tres pares de fingerprints y la ausencia real de recursos de ambos
  proyectos y de los siete ensayos runtime (56 recursos), sin eliminaciones
  adicionales. El recibo smoke alcanza curl 28; rollback contiene fault seguido
  del fallo real y conserva floor 2.

`runtime-code.json` y `validated-code.json` tienen la misma huella agregada
`4f97ed79cd03a5173c3723cc88d9894c40957aa97d9af8a5512ec737b2169c2a`, con HEAD
`b5cddf3ec214de0e224de75fb0027a4f08b35591`. La imagen del build final y del harness
es `sha256:7ed2897557bca4e9c674e7b28b4826140fdebf52007f5093a62da6666eba9aa8`.
Solo permanece corriendo el contenedor preexistente `labeling-database`, mismo
ID `06db6b9aa40b`, sin SQL ni reinicios sobre el. Se eliminaron el journal de
debug y el driver temporal propios; los logs y verificadores externos quedan
como evidencia privada. No se altero trabajo previo ajeno.

Los gates tecnicos locales estan satisfechos; el registro de cierres restantes
espera la revision final de gate. Esto no acredita CI remoto, enforcement de
GitHub, adopcion, backup/restore productivo ni despliegue. HOLD sigue vigente.

### Revision final y cierres locales aprobados

La unica revision final de gate devolvio **APPROVE** para los cuatro cierres
locales, con confianza alta y sin bloqueos ligados a estos requisitos. Se
conserva el resumen en `gate-review.md`, dentro del directorio de evidencia de
este intento. Es revision tecnica local por agente, no revision de owner en
GitHub ni aprobacion humana de production.

Se cierran solamente **8.3, 10.1, 10.2 y 11.16**, por la seleccion completa,
los contratos negativos y la evidencia integrada nueva descrita arriba. Los
cierres previos **2.11 y 11.14** mantienen su alcance documentado. La perdida
del log focal intermedio y la causa PostgreSQL desconocida siguen declaradas;
no se usan esos resultados ni el rerun focal para suplir el gate final.

Progreso confirmado: **92/104**. El cierre local de las tareas 1-4 del plan esta
completado; no lo estan el hito tecnico conjunto de 4+6 ni el hito productivo.
Permanecen abiertas **8.5, 9.7, 10.3-10.11 y 10.13**. CI remoto, enforcement,
revision de owner, procedencia v1 aprobada, adopcion, inspeccion real, backup,
restore, transicion y despliegue siguen requiriendo evidencia y autorizaciones
separadas. No se marca ninguna rama operativa como N/A sin su evidencia.

No hubo commits, push, PR, merge, publicacion, cambios administrativos ni
operaciones en VPS. Se conservan el worktree previo y la congelacion. **HOLD
permanece vigente**; este cierre no autoriza la fase siguiente.

## Autorizacion posterior de publicacion hacia develop

El usuario autorizo expresamente ejecutar la secuencia de revision, commits
atomicos en espanol con cuerpo, push de la feature y PR hacia develop, seguida
de verificacion de CI y revision requerida. La instruccion fue
`realiza la secuencia`. No autoriza merges, push a develop/master, cambios
administrativos, publicacion de release ni operaciones en VPS.

La revision inicial confirmo HEAD
`b5cddf3ec214de0e224de75fb0027a4f08b35591`, feature
`copilot-369-release-pipeline` y base remota develop
`1773164814e6e598388bfd1ee6bdbdb0c8673791`, tras fetch: cero commits remotos
exclusivos y 28 locales. Se revisaron los 27 commits de fuente Copilot 369 y
su merge local; son dependencia del pipeline y no se reescribe su historia.
Los cuatro blobs canonicos conservan los hashes aprobados.

El manifiesto de publicacion revisado cubre exactamente 134 archivos, con
45 grupos atomicos, mensajes Conventional Commits en espanol y cuerpos
explicativos. Los tres archivos congelados autorizados, sus fingerprints y
tests se mantienen en la misma unidad. Se excluyen caches/bytecode, herramientas
locales, worktrees, capturas y documentacion/OpenSpec no relacionados, sin
mover ni eliminar ese trabajo. El escaneo de formatos de credenciales no
encontro coincidencias de alta confianza en los candidatos ni en 69 blobs
historicos; no sustituye una auditoria de privacidad o licencia del texto fuente.

La evidencia de esta fase usa
`/tmp/opencode/copilot-369-publication-Ha8NYLbr/`. El indice estaba vacio;
el stage sera por rutas explicitas. Solo el arbol integrado final se validara
y publicara, no cada punto intermedio de la migracion coordinada.

La cuenta GitHub activa es bigalcah, igual que el unico CODEOWNER: no puede
autoaprobar su PR. Ese bloqueo de revision queda separado de abrir la PR y
ejecutar CI; no se cambia CODEOWNERS ni se simula aprobacion humana. La base
develop no esta protegida en la consulta inicial; la configuracion requerida
debe verificarse antes de cualquier integracion futura, no autorizada aqui.

El checkout actual del workflow PR puede usar un merge sintetico. La evidencia
remota debera distinguir head, base y SHA realmente comprobado, sin presentarlo
como validacion directa de otro commit. Hasta observar los resultados reales,
8.5 permanece abierta y el progreso es 92/104. **HOLD sigue vigente**.

### Commits, push y PR ejecutados

Se crearon los 45 commits nuevos del manifiesto revisado, con mensajes y cuerpos
exactos, padres lineales y sin trailers automaticos. Se conservaron los 28
commits anteriores. La verificacion independiente contrasto los 134 blobs y sus
bits ejecutables con el inventario autorizado; indice y archivos tracked
quedaron limpios. Los archivos ajenos excluidos permanecen sin stage.

Head resultante: `d10d7300ec64baf68f993d98ed7716c81618679e`.
Arbol Git: `dce6d07d5c2b7b8b2cad525a3fd13b3ff36088a8`.
El manifiesto, mensajes, staged diffs y hashes por grupo estan en la evidencia
privada de publicacion. No se reescribieron commits ni se omitieron hooks.

Antes del push se materializo ese commit mediante git archive, sin tocar el
worktree original. Se instalaron dependencias del lockfile y se ejecutaron
build, lint, 592/592 unitarios, 25/25 artifacts OpenSpec publicados, Hadolint de
ambos Dockerfiles, freeze/manifiesto 17/17 y harness completo: 103/103 integracion,
E2E interno 1/1, seis sesiones, preservacion y cleanup. Todos terminaron con
exit 0. Los 536 blobs rastreados siguieron identicos a Git tras las pruebas.
El conteo OpenSpec no incluye el draft local no relacionado de Home, excluido
de publicacion; no falta ningun requisito de este cambio.

Se hizo push exclusivamente de la feature y se abrio
<https://github.com/bigalcah/labeler/pull/10>, base develop. La rama remota coincide
con el head d10d730. Develop sigue en 1773164 y no se integro ningun cambio.

### CI remoto observado: bloqueo nuevo

Run: <https://github.com/bigalcah/labeler/actions/runs/39516284589>.
El run atribuye head d10d730 y base 1773164 a la PR 10. El log confirma checkout
del merge sintetico `559c02fdb24f97ab7584448659f825194b145fdb`; sus dos padres son
esa base y ese head. Su arbol es dce6d07, identico al arbol del head publicado.
No se confunde ese checkout con una ejecucion directa del SHA d10d730 ni con
un merge efectivo de la PR.

La validacion compartida termino en failure. Checkout, setup Node, dependencias,
build de imagen y lint completo pasaron. La seleccion unitaria ejecuto 592 tests:
591 satisfactorios, uno fallido, cero skips/cancelaciones/TODOs. Fallo el caso
de credenciales invalidas de `test/security-headers.browser.test.js:269`, con
`The browser layout probe did not report a rendered login error state` en
readLayoutProbe, linea 188. Se observaron Ubuntu 26.04.1 y Node 22.23.3; aun no
hay evidencia para atribuirles la causa ni para declarar defectuoso el login.

Los pasos posteriores del workflow compartido fueron skipped por ese fallo,
incluidos OpenSpec y el harness de integracion/E2E. Los checks individuales
ESLint, Markdown y Hadolint si terminaron en success. No se hizo rerun de CI,
no se debilitaron aserciones y no se modificaron workflows/pins/hashes para
ocultar el fallo. El log por job se recupero mediante API; el intento inicial
de descarga global tuvo un timeout de red, separado del fallo de tests.

Los metadatos, logs, identidades y checks se conservan en la evidencia privada
de publicacion. Este registro posterior al CI queda local, sin nuevo commit
ni push documental que relance la misma validacion fallida sin una correccion.
El head publicado y comprobado sigue siendo d10d730.

8.5 permanece abierta, progreso 92/104. No hay revision aprobatoria en GitHub ni
se cambia el requisito actual del plan. Siguiente accion tecnica: diagnosticar
el probe de navegador en el runner limpio antes de corregirlo y renovar CI.
No hubo merge, cambio administrativo, publicacion de release ni operacion en
VPS. **HOLD permanece vigente**.

### Correccion autorizada del probe de navegador de PR 10

Tras el fallo remoto, el usuario autorizo diagnosticar y corregir exclusivamente
el test, validar, hacer commit/push en la misma feature y comprobar CI. No
autoriza cambios de UI, aserciones debilitadas, merges, administracion ni VPS.

La baseline local ordinaria paso; no se reprodujo sin instrumentacion el fallo
del runner Ubuntu 26.04 / Node 22.23.3. El ensayo controlado retraso cada callback
requestAnimationFrame del probe 1200 ms, manteniendo el presupuesto original de
Chrome en 1000 ms. El POST llego a /login y devolvio 401; el script del probe
respondio 200, pero el DOM capturado no contenia el output y la misma asercion
fallo. Con ese mismo retraso, publicar el resultado sincronamente paso las
aserciones de los tres anchos. Esto demuestra la dependencia temporal del
harness; no identifica el evento concreto de planificacion del runner remoto.

La correccion elimina solo el wrapper de dos frames: las medidas ya se calculaban
antes de esos callbacks y no cambian. Se conservan todas las aserciones, anchos,
presupuesto, opciones de Chrome y archivos de producto. No se anaden reintentos,
dependencias ni cambios del pipeline. La instrumentacion temporal fue retirada.

DOM, stderr, secuencia HTTP y TAP rojo/verde quedan en
`/tmp/opencode/pr10-browser-marker.bRFBr02a/`. El padre comprobo ademas con
Playwright el GET y POST real contra una fixture sintetica sin DB: error 401,
alert accesible y card centrada sin overflow a 375, 768 y 1280 px. Capturas y
registro estan en `/tmp/opencode/copilot-369-browser-qa-XiQERQDq/`; los logs de
consola/red estan excluidos de Git en `.playwright-mcp/`. Servidor y pagina de
esa comprobacion fueron cerrados; el driver temporal fue eliminado.

El worktree de revision aislado parte de d10d730 e incluye solamente la
correccion del test, con SHA-256
`159a21ac62484309dece089e1d4b14aefb9a1d46621e28f2d41ce72b08377d21`.
El padre ejecuto alli la suite focal 3/3, lint completo y OpenSpec estricto
25/25, todos exit 0. Los diagnosticos LSP de esa copia exacta fueron limpios;
en el worktree principal agotaron su tiempo. Freeze/manifiesto pasan 17/17.
El build local termino correctamente. La seleccion completa nueva paso 592/592,
cero skips/cancelaciones/TODOs, en 78 archivos, con la imagen configurada. El
primer intento omitio esa variable y termino con exit 2 antes de ejecutar tests;
su log se conserva separado, sin sobrescribirlo ni presentarlo como aprobado.

El intento posterior de harness fue interrumpido por el limite externo de la
herramienta a los 20 minutos, menor que los 30 minutos internos ya fijados en el
test. El gate anterior de d10d730 habia durado 27 minutos y 32 segundos; no se
atribuyo la interrupcion a un fallo del producto. El E2E hostil parcial paso 1/1,
pero faltan el resultado integrado, preservacion y recibo final: ese intento es
incompleto. Se verifico la identidad y se eliminaron solo sus cuatro contenedores
descartables, tres volumenes, red e imagen de fixture. La base labeling-database
06db6b9aa40b permanecio intacta. Se conserva la evidencia parcial y se ejecuto un
intento nuevo con directorio distinto y paciencia externa suficiente, sin
cambiar ningun timeout interno, asercion ni contrato. No se presenta aun como
aprobado ni como evidencia remota.

HOLD y 8.5 siguen abiertos. La revision tecnica por agente no sustituye la
revision humana independiente requerida ni habilita un merge.

### Gate final de la correccion antes de publicar

El intento completo nuevo termino con exit 0 en 26 minutos y 42 segundos:
103/103 integracion en los 14 archivos, E2E 1/1 y harness 1/1, sin fallos,
skips ni cancelaciones. Coinciden las siete parejas de fingerprints, incluidas
primaria 369, validacion 30 y persistencia posterior al retiro. El recibo acredita
dos proyectos ausentes, ocho contenedores, dos redes, seis volumenes y una imagen
de fixture eliminados, ambos propietarios de handoff limpios y directorio
temporal eliminado. El padre verifico recibos, hash del log, ausencia de los
proyectos y mismo hash del test. Solo sigue la base local preexistente.

La evidencia esta en
`/tmp/opencode/copilot-369-browser-qa-XiQERQDq/deployment-full-evidence.M2qVXl/`.
El recorder `browser-repair-clean-deployment-full.json` conserva comando, imagen,
tiempos y exit code; el SHA-256 de su log es
`88189fa337231636f9ad93383b735f3cd42d1890884ae773ccedee9be4bd4809`.

La unica revision tecnica de este delta devolvio APPROVE, confianza alta y cero
bloqueos, para el codigo y la evidencia de navegador/unidad. La comprobacion del
harness posterior la realizo el padre, sin cambios de codigo tras esa revision.
No es aprobacion humana. La publicacion autorizada y el CI del nuevo SHA son
los pasos siguientes; 8.5 y HOLD siguen abiertos hasta sus gates efectivos.

### Resultado remoto de ab60217 y nueva autorizacion de harness

La correccion del probe se publico en
`ab60217a7cd4ace5e61c1de9a95733c5b258d69a`. El run
<https://github.com/bigalcah/labeler/actions/runs/39528315833> comprobo el merge
sintetico `d21b279640eb7bae2f80073e93e63e8cf1ba0b83`, con base 1773164 y ese
head; sus padres y arbol identico al head fueron verificados. Pasaron 592/592
unitarios, OpenSpec 25/25, build, lint y Hadolint. El navegador corregido paso
dentro de esa seleccion completa.

El harness remoto fallo despues en la preparacion negativa sin contexto: el
comando no produjo el rechazo especifico esperado y el shell solo imprimio
`standalone preparation failed for an unexpected reason`. Integracion/E2E y
preservacion no llegaron a ejecutarse. El recibo marco `cleanupVerified=false`,
aunque ambos proyectos figuraron ausentes y el directorio temporal eliminado;
no se transforma esa ausencia parcial en una confirmacion global. El detalle
interno capturado no se imprimio y el run no dejo artifacts descargables. El log
conservado tiene SHA-256
`0b293f4cb4945d00af9b2e21fa92b1722ae190a68b1a259bc6bf77a109af8064`.

El usuario aprobo expresamente diagnosticar/corregir el nuevo fallo del harness,
validar y publicar en la misma PR, y solicito consulta a Oracle. La consulta
localizo prerrequisitos anteriores al rechazo de autoridad, sin identificar la
causa remota. No hay evidencia del UID del runner ni de su error interno; no se
atribuye el fallo a Ubuntu, Node o Compose.

### Reproduccion controlada y propuesta acotada de staging

La imagen real con Node UID/GID 1000 rechazo entradas sinteticas `0400` cuyo
dueno era 2000. Copias destinadas unicamente al contenedor, UID/GID 1000 y aun
`0400`, superaron las comprobaciones de lectura. Los originales del host
conservaron su dueno y modo. Para `existing` se ejercitaron el passfile, manifest
y archivo de backup mediante los lectores reales; solo la llamada externa
`pg_restore --list` fue sustituida en el ensayo focal sin DB. Esa prueba no
sustituye el retiro real sobre una base descartable del harness completo.

La copia de backup se renueva tras creacion, corrupcion y restauracion: el
checksum incorrecto sigue rechazado y la restauracion vuelve a validar. Los
diagnosticos de los dos probes emiten un esquema fijo con exit status, longitud
y booleanos de categorias conocidas; nunca el texto capturado ni credenciales.
Las pruebas de canarios y los rechazos exactos de contexto siguen obligatorios.
No se cambiaron consumidores de produccion, Compose, workflows, dependencias,
timeout interno ni el contrato del handoff `0:1000` / `0440`.

El primer handoff del ejecutor no conservo rutas de evidencia suficientes. El
padre rechazo ese cierre y solicito regresion ejecutable y registros nuevos,
incluidos passfile/backup. La evidencia retenida final esta en
`/tmp/opencode/pr10-container-inputs-20261020-01/evidence/final-run-20261020-03/`;
el ensayo previo de montaje fallido se explica por separado en
`fixture-mount-followup.md`, no como causa del CI. La validacion integrada y la
revision de este nuevo delta permanecen pendientes. HOLD y 8.5 siguen abiertos.

### Validacion final del staging de harness

El padre verifico la identidad byte a byte de los siete archivos de codigo en
un worktree aislado sobre ab60217, sin archivos locales ajenos. Ejecuto el
ensayo de lectura en la imagen real y los contratos 15/15, ademas de lint y
sintaxis. Los seis JS tienen diagnosticos LSP limpios; Bash LSP no esta
instalado y su instalacion habia sido rechazada. `sh -n` paso sin errores.

La seleccion unitaria completa termino exit 0: **594/594**, 78 archivos, cero
skips/cancelaciones/TODOs. Solo despues se ejecuto el harness completo, exit 0:
**104/104** integracion en los mismos 14 archivos, incluido el nuevo caso de
lectores, E2E **1/1** y harness **1/1**. Ambos probes devolvieron status 1 y
`knownMarkerPresent=true`; las categorias de errores ajenos quedaron en false.
Se ejercitaron realmente preparacion y retiro sobre fixtures descartables,
incluidos el rechazo del backup corrupto y la continuacion posterior.

Las siete parejas de huellas antes/despues coinciden. El recibo final acredita
`cleanupVerified=true`, ambos proyectos ausentes, propietarios del handoff
limpios y directorio temporal eliminado. El padre cotejo los recibos y hashes
de logs, las parejas de huellas y la ausencia de operaciones sobre la base
preexistente, que conserva el mismo ID 06db6b9aa40b.

Evidencia nueva:
`/tmp/opencode/pr10-harness-parent-udYfZ9Gp/final-gate-evidence.TPfEMq/` y
recorder `harness-repair-unit` / `harness-repair-deployment` en el directorio
privado de publicacion. Sus logs tienen respectivamente SHA-256
`b89f31182004abf0201c0aa1d4095936dc2559bd5a7a0b89498c94bf61fdebe9` y
`a4b4a9f7e0cbbee2bfcef33a1a87b918c7ea3a22943e58fcd23aa0ac046f6e42`.
La imagen local utilizada fue
`sha256:ea93bee0582e56666fc3ad4e96f3f816276c39666a9ef2dac0efe570d1f3b5a1`;
los archivos de producto no cambiaron. Build, OpenSpec 25/25 y freeze/manifiesto
17/17 tambien pasaron sobre sus entradas conservadas.

La unica revision tecnica de gate de este delta devolvio APPROVE con confianza
alta, sin bloqueos para el codigo y la evidencia focal. El padre comprobo los
gates completos posteriores sin cambios del codigo revisado. Esa revision no
es aprobacion humana, ni demuestra la causa del error interno del runner.
La publicacion y el CI del siguiente SHA siguen siendo gates separados; no se
cierran 8.5, HOLD ni controles administrativos con estos resultados locales.

### CI de d74d69b y portabilidad de fixtures

Los tres commits autorizados se publicaron con head
`d74d69b9ac986789ec4284df7fd601fafeda8ecd`. El run
<https://github.com/bigalcah/labeler/actions/runs/39547725259> comprobo el merge
`3052c89e68cc67cc952a4475a10f6ef193e94e04`, base 1773164 y arbol igual al head.
Pasaron 594/594 unitarios, OpenSpec 25/25, lint, build y ambos probes con sus
rechazos exactos. Tambien pasaron prepare con lock, HTTP privado y E2E hostil.
La integracion alcanzo los 14 archivos: 88/104, con 16 fallos, cero omisiones.
El E2E interno y la ventana final de preservacion no llegaron a completarse.
La limpieza si quedo confirmada (`cleanupVerified=true`), sin convertir el
resultado de workload fallido en un gate satisfactorio. HOLD siguio vigente.

El log nuevo expuso siete fallos por el prefijo temporal fijo `/tmp/opencode`,
dos rechazos de ownership de entradas del controlador y seis fallos anteriores
a la admision esperada de perfiles/normalizacion. El caso restante era una
fixture de lectura cuyo modo de directorio dependia de umask. Oracle reviso los
contratos y mantuvo el arreglo dentro de las fixtures, sin cambios de Runtime,
validadores, Compose de producto, pipeline, dependencias ni politicas de UID.
El UID real del runner no se registro y no se infiere como un numero concreto.

Se conservaron originales privados del host y copias `1000:1000/0400` para Node.
El controlador Python de mantenimiento sigue ejecutandose realmente en el host:
solo su copia de entorno con tres claves verificadas de metadata no secreta
es `0444`; la copia de request es `1000:<GID primario del host>/0440` bajo un
ancestro privado, y la password permanece en otra copia `0400`. Un lector
controlado UID 21001 pudo leer entorno/request y validar metadata de password,
pero no sus bytes; Node UID 1000 si pudo leer su password. No se amplio ninguna
allowlist ni se ejecuto Node como root.

Los ensayos usan ahora el temporal del sistema, con sufijos unicos y recibos
privados conservados. Se separaron copias privadas para Node y PostgreSQL usando
la identidad verificada de cada imagen, sin chown de originales por el driver.
La readiness de la fixture PostgreSQL exige TCP, no su servidor Unix temporal;
no se cambiaron contadores de retries ni timeouts. Los siete ensayos focales
pasaron con umask `077`, originales de dueno controlado ajeno y ventanas SQL
readonly no vacias, conservando fallos de backup/runtime/smoke/rollback,
interrupciones, floor y publicaciones originales.

El caso de lectura se reprodujo con padre `2000:2000/0700`: el manifiesto
`1000/0400` era inaccesible por travesia. Cambiar solo el padre a
`0711` hizo legible el manifest, manteniendo ilegible el archivo `2000/0400`.
La fixture fija explicitamente los seis padres de travesia y restaura ownership
al limpiar; las aserciones de permisos, corrupcion y restauracion no se reducen.

Se retienen pruebas rojo/verde en `/tmp/opencode/normalization-readers-61b48b20/`,
`/tmp/opencode/runtime-rehearsal-repair-20261021-a72c90b6/` y
`/tmp/opencode/pr10-existing-mode-a91f/`. La revision del padre detecto dos
aserciones que podian mostrar contenido de entorno o snapshots de integridad
al fallar. Sus regresiones demostraron el problema antes de sustituir solamente
la salida por comparaciones booleanas con mensajes fijos, sin reducir campos
comparados. El padre repitio lectores, ambos umasks y backup real sobre una copia
byte-identica de los trece archivos finales; evidencia propia en
`/tmp/opencode/pr10-fixture-portability-64iefAZj/`. El nuevo gate completo y su
revision estan pendientes; las pruebas focales no sustituyen su resultado.

### Comprobacion del entorno local y unidad final

El primer intento de unidad con este delta se interrumpio al agotar el limite
externo de herramienta de 900000 ms. No devolvio estado del hijo ni conservo
salida final; se clasifica incompleto, no como un fallo de aserciones demostrado
ni como un pase. El ejecutor elimino solo su temporal inspeccionado y no dejo
procesos o contenedores propios. La reconciliacion de esa ejecucion esta en
`qa-unit-incomplete.md` dentro de la evidencia privada nueva.

El padre comparo la misma orden de Chrome sobre `about:blank` con un TMPDIR
anidado largo y otro corto. El primero aborto con `Socket path too long` en
`process_singleton_posix`, mientras el segundo devolvio HTML y exit 0. Esto
demuestra que el entorno largo elegido no era valido para los sockets Unix de
Chrome; no recupera el resto de la salida perdida del intento anterior. Se
retuvieron ambos logs y se eliminaron exclusivamente sus perfiles descartables.
No se modificaron flags de navegador, tests o timeouts internos para ocultarlo.

Con una raiz corta nueva y recorder de salida directa a disco desde el inicio,
la misma seleccion completa de unidad termino exit 0: **594/594**, 78 archivos,
cero fallos, skips, cancelaciones o TODOs, en 8 minutos y 5 segundos. La metadata
y el log son `unit-short-temp.json` y `unit-short-temp.log`, SHA-256 del log
`73f9443692db31919f24019b3ee75a48c69135d78b9412b3ca8241c95ce14b9b`.
La imagen es
`sha256:ed9e413fe980092fa5676ca911721edf3da2bd0407f1b12d785c8881004d4566`,
con entradas de producto sin cambios. El harness completo usa otra raiz corta
y evidencia nueva; todavia no se presenta como completado ni como CI remoto.

### Gate integrado final de las fixtures portables

El harness completo termino exit 0 en 28 minutos y 12 segundos con esa misma
imagen y los trece archivos de codigo sin cambios: **106/106** integracion en
los 14 archivos, E2E **1/1** y harness **1/1**, cero fallos, skips, cancelaciones
o TODOs. Se ejecutaron los 104 casos existentes, incluidos los 16 fallidos en
CI, y los dos nuevos casos de lectores. El padre verifico metadata, hashes de
logs, recibos y comparacion byte a byte con los archivos principales.

Las siete parejas de huellas coinciden. Los siete recibos de ensayos reales
acreditan originales preservados, SQL readonly no vacio y ausencia de sus
recursos asignados. Se conservan las fases, floors y publicaciones esperadas
en fallos, rollback e interrupciones. El recibo del harness confirma ambos
proyectos ausentes, ambos propietarios del handoff limpios y
`cleanupVerified=true`, con directorio temporal eliminado. El padre verifico
ademas la ausencia de contenedores, redes y volumenes de esos proyectos; la
base preexistente 06db6b9aa40b sigue intacta.

Recibos finales en
`/tmp/opencode/pr10-fixture-portability-64iefAZj/final-gate-evidence/` y siete
recibos hermanos conservados bajo la raiz corta `/tmp/opencode/d.EGHRriKK/`.
Metadata y salida completa son `deployment-short-temp.json` y
`deployment-short-temp.log`, SHA-256 del log
`83508bf82775c343cbe2a28b45ef580742e48f1b729f265048626f29b3dfd5a1`.
Los logs/recibos son privados; no representan un backup, una restauracion ni
un despliegue de produccion. La revision unica final y el CI del nuevo SHA son
los siguientes gates. HOLD, 8.5 y los controles humanos siguen abiertos.

La unica revision final de este delta devolvio APPROVE con confianza alta y
cero bloqueos despues de inspeccionar los trece archivos, los recibos completos
y la evidencia focal. No requirio cambios de codigo. Se procede solo a la
publicacion autorizada de la feature y la comprobacion de CI del nuevo head;
la aprobacion tecnica por agente no sustituye revision humana ni autoriza merge.
