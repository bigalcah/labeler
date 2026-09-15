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

La producción debe seguir ejecutándose y permanecer intacta durante toda esta prueba. En una VPS sin checkout, no
detengas ni reinicies el stack, no uses `labeling-data`, no uses la red productiva y no montes sus credenciales. La fuente
de verdad de la referencia es `images.server` en
`<LABELER_DEPLOY_ROOT>/current/release-manifest.json`; comprueba que coincide con la referencia del contenedor activo
`labeling-server` y úsala exactamente, siempre fijada por digest. No la sustituyas por `latest`, una etiqueta reutilizable
ni una imagen reconstruida. Usa también la imagen `labeling-database` activa, fijada por digest.

Conserva el par de backup fuera del directorio de release. El archivo cifrado, el manifiesto, la clave y el passfile deben
seguir con permisos `0400` o `0600`, según su propietario y consumidor. Comprueba esos permisos y no los relajes para
resolver errores de un bind mount. Bajo user namespaces, un bind mount puede ser ilegible dentro de Docker aunque el
archivo sea legible en el host. El patrón seguro es transmitir cada entrada por stdin a volúmenes Docker efímeros.

Define rutas externas y valores no secretos que coincidan con el manifiesto, sin poner contraseñas en variables, argumentos
ni logs:

```dotenv
STUDY_BACKUP_ARCHIVE=/absolute/external/backups/study-<timestamp>.dump.enc
STUDY_BACKUP_MANIFEST=/absolute/external/backups/study-<timestamp>.manifest.json
STUDY_BACKUP_ENCRYPTION_KEY_FILE=/absolute/external/backup-encryption-key
STUDY_RESTORE_PGPASSFILE=/absolute/external/restore.pgpass
ISOLATED_POSTGRES_PASSWORD_FILE=/absolute/external/isolated-postgres-password
PGHOST=<host-produccion-del-manifiesto>
PGPORT=5432
PGDATABASE=<base-produccion-del-manifiesto>
PGUSER=<rol-del-manifiesto>
STUDY_RESTORE_PGDATABASE=<base-vacia-aislada>
STUDY_RESTORE_PGUSER=<rol-restore>
```

Ejecuta en la VPS el siguiente patrón. El passfile externo debe contener la entrada del destino aislado, y el archivo de
`ISOLATED_POSTGRES_PASSWORD_FILE` debe contener únicamente la contraseña de ese destino. No se muestran valores reales.

```bash
set -eu

attempt_utc="$(date -u +%Y%m%dT%H%M%SZ)"
restore_id="${attempt_utc}-$$"
evidence_dir="/absolute/external/evidence/study-restore-${restore_id}"
mkdir -p "$evidence_dir"
chmod 0700 "$evidence_dir"

current_server_image="$(docker inspect --format '{{.Config.Image}}' labeling-server)"
current_database_image="$(docker inspect --format '{{.Config.Image}}' labeling-database)"
case "$current_server_image" in *@sha256:*) ;; *) exit 1 ;; esac
case "$current_database_image" in *@sha256:*) ;; *) exit 1 ;; esac
manifest_server_line="$(grep -F '"server":' /absolute/external/labeler/current/release-manifest.json)"
case "$manifest_server_line" in *"$current_server_image"*) ;; *) exit 1 ;; esac
printf '%s\n' "$manifest_server_line" > "$evidence_dir/current-manifest-server-line.txt"
printf '%s\n' "$attempt_utc" > "$evidence_dir/utc.txt"
printf '%s\n' "$current_server_image" > "$evidence_dir/current-server-image.txt"
printf '%s\n' "$current_database_image" > "$evidence_dir/current-database-image.txt"

for input_file in \
    "$STUDY_BACKUP_ARCHIVE" \
    "$STUDY_BACKUP_MANIFEST" \
    "$STUDY_BACKUP_ENCRYPTION_KEY_FILE" \
    "$STUDY_RESTORE_PGPASSFILE" \
    "$ISOLATED_POSTGRES_PASSWORD_FILE"; do
    mode="$(stat -c '%a' "$input_file")"
    case "$mode" in 400|600) ;; *) exit 1 ;; esac
done
sha256sum "$STUDY_BACKUP_ARCHIVE" "$STUDY_BACKUP_MANIFEST" > "$evidence_dir/backup-checksums.sha256"
archive_basename="$(basename -- "$STUDY_BACKUP_ARCHIVE")"
manifest_basename="$(basename -- "$STUDY_BACKUP_MANIFEST")"
manifest_archive_file="$(awk -F'"' '$2 == "archiveFile" {print $4; exit}' "$STUDY_BACKUP_MANIFEST")"
manifest_archive_basename="$(basename -- "$manifest_archive_file")"
archive_container_path="/restore-inputs/$archive_basename"
manifest_container_path="/restore-inputs/$manifest_basename"
test -n "$archive_basename"
test -n "$manifest_basename"
test "$manifest_archive_file" = "$manifest_archive_basename"
test "$archive_basename" = "$manifest_archive_basename"

network="labeling-restore-net-${restore_id}"
database_volume="labeling-restore-db-${restore_id}"
init_volume="labeling-restore-init-${restore_id}"
input_volume="labeling-restore-input-${restore_id}"
secret_volume="labeling-restore-secret-${restore_id}"
database_container="labeling-restore-db-${restore_id}"
verifier_container="labeling-restore-verifier-${restore_id}"
for volume_name in "$database_volume" "$init_volume" "$input_volume" "$secret_volume"; do
    if docker volume inspect "$volume_name" >/dev/null 2>&1; then exit 1; fi
done
if docker network inspect "$network" >/dev/null 2>&1; then exit 1; fi
test "$database_volume" != labeling-data

docker volume create "$database_volume" >/dev/null
docker volume create "$init_volume" >/dev/null
docker volume create "$input_volume" >/dev/null
docker volume create "$secret_volume" >/dev/null
docker network create --internal "$network" >/dev/null

cleanup() {
    exit_code="$?"
    docker rm -f "$verifier_container" "$database_container" >/dev/null 2>&1 || true
    docker volume rm "$input_volume" "$secret_volume" "$init_volume" "$database_volume" >/dev/null 2>&1 || true
    docker network rm "$network" >/dev/null 2>&1 || true
    printf '%s\n' "$exit_code" > "$evidence_dir/cleanup.exit"
    trap - EXIT
    exit "$exit_code"
}
trap cleanup EXIT

server_user="$(docker image inspect --format '{{.Config.User}}' "$current_server_image")"
test -n "$server_user"
stage_input() {
    source_path="$1"
    target_path="$2"
    docker run --rm --interactive --user 0 \
        --mount "type=volume,src=$input_volume,dst=/restore-inputs" \
        --entrypoint sh "$current_server_image" \
        -eu -c 'umask 077; cat > "$1"; chmod 0600 "$1"; chown "$2" "$1"' \
        sh "$target_path" "$server_user" < "$source_path"
}
stage_input "$STUDY_BACKUP_ARCHIVE" "$archive_container_path"
stage_input "$STUDY_BACKUP_MANIFEST" "$manifest_container_path"
stage_input "$STUDY_BACKUP_ENCRYPTION_KEY_FILE" /restore-inputs/backup-encryption-key
stage_input "$STUDY_RESTORE_PGPASSFILE" /restore-inputs/restore.pgpass

docker run --rm --interactive --user 0 \
    --mount "type=volume,src=$secret_volume,dst=/restore-secret" \
    --entrypoint sh "$current_server_image" \
    -eu -c 'umask 077; cat > /restore-secret/postgres-password; chmod 0600 /restore-secret/postgres-password' \
    < "$ISOLATED_POSTGRES_PASSWORD_FILE"

docker run --detach --name "$database_container" \
    --network "$network" --network-alias isolated-postgres \
    --mount "type=volume,src=$database_volume,dst=/var/lib/postgresql/data" \
    --mount "type=volume,src=$init_volume,dst=/docker-entrypoint-initdb.d,volume-nocopy" \
    --mount "type=volume,src=$secret_volume,dst=/run/secrets,readonly" \
    --env POSTGRES_DB="$STUDY_RESTORE_PGDATABASE" \
    --env POSTGRES_USER="$STUDY_RESTORE_PGUSER" \
    --env POSTGRES_PASSWORD_FILE=/run/secrets/postgres-password \
    "$current_database_image" >/dev/null

for readiness_attempt in $(seq 1 120); do
    if docker exec --user postgres "$database_container" \
        psql --no-psqlrc --dbname="$STUDY_RESTORE_PGDATABASE" --tuples-only --no-align \
        --command='SELECT 1' > "$evidence_dir/target-select-1.txt" 2> "$evidence_dir/target-select-1.err" \
        && grep -Fxq 1 "$evidence_dir/target-select-1.txt"; then
        break
    fi
    if [ "$readiness_attempt" -eq 120 ]; then exit 1; fi
    sleep 1
done

docker inspect "$database_container" > "$evidence_dir/isolated-database.inspect.json"
docker volume inspect labeling-data > "$evidence_dir/production-volume-before.json"

set +e
docker run --name "$verifier_container" \
    --network "$network" \
    --mount "type=volume,src=$input_volume,dst=/restore-inputs,readonly" \
    --env STUDY_RESTORE_CONFIRM=isolated-restore \
    --env STUDY_BACKUP_ARCHIVE="$archive_container_path" \
    --env STUDY_BACKUP_MANIFEST="$manifest_container_path" \
    --env STUDY_BACKUP_ENCRYPTION_KEY_FILE=/restore-inputs/backup-encryption-key \
    --env STUDY_RESTORE_PGPASSFILE=/restore-inputs/restore.pgpass \
    --env PGPASSFILE=/restore-inputs/restore.pgpass \
    --env PGHOST="$PGHOST" --env PGPORT="$PGPORT" \
    --env PGDATABASE="$PGDATABASE" --env PGUSER="$PGUSER" \
    --env STUDY_RESTORE_PGHOST=isolated-postgres \
    --env STUDY_RESTORE_PGPORT=5432 \
    --env STUDY_RESTORE_PGDATABASE="$STUDY_RESTORE_PGDATABASE" \
    --env STUDY_RESTORE_PGUSER="$STUDY_RESTORE_PGUSER" \
    --entrypoint node "$current_server_image" scripts/verify-study-restore.js \
    > "$evidence_dir/verify.stdout" 2> "$evidence_dir/verify.stderr"
verify_exit="$?"
set -e
printf '%s\n' "$verify_exit" > "$evidence_dir/verify.exit"
docker inspect "$verifier_container" > "$evidence_dir/isolated-verifier.inspect.json" || true
docker network inspect "$network" > "$evidence_dir/isolated-network.inspect.json" || true
docker volume inspect labeling-data > "$evidence_dir/production-volume-after.json"
set +e
sha256sum --check "$evidence_dir/backup-checksums.sha256" > "$evidence_dir/backup-checksums.raw.txt" 2>&1
checksum_exit="$?"
set -e
awk -F': ' '{if ($NF == "OK") print "OK"; else if ($NF == "FAILED") print "FAILED"; else print "ERROR"}' \
    "$evidence_dir/backup-checksums.raw.txt" > "$evidence_dir/backup-checksums.verify.txt"
rm -f "$evidence_dir/backup-checksums.raw.txt"
printf '%s\n' "$checksum_exit" > "$evidence_dir/backup-checksums.exit"

if [ "$verify_exit" -ne 0 ] || [ "$checksum_exit" -ne 0 ] \
    || ! grep -Fxq ISOLATED_STUDY_RESTORE_VERIFIED "$evidence_dir/verify.stdout"; then
    exit 1
fi
grep -Fx ISOLATED_STUDY_RESTORE_VERIFIED "$evidence_dir/verify.stdout" > "$evidence_dir/marker.txt"
```

La red creada con `--internal` solo contiene el PostgreSQL desechable y el verificador. El volumen de PostgreSQL es
único y distinto de `labeling-data`; el volumen de entradas solo se monta de lectura en el verificador. El contenedor de
PostgreSQL recibe únicamente su propio secreto de contraseña, nunca el archivo cifrado, el manifiesto, la clave o el
passfile del backup. El volumen de inicialización vacío evita sembrar tablas antes de la prueba.

`pg_isready` puede indicar que el servidor acepta conexiones antes de que exista la base solicitada. Por eso el bucle
anterior no lo trata como prueba de existencia: espera un `SELECT 1` real contra `STUDY_RESTORE_PGDATABASE`. El verificador
comprueba que el destino está vacío, restaura con las credenciales aisladas y compara tarjetas, clasificaciones y
credenciales, incluida `credential_version`. La evidencia debe conservar checksum, UTC, código de salida, marcador,
volumen productivo antes y después, imágenes, montajes, red y limpieza. La pareja archivo/manifiesto original se conserva.

Un resultado válido debe contener exactamente `ISOLATED_STUDY_RESTORE_VERIFIED`. Hasta ejecutar esta prueba real y revisar
esa evidencia, la aceptación de restore de OpenSpec 9.5 permanece `PENDING`; este runbook no reclama evidencia runtime ni
cambia las tareas 10.2 a 10.4.

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
