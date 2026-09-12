# Rollback seguro

Este procedimiento aplica cuando ya existe al menos un descarte. La versión anterior no conoce el estado privado nuevo y
solo puede consultar la base mediante un rol sin privilegios de escritura. El procedimiento está documentado, pero la
aceptación real del backup cifrado y restore externo sigue `PENDING`.

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

## Rollback de solo lectura

1. Detén el stack actual sin eliminar el volumen:

   ```bash
   docker compose --env-file deployment/.env -f deployment/docker-compose.yml down
   ```

2. Crea o verifica, fuera del flujo de despliegue, un rol `labeling_readonly` sin privilegios `INSERT`, `UPDATE`, `DELETE`,
   `TRUNCATE`, `CREATE`, `ALTER` ni `DROP`. Guarda su contraseña en un archivo externo protegido y configura su ruta
   absoluta mediante `ROLLBACK_DATABASE_PASSWORD_HOST_PATH`; si procede, cambia el nombre mediante
   `ROLLBACK_DATABASE_USER`. El launcher monta el archivo solo de lectura y entrega su ruta como `DATABASE_PASS_FILE`.

3. Selecciona la imagen anterior y arranca exclusivamente el launcher de rollback:

   ```bash
   ROLLBACK_SERVER_IMAGE=seart/labeling-server:<version-anterior> \
   docker compose --env-file deployment/.env \
     -f deployment/docker-compose.rollback-readonly.yml up --build -d
   ```

   Este archivo no incluye `labeling-study-prepare`, no ejecuta migraciones ni bootstrap, y configura PostgreSQL con
   `default_transaction_read_only=on`.

4. Comprueba el health check y usa la aplicación solo para lectura. No ejecutes formularios de clasificación o descarte
   contra esta base.

## Rollback escribible

Un rollback escribible **solo** está permitido restaurando un backup verificado, creado antes del primer descarte, en otra base de datos aprobada. Detén el stack, restaura el archivo y su manifiesto verificados en ese destino separado, valida
su identidad y checksum, y apunta allí una instalación aislada de la versión anterior.

Nunca restaures sobre `labeling-data`, nunca pruebes la restauración en producción, nunca uses `down -v` como rollback y
nunca conviertas el launcher de solo lectura en una ruta de escritura sobre la base que contiene descartes.

## Evidencia pendiente

Siguen pendientes la aceptación real del backup cifrado y restore externo, el E2E histórico de aislamiento con tres
sesiones, el E2E completo en el VPS público y el cierre documental formal. La captura GitHub live también sigue pendiente.
Este runbook conserva el backup tooling y describe una ruta no destructiva, pero no afirma que ninguna de esas evidencias
se haya reunido.
