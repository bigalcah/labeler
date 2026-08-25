# Enriquecimiento GitHub

El enriquecimiento es opt-in y se ejecuta una sola vez durante `labeling-study-prepare`.
El servidor web no recibe credenciales ni realiza solicitudes GitHub: solo lee el run
completado y promovido para el estudio.

## Configuración

Usa un token fine-grained de solo lectura y limita el acceso a los repositorios de la
muestra. El routing debe coincidir exactamente con `owner/name`; no se aceptan prefijos
ni comodines.

```dotenv
GITHUB_ENRICHMENT_ENABLED=true
GITHUB_API_BASE=https://api.github.com
GITHUB_API_VERSION=2022-11-28
GITHUB_DEFAULT_ALIAS=
GITHUB_CREDENTIAL_ALIASES={"octo-org/example-repo":{"tokenEnv":"GITHUB_TOKEN","permissions":["metadata","pulls","contents","issues"]}}
GITHUB_TOKEN=<read-only-token-from-secret-store>
```

Los permisos declarados son la frontera mínima del cliente: metadata del repositorio,
pull requests, contenido/archivos e issues/comentarios. El token se monta o expone solo
al proceso prepare y nunca se persiste en páginas normalizadas, snapshots, logs o errores.
No habilites el proveedor si no existe una credencial para cada repositorio configurado.

## Ejecución y estados

El prepare valida el checksum del CSV, crea un run invisible y consulta metadata,
commits, files, reviews, issue comments y review comments. Timeline y diff son opcionales.
Las solicitudes tienen timeout de 30 segundos, concurrencia configurable de 1 a 8, hasta
cuatro intentos y presupuestos de cinco minutos por página y treinta minutos por run.

Un run solo puede quedar `COMPLETED` y promocionarse cuando existen los 300 snapshots y
todos los endpoints obligatorios terminaron correctamente. Los estados `COMPLETE_EMPTY`,
`UNAVAILABLE`, `TRUNCATED` y `FAILED` se conservan por endpoint; solo un run completo se
hace visible. Un fallo deja el run en `FAILED` y no altera tarjetas ni decisiones.

Para repetir una captura, ejecuta de nuevo el prepare con el mismo CSV después de revisar
el estado del run. El rerun crea un run nuevo y puede reutilizar validators de un run
completado; nunca actualiza una promoción existente. Un estudio que ya tiene decisiones
no puede recibir una promoción posterior. Los runs capturados permanecen inmutables y no
se trasladan ni reutilizan entre estudios.

## Operación y rollback

Antes de aplicar la migración `004_github_pr_api_enrichment`, crea y verifica el backup
externo requerido por `STUDY_DATABASE_MODE=existing`. Conserva el archivo, manifiesto y
la imagen anterior para rollback. La ruta de rollback de solo lectura está en
[`ROLLBACK.md`](./ROLLBACK.md) y usa
`docker-compose.rollback-readonly.yml`; no ejecuta preparación ni migraciones y fuerza
`default_transaction_read_only=on`.

Para recuperar escritura, restaura el backup pre-004 en otra base aprobada y apunta allí
una instalación aislada. Nunca borres `labeling-data`, ejecutes `down -v` como rollback,
restaures sobre producción ni conviertas el launcher read-only en una ruta de escritura.
