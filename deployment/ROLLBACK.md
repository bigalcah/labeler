# Rollback seguro

Este procedimiento separa la recuperación de la aplicación de la recuperación de PostgreSQL. La
release automática conserva directorios inmutables y las referencias `current` y `previous`. La
versión anterior solo puede consultar una base que contenga decisiones privadas nuevas mediante un
rol sin privilegios de escritura. El procedimiento está documentado, pero la aceptación real del
backup cifrado y restore externo sigue `PENDING`.

## Frontera entre `current` y `previous`

`current` identifica la release que atiende producción. `previous` identifica la release anterior
que el launcher conservó después de una verificación exitosa. Cada release permanece en
`LABELER_DEPLOY_ROOT/releases/<release-id>/` con exactamente `Caddyfile`,
`docker-compose.yml` y `release-manifest.json`; la evidencia queda en
`LABELER_DEPLOY_ROOT/evidence/<release-id>/<utc-attempt>/`. El archivo `.env`, los secretos
externos, los backups y el volumen `labeling-data` no están dentro de esos directorios.

El launcher mantiene además `state/highest-generation`, `state/active-schema-version`,
`state/deployment` y el lock exclusivo `locks/deploy.lock` bajo `LABELER_DEPLOY_ROOT`.

Un fallo de preflight, descarga, lock o backup no cambia `current` ni ejecuta la preparación. Un
fallo del preparador tampoco permite publicar el servidor nuevo. Si el smoke test falla después de
reemplazar la aplicación, conserva logs y metadatos antes de decidir la recuperación. No apuntes
`current` a una release antigua a mano ni borres la release fallida.

El rollback de imagen puede activar `previous` solo si su manifiesto declara compatibilidad con el
esquema que ya existe en `labeling-data`. Activar una imagen anterior no deshace una migración. Si
la compatibilidad no está declarada, la única recuperación escribible es la restauración verificada
descrita más abajo, en un destino separado o aprobado. Ninguna ruta automática usa `down -v` ni
elimina el volumen persistente.

## Backup antes de preparar

Cada release debe completar un backup de estudio antes de ejecutar `labeling-study-prepare`. El
launcher ejecuta el archivo externo configurado en `LABELER_BACKUP_COMMAND` y exige que su salida
contenga exactamente `STUDY_BACKUP_VERIFIED`. El backup es un requisito de la secuencia de
despliegue, no una tarea posterior al smoke test. Si falla, el launcher conserva `current`, no
ejecuta migraciones nuevas y conserva la salida para diagnóstico.

El backup del estudio es distinto del backup legacy requerido por `STUDY_DATABASE_MODE=existing`.
Para el retiro legacy, crea y verifica primero el backup externo con `npm run backup:legacy`, la
confirmación `LEGACY_RETIREMENT_CONFIRM=retire-legacy-labeler` y el overlay `existing`. No uses el
backup operativo como sustituto de esa protección.

## Backup cifrado y retención

El backup operativo del estudio se crea desde el host, fuera del stack público. Requiere PostgreSQL client, OpenSSL y
rutas absolutas externas para todos los archivos. La contraseña de PostgreSQL y la clave de cifrado se entregan solo
mediante archivos `0400` o `0600`; no se aceptan secretos inline. Define:

```dotenv
PGHOST=<host-produccion>
PGPORT=5432
PGDATABASE=<base-produccion>
PGUSER=<rol-backup>
PGPASSFILE=/absolute/external/backup.pgpass
STUDY_BACKUP_ARCHIVE=/absolute/external/backups/study-<timestamp>.dump.enc
STUDY_BACKUP_MANIFEST=/absolute/external/backups/study-<timestamp>.manifest.json
STUDY_BACKUP_ENCRYPTION_KEY_FILE=/absolute/external/backup-encryption-key
STUDY_BACKUP_RETENTION_DAYS=30
```

Ejecuta `npm run backup:study`. El proceso transmite `pg_dump --format=custom` directamente a OpenSSL AES-256-CBC con
PBKDF2-SHA256 y 600000 iteraciones; no crea un dump intermedio sin cifrar. Falla si un destino ya existe. El manifiesto
incluye la identidad de origen, el checksum SHA-256 del archivo cifrado, la política de cifrado, los días de retención y
fingerprints de `pr_cards`, `pr_classification` y `participant_account`, incluidos hashes y `credential_version`. Se
excluyen solamente los datos transitorios de `app_session`, `login_ip_attempt`, `login_csrf_context` y
`github_api_telemetry_event`.

`STUDY_BACKUP_RETENTION_DAYS` es un input obligatorio del manifiesto, no una autorización de borrado. El almacenamiento
externo debe conservar cada pareja archivo/manifiesto al menos ese número de días y aplicar su política fuera de esta
herramienta. Conserva además cualquier backup requerido por una migración o por obligaciones de recuperación aunque haya
superado esa edad. La herramienta nunca poda ni reemplaza archivos.

## Verificación de restore aislado

Precrea una base vacía en un PostgreSQL desechable que no use el host, puerto y nombre de la base productiva. Su passfile
debe ser externo y protegido. Configura, además de las variables del backup y la identidad productiva anterior:

```dotenv
STUDY_RESTORE_CONFIRM=isolated-restore
STUDY_RESTORE_PGHOST=<host-aislado>
STUDY_RESTORE_PGPORT=5432
STUDY_RESTORE_PGDATABASE=<base-vacia-aislada>
STUDY_RESTORE_PGUSER=<rol-restore>
STUDY_RESTORE_PGPASSFILE=/absolute/external/restore.pgpass
```

Ejecuta `npm run restore:study:verify`. Antes de escribir, el comando verifica manifiesto, checksum, cifrado, legibilidad
del archive e identidad de producción; rechaza el mismo nombre de base o un destino que ya contenga tablas en `public`.
Después restaura exclusivamente con las credenciales del destino y compara conteos y fingerprints de tarjetas,
clasificaciones y credenciales. Un resultado válido imprime `ISOLATED_STUDY_RESTORE_VERIFIED`.

No uses `labeling-data`, el Compose productivo ni sus credenciales como destino. Conserva como evidencia operativa la
pareja archivo/manifiesto, la identidad no secreta del destino aislado, la salida final y un snapshot del volumen
productivo antes y después. Sin esa ejecución real, la aceptación de restore de OpenSpec 9.5 permanece abierta. La
presencia de la herramienta y este runbook no equivale a una restauración aceptada.

## Rollback de imagen mediante el launcher

Usa la ruta de rollback del launcher autorizada para la VPS. La operación no recibe un release ID:
selecciona la release referenciada por `previous` y se invoca como `rollback`.

```bash
LABELER_DEPLOY_ROOT=/absolute/external/labeler \
LABELER_ENV_FILE=/absolute/external/labeler/deployment.env \
LABELER_BACKUP_COMMAND=/absolute/external/labeler/bin/backup-study \
LABELER_PUBLIC_BASE_URL=https://<PUBLIC_HOSTNAME> \
/absolute/path/to/deployment/deploy-vps.sh rollback
```

No reconstruyas desde un checkout ni sustituyas el digest por `latest`. Antes de activar la release
anterior, el launcher confirma en su manifiesto `schemaCompatibility.applicationSupports` para el
esquema de `state/active-schema-version`, conserva el manifiesto y los logs del intento fallido y
verifica que el volumen siga siendo `labeling-data`.

La operación debe volver a esperar el health check de PostgreSQL, el servidor y Caddy, y comprobar
`LABELER_PUBLIC_BASE_URL/login` desde fuera del stack. Solo después de esa comprobación el launcher
intercambia `current` y `previous`: la release que estaba activa queda en `previous` y la anterior
pasa a `current`. Si la verificación falla, el launcher intenta restaurar la aplicación que estaba
activa y conserva la evidencia. No encadenes varios cambios de imagen sin registrar cada resultado.

## Rollback de solo lectura

1. Detén el stack actual sin eliminar el volumen:

   ```bash
   docker compose --env-file "$LABELER_ENV_FILE" \
     -f "$LABELER_DEPLOY_ROOT/current/docker-compose.yml" down
   ```

2. Crea o verifica, fuera del flujo de despliegue, un rol `labeling_readonly` sin privilegios `INSERT`, `UPDATE`, `DELETE`,
   `TRUNCATE`, `CREATE`, `ALTER` ni `DROP`. Guarda su contraseña en un archivo externo protegido y configura su ruta
   absoluta mediante `ROLLBACK_DATABASE_PASSWORD_HOST_PATH`; si procede, cambia el nombre mediante
   `ROLLBACK_DATABASE_USER`. El launcher monta el archivo solo de lectura y entrega su ruta como `DATABASE_PASS_FILE`.

3. Selecciona la imagen anterior y arranca exclusivamente el launcher de rollback:

   ```bash
   ROLLBACK_SERVER_IMAGE=ghcr.io/<owner>/<server-image>@sha256:<server-digest-anterior> \
   docker compose --env-file "$LABELER_ENV_FILE" \
     -f /absolute/path/to/docker-compose.rollback-readonly.yml up --no-build --wait -d
   ```

   Esta ruta manual es un fallback aislado para lectura cuando el launcher de release no puede
   completar el rollback normal. Usa una copia aprobada externa de la composición read-only y no
   depende del checkout del repositorio de la aplicación. No cambia `current` ni `previous`, no incluye
   `labeling-study-prepare`, no ejecuta migraciones ni bootstrap, y configura PostgreSQL con
   `default_transaction_read_only=on`.

4. Comprueba el health check y usa la aplicación solo para lectura. No ejecutes formularios de clasificación o descarte
   contra esta base.

## Restauración escribible de PostgreSQL

Una recuperación escribible **solo** está permitida restaurando un backup verificado creado antes del primer descarte.
Para recuperar una preparación, el backup debe ser anterior a esa preparación. Usa otra base de datos aprobada y detén
el stack afectado, restaura el archivo y su manifiesto verificados en ese destino separado, valida
su identidad y checksum, y apunta allí una instalación aislada de la versión anterior. La
restauración no es un paso automático del launcher y no debe ejecutarse sobre el volumen productivo.

Nunca restaures sobre `labeling-data`, nunca pruebes la restauración en producción, nunca uses
`down -v` como rollback y nunca conviertas el launcher de solo lectura en una ruta de escritura
sobre la base que contiene descartes. Tampoco reviertas migraciones SQL para intentar que una
imagen antigua funcione.

## Evidencia pendiente

Siguen pendientes la aceptación real del backup cifrado y restore externo, el E2E histórico de aislamiento con tres
sesiones, el E2E completo en el VPS público y el cierre documental formal. La captura GitHub live también sigue pendiente.
Este runbook conserva el backup tooling y describe una ruta no destructiva, pero no afirma que ninguna de esas evidencias
se haya reunido.
