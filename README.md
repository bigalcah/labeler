# Labeler

## Despliegue local y VPS

El despliegue requiere Docker Compose, Node.js/npm, OpenSSL y un directorio externo para
secretos. Nunca guardes contraseñas, tokens, cookies ni secretos de sesión en el repositorio.

### 1. Preparar secretos externos

Usa rutas fuera del repositorio. El archivo que lee Node debe tener permiso `0400`; el archivo
que lee PostgreSQL debe poder ser leído por el usuario `postgres` (UID 70 dentro de la imagen,
por lo que `0444` es la opción portable para un bind mount local). Ambos archivos deben contener
la misma contraseña de PostgreSQL. Si el volumen ya existe, conserva la contraseña con la que fue
inicializado.

```bash
export LABELER_SECRETS="$HOME/.config/labeler/secrets"
export LABELER_BACKUPS="$HOME/.config/labeler/backups"
mkdir -p "$LABELER_SECRETS" "$LABELER_BACKUPS"
chmod 700 "$HOME/.config/labeler" "$LABELER_SECRETS" "$LABELER_BACKUPS"

read -r -s -p "Contraseña PostgreSQL existente: " DATABASE_PASSWORD
printf '\n'
printf '%s\n' "$DATABASE_PASSWORD" > "$LABELER_SECRETS/database-password"
printf '%s\n' "$DATABASE_PASSWORD" > "$LABELER_SECRETS/database-password-postgres"
unset DATABASE_PASSWORD
chmod 0400 "$LABELER_SECRETS/database-password"
chmod 0444 "$LABELER_SECRETS/database-password-postgres"

openssl rand -hex 32 > "$LABELER_SECRETS/session-current"
openssl rand -hex 32 > "$LABELER_SECRETS/session-previous"
chmod 0400 "$LABELER_SECRETS/session-current" "$LABELER_SECRETS/session-previous"
```

### 2. Generar el manifiesto de cuentas

El manifiesto se genera fuera de Docker y contiene únicamente hashes Argon2id. El archivo de
contraseñas generado queda fuera del repositorio; sus líneas corresponden a `javier`, `diego` y
`pablo`, en ese orden.

```bash
export LABELER_STUDY_CONFIG="$LABELER_SECRETS/study-config.json"
export LABELER_ACCOUNT_PASSWORDS="$LABELER_SECRETS/account-passwords.json"
export LABELER_ACCOUNT_MANIFEST="$LABELER_SECRETS/study-account-manifest.json"

cat > "$LABELER_STUDY_CONFIG" <<'JSON'
{"studyKey":"pr-card-sorting-local","expectedCardCount":300,"participants":["javier","diego","pablo"]}
JSON

node --input-type=module > "$LABELER_ACCOUNT_PASSWORDS" <<'NODE'
import {randomBytes} from "node:crypto";
process.stdout.write(JSON.stringify(Array.from({length: 3}, () => randomBytes(24).toString("base64url"))));
NODE
chmod 0400 "$LABELER_STUDY_CONFIG" "$LABELER_ACCOUNT_PASSWORDS"

npm run credentials:generate -- \
  --study-config "$LABELER_STUDY_CONFIG" \
  --output "$LABELER_ACCOUNT_MANIFEST" \
  < "$LABELER_ACCOUNT_PASSWORDS"
chmod 0400 "$LABELER_ACCOUNT_MANIFEST"
```

### 3. Configurar `deployment/.env`

Parte de la plantilla y reemplaza las rutas por las rutas absolutas reales:

```dotenv
COMPOSE_PROJECT_NAME=labeling

DATABASE_NAME=labeling
DATABASE_USER=labeling_admin
DATABASE_PORT=5432
PUBLIC_HOSTNAME=localhost
APP_ORIGIN=https://localhost
DATABASE_PASSWORD_HOST_PATH=/absolute/external/database-password
DATABASE_PASSWORD_DATABASE_HOST_PATH=/absolute/external/database-password-postgres
SESSION_SECRET_CURRENT_HOST_PATH=/absolute/external/session-current
SESSION_SECRET_PREVIOUS_HOST_PATH=/absolute/external/session-previous
STUDY_ACCOUNT_MANIFEST_HOST_PATH=/absolute/external/study-account-manifest.json
STUDY_DATABASE_MODE=clean
GITHUB_ENRICHMENT_ENABLED=false
```

Puedes comenzar con `cp deployment/.env.template deployment/.env` y editar los valores. El
archivo `deployment/.env` está ignorado por Git. `DATABASE_PASSWORD_HOST_PATH` debe ser legible
por Node y `DATABASE_PASSWORD_DATABASE_HOST_PATH` por PostgreSQL; Compose monta la segunda como
`POSTGRES_PASSWORD_FILE` y la primera como `DATABASE_PASS_FILE`.

El bootstrap del estudio lee el CSV canónico de 300 tarjetas montado por Compose. Su configuración protegida crea o
reutiliza los participantes mediante `reviewer`, persiste `pr_cards` y gobierna la membresía del estudio. `reviewer` se
conserva mientras existan referencias estructurales desde membresías, cuentas, categorías o clasificaciones del MVP. El
despliegue no carga fixtures legacy de labels o instancias.

El manifiesto contiene hashes, debe permanecer con permiso `0400` y Compose lo monta solo en
`labeling-study-prepare` como `/run/secrets/study-account-manifest.json`. `labeling-server` no
recibe el archivo ni las contraseñas de participantes.

### 4. Validar y levantar

`STUDY_DATABASE_MODE` usa `clean` por defecto. Después de que PostgreSQL esté saludable, el servicio
`labeling-study-prepare`:

1. aplica la migración aditiva de base del estudio;
2. inventaria objetos legacy del etiquetador anterior;
3. falla si encuentra cualquier objeto legacy;
4. prepara los participantes configurados y las tarjetas PR canónicas solo si la guarda anterior pasó.

Valida la interpolación antes de crear contenedores:

```bash
docker compose --env-file deployment/.env \
  -f deployment/docker-compose.yml \
  -f deployment/docker-compose.clean.yml config --quiet
```

Levanta las imágenes y el stack:

```bash
docker compose --env-file deployment/.env \
  -f deployment/docker-compose.yml \
  -f deployment/docker-compose.clean.yml up --build -d
```

Comprueba el resultado:

```bash
docker compose --env-file deployment/.env \
  -f deployment/docker-compose.yml \
  -f deployment/docker-compose.clean.yml ps
docker compose --env-file deployment/.env \
  -f deployment/docker-compose.yml \
  -f deployment/docker-compose.clean.yml logs labeling-study-prepare
curl --insecure --fail --silent --show-error https://localhost/login > /dev/null
```

El resultado esperado es `healthy` para `labeling-database`, `labeling-server` y
`labeling-caddy`, `Study ... is READY` en la preparación y HTTP 200 para `/login`. En local Caddy
usa un certificado interno, por eso `curl` necesita `--insecure`; en VPS se debe usar el hostname
público y un certificado TLS confiable. Caddy es el único borde público y publica 80/443; no se
publican los puertos de la aplicación ni PostgreSQL.

Para detener el stack sin borrar datos:

```bash
docker compose --env-file deployment/.env \
  -f deployment/docker-compose.yml \
  -f deployment/docker-compose.clean.yml down
```

No uses `down -v` sobre `labeling-data` salvo que hayas decidido borrar el volumen local.

`clean` es la ruta correcta para una base nueva o para una base que ya no contiene objetos legacy;
falla de forma segura si todavía encuentra objetos del etiquetador anterior. Usa siempre el overlay
explícito `deployment/docker-compose.clean.yml` para montar el descriptor y los dos perfiles 300/30.
Antes de ejecutar los comandos `clean`, define en `deployment/.env` los cuatro valores exclusivos
del overlay: `STUDY_PROFILES_INPUT_HOST_PATH`, `STUDY_CURRENT_CONFIG_HOST_PATH`,
`STUDY_VALIDATION_CONFIG_HOST_PATH` y `STUDY_VALIDATION_ACCOUNT_MANIFEST_HOST_PATH`.
Si la base contiene objetos legacy reales, no uses `clean`: sigue la ruta `existing` de la sección
siguiente. Los overlays `clean` y `existing` son mutuamente excluyentes.

## Retiro con base existente

El retiro es optativo, posterior y escalonado. No forma parte del arranque `clean` y no autoriza borrar tablas, rutas,
SQL legacy, fixtures ni datos por conveniencia. Primero crea y verifica un backup legacy con `npm run backup:legacy`,
usando rutas absolutas de archivo y manifiesto fuera de este repositorio. Mantén esos archivos en solo lectura y conserva
la imagen anterior de la aplicación para rollback. Después añade estos valores a `deployment/.env`:

```dotenv
STUDY_DATABASE_MODE=existing
LEGACY_RETIREMENT_CONFIRM=retire-legacy-labeler
LEGACY_BACKUP_DIRECTORY=/absolute/external/backup/directory
LEGACY_BACKUP_ARCHIVE_FILE=legacy.dump
LEGACY_BACKUP_MANIFEST_FILE=legacy.manifest.json
PGPASSFILE_HOST_PATH=/absolute/external/legacy-retirement.pgpass
```

`PGPASSFILE_HOST_PATH` apunta a un passfile externo protegido que el overlay
`deployment/docker-compose.existing.yml` monta solo en `labeling-study-prepare` durante la
ruta de retiro. Para el launcher de rollback de solo
lectura, configura también `ROLLBACK_DATABASE_PASSWORD_HOST_PATH` con el archivo externo de
la contraseña del rol `labeling_readonly`; no uses una variable de contraseña inline.

La secuencia protegida tiene estas fases:

1. PostgreSQL debe estar saludable y el backup externo debe tener archivo, manifiesto, checksum e identidad de base
   verificables.
2. `LEGACY_RETIREMENT_CONFIRM=retire-legacy-labeler` debe estar presente como confirmación explícita del operador.
3. El inventario legacy decide qué objetos pueden retirarse. `reviewer` queda protegido mientras cualquier dato o clave
   del MVP lo referencie directa o indirectamente.
4. Solo después de cumplir esas dependencias puede aplicarse `schema/migrations/002_retire_legacy_labeler.sql` para los
   objetos autorizados; la migración no es un reemplazo de inventario ni un permiso para usar `DROP CASCADE`.
5. El bootstrap del estudio se ejecuta después del retiro permitido. Si falta una confirmación, el backup no se puede
   leer, el checksum no coincide, el esquema está parcial o la migración falla, el servidor no arranca.

El retiro requiere el overlay explícito, que no se usa en modo `clean`:

```bash
docker compose --env-file deployment/.env \
  -f deployment/docker-compose.yml \
  -f deployment/docker-compose.existing.yml up --build -d
```

El overlay `existing` usa solo las variables compartidas y las de retiro documentadas arriba. No
requiere el descriptor de perfiles, las configuraciones current/validation, el CSV de validación ni
el manifiesto de cuentas de validación del overlay `clean`.

Reejecutar contra un volumen ya retirado sigue exigiendo backup verificado y confirmación, pero no reaplica la migración.
La eliminación final de objetos restantes pertenece a cambios posteriores, cuando no queden consumidores ni referencias.

Para rollback, detén el stack, restaura la versión anterior de la aplicación y restaura el backup verificado en una base
separada o en otro destino aprobado. Nunca uses borrado de volumen como rollback y nunca pruebes una restauración sobre
el volumen de producción.

## Backup cifrado del estudio

El backup operativo completo es distinto del backup legacy previo al retiro. `npm run backup:study` genera un dump
PostgreSQL de formato custom, cifra el flujo directamente con OpenSSL y publica de forma atómica el archivo cifrado y su
manifiesto en rutas absolutas externas. El manifiesto registra checksum SHA-256 del archivo cifrado, identidad de base,
retención y fingerprints de tarjetas, clasificaciones y cuentas, incluidos hash y `credential_version`. Los datos
transitorios de sesiones, límites de login, CSRF y telemetría no se incluyen.

La configuración, política de retención y verificación de restore se describen en
[`deployment/ROLLBACK.md`](deployment/ROLLBACK.md). La retención es responsabilidad del almacenamiento externo; la
herramienta nunca elimina backups ni sobrescribe destinos existentes.

## Local CSV validation

The importer supports multiline quoted fields and embedded JSON:

```bash
npm ci
npm run import:csv -- plans/merged_after_rework_cards_seed_20260510.csv /tmp/pr-cards.json
```

GitHub enrichment remains a separate provider concern; the deployment preserves the repository's GitHub fixture.

## GitHub enrichment

The optional, prepare-only GitHub snapshot workflow, aliases, endpoint states, rerun
rules, and rollback constraints are documented in
[`deployment/GITHUB-ENRICHMENT.md`](deployment/GITHUB-ENRICHMENT.md).

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Study workflow](docs/STUDY-WORKFLOW.md)
- [Development](docs/DEVELOPMENT.md)
- [JavaScript API](docs/JAVASCRIPT-API.md)
- [Operations](docs/OPERATIONS.md)
- [Troubleshooting](docs/TROUBLESHOOTING.md)
- [Maintenance](docs/MAINTENANCE.md)
- [Contributing](CONTRIBUTING.md)
- [Security](SECURITY.md)
