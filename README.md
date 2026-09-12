# Labeler

## Estudio de clasificación de PR

La preparación del estudio admite exactamente dos perfiles, en este orden:

1. `pr-card-sorting-local`, con 300 tarjetas y los participantes visibles
   `javier`, `diego` y `pablo`. Sus usernames de login son `javier`, `diego` y `pablo`.
2. `pr-card-sorting-validation-30`, con 30 tarjetas y los mismos participantes visibles. Sus
   usernames de login son `javier-30`, `diego-30` y `pablo-30`.

La muestra de 300 tarjetas procede del CSV canónico. La muestra de 30 se deriva de ese CSV de
forma determinista. Ambos perfiles usan la misma membresía ordenada para cada participante, pero
sus categorías, clasificaciones, descartes, observaciones y progreso son privados y están
acotados al `study_id` del estudio.

El `study_id` autorizado procede de la cuenta y de la sesión de servidor. El username solo busca
la cuenta y el sistema no interpreta el sufijo `-30`. No existe selector de participante ni de
estudio, no se aceptan conteos arbitrarios y no hay UI administrativa. La aplicación tampoco
ofrece exportación HTTP ni la ruta `/export`; el operador exporta desde fuera del servidor.

## Release automático a la VPS

Cada `push` a `master` inicia `.github/workflows/release.yml`. El job `quality` invoca la
validación compartida y debe completar los gates de calidad, integración y E2E antes de que
`build`, `publish` o `deploy` puedan avanzar. Un fallo termina el intento sin publicar imágenes ni
contactar la VPS. `develop`, las ramas de pull request y cualquier otra rama no despliegan
producción.

El job `build` construye `labeling-server` y `labeling-database` desde el mismo commit. El job
`publish` publica referencias con tag `sha-<GITHUB_SHA>` en GHCR, resuelve el digest y genera el paquete
`release-package-<release-id>.tar.gz`, donde `<release-id>` es
`<GITHUB_RUN_NUMBER>-<GITHUB_RUN_ATTEMPT>-<GITHUB_SHA>`. La etiqueta sirve para trazabilidad; la
referencia efectiva siempre es `ghcr.io/<owner>/<image>:sha-<commit>@sha256:<64-hex>`. No uses `latest`,
una etiqueta reutilizable ni un digest incompleto.

El manifiesto que valida el launcher es `release-manifest.json` y debe ser inmutable dentro del
paquete. Su contrato incluye `schemaVersion=1`, `releaseId`, `generation`, el commit de 40
caracteres hexadecimales, `images.server` y `images.database` como referencias completas por
digest, `csv.sha256` y `schemaCompatibility.produces` junto con
`schemaCompatibility.applicationSupports`. El checksum corresponde al CSV canónico y los digests
deben corresponder al commit del manifiesto.

La entrada del paquete contiene exactamente `Caddyfile`, `docker-compose.yml` y
`release-manifest.json`. El workflow transmite el archivo por la entrada estándar de un canal
OpenSSH que solicita `deploy <release-id>`. La cuenta restringida no acepta comandos arbitrarios y
deja que
`deployment/deploy-vps.sh deploy <release-id>` haga el preflight. La VPS no necesita un checkout
del repositorio y no debe reconstruir imágenes de producción.

El job `deploy` usa el entorno protegido `production` y las secrets `VPS_HOST`, `VPS_USER`,
`VPS_KNOWN_HOSTS` y `VPS_SSH_PRIVATE_KEY`. La cuenta SSH solo puede invocar el launcher autorizado.
El token con permiso de lectura de GHCR y las credenciales de PostgreSQL, sesión, cuentas,
enriquecimiento y backup permanecen en la VPS. GitHub Actions no recibe ni transfiere esos secretos.
La VPS no ejecuta un runner autoalojado; las imágenes se construyen en runners administrados por
GitHub.

El launcher exige estas variables externas de host, sin secretos inline:

```dotenv
LABELER_DEPLOY_ROOT=/absolute/external/labeler
LABELER_ENV_FILE=/absolute/external/labeler/deployment.env
LABELER_BACKUP_COMMAND=/absolute/external/labeler/bin/backup-study
LABELER_PUBLIC_BASE_URL=https://<PUBLIC_HOSTNAME>
```

`LABELER_BACKUP_COMMAND` debe ser un archivo ejecutable absoluto, fuera de `LABELER_DEPLOY_ROOT`,
y su salida debe contener exactamente `STUDY_BACKUP_VERIFIED`. El launcher rechaza `PGPASSWORD` y
`STUDY_BACKUP_ENCRYPTION_PASSPHRASE` como secretos inline.

El layout persistente es:

```text
<LABELER_DEPLOY_ROOT>/
  releases/<release-id>/
  evidence/<release-id>/<utc-attempt>/
  state/highest-generation
  state/active-schema-version
  state/deployment
  locks/deploy.lock
  current -> releases/<release-id>
  previous -> releases/<release-id>
```

La secuencia fail-closed es: lock exclusivo, validación del paquete y del manifiesto, renderizado
de `docker compose config`, descarga e inspección de imágenes, backup verificado, PostgreSQL
saludable, `labeling-study-prepare`, servidor y Caddy con `--no-build --wait`, y smoke test HTTPS
de `LABELER_PUBLIC_BASE_URL/login`. Solo después del smoke test se publican `current` y `previous`.
Cada intento conserva manifiesto, configuración, pull, inspección, backup, health checks, smoke
test y diagnósticos.

La imagen del servidor contiene el CSV canónico en `/labeling/data/pr-cards.csv`; Compose usa esa
ruta como `STUDY_CSV_PATH`. Por tanto, la preparación no depende de `plans/` ni de un workspace del
runner en la VPS. El `.env`, los secretos externos y el volumen `labeling-data` quedan fuera del
paquete y no se sustituyen durante la release.

La recuperación de imagen solo puede usar `previous` si su manifiesto declara compatibilidad con el
esquema activo. No revierte migraciones ni elimina `labeling-data`. Si la compatibilidad no está
declarada, sigue [`deployment/ROLLBACK.md`](deployment/ROLLBACK.md) para restauración verificada en
un destino separado. La adopción inicial de una VPS existente está separada del primer release
automático: sigue el [`checklist de adopción`](docs/VPS-ADOPTION-CHECKLIST.md) y registra el digest
activo sin inventar evidencia de backup, restore o despliegue público.

## Despliegue local y configuración base

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

### 2. Generar los manifiestos de cuentas

Cada manifiesto se genera fuera de Docker y contiene únicamente hashes Argon2id. Los archivos de
contraseñas quedan fuera del repositorio. El manifiesto del perfil actual usa `javier`, `diego` y
`pablo`; el de validación usa `javier-30`, `diego-30` y `pablo-30`, en el orden de los
participantes visibles.

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

El ejemplo genera el manifiesto del perfil actual. Para el perfil de validación usa un archivo de
configuración y un manifiesto separados, con `expectedCardCount` igual a `30` y los usernames
`javier-30`, `diego-30` y `pablo-30`. No reutilices el manifiesto ni las contraseñas entre perfiles.

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

El bootstrap de perfiles valida todos los descriptores, CSV, manifests, checksums, conteos y
asignaciones de login antes de escribir. Después prepara `pr-card-sorting-local` con 300 tarjetas
y, solo si esa fase termina, `pr-card-sorting-validation-30` con 30. Cada perfil crea o reutiliza
su estudio, participantes, tarjetas y membresía sin sobrescribir decisiones existentes. `reviewer`
se conserva mientras existan referencias estructurales desde membresías, cuentas, categorías o
clasificaciones del MVP. El despliegue no carga fixtures legacy de labels o instancias.

Los manifests contienen hashes, deben permanecer con permiso `0400` y Compose los monta solo en
`labeling-study-prepare`. `labeling-server` no recibe los archivos ni las contraseñas de
participantes.

### 4. Validar y levantar en local

Los comandos de esta sección son para un entorno local. En la VPS de producción no ejecutes
`docker compose up --build` desde un checkout: usa el paquete, el launcher y `--no-build` del
release automático.

`STUDY_DATABASE_MODE` usa `clean` por defecto. Después de que PostgreSQL esté saludable, el servicio
`labeling-study-prepare`:

1. valida todos los insumos de los dos perfiles antes de iniciar escrituras;
2. aplica las migraciones aditivas de base del estudio;
3. inventaria objetos legacy del etiquetador anterior;
4. prepara primero el perfil de 300 y después el de 30;
5. deja ambos estudios en `READY` antes de que la aplicación y Caddy puedan quedar listos;
6. falla si encuentra cualquier objeto legacy;
7. prepara los participantes configurados y las tarjetas PR canónicas solo si la guarda anterior pasó.

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

## Validación local del CSV y perfiles

El importador admite campos multilinea entrecomillados y JSON incrustado. La validación del
descriptor confirma que solo existen los perfiles aprobados, sus conteos, usernames y fuentes:

```bash
npm ci
npm run validate:study-profiles
npm run import:csv -- plans/merged_after_rework_cards_seed_20260510.csv /tmp/pr-cards.json
npm run docs:study-check -- --root .
```

La preparación coordinada se ejecuta después de validar el descriptor y procesa siempre 300 antes
de 30:

```bash
npm run prepare:study-profiles
```

El comando requiere `STUDY_PROFILES_INPUT` y las rutas montadas que se describen en el overlay
`deployment/docker-compose.clean.yml`. El CSV selecciona las tarjetas. GitHub solo puede enriquecer
snapshots de forma opcional durante `prepare`; no selecciona la muestra ni recibe llamadas desde la
aplicación web o el navegador.

## Enriquecimiento GitHub

El flujo opcional y prepare-only de snapshots GitHub, sus aliases, estados de endpoints, reglas de
repetición y restricciones de rollback están documentados en
[`deployment/GITHUB-ENRICHMENT.md`](deployment/GITHUB-ENRICHMENT.md).
La captura live sigue pendiente. Un perfil CSV-only no necesita token ni crea un run promovido.

## Exportación offline

El operador selecciona un único estudio con `--study-key` y un directorio externo que no exista.
La exportación exige estado `READY` y decisión terminal para todas las tarjetas de todos los
participantes configurados. Es una operación local y de solo lectura que genera
`results.csv`, `categories.csv` y `manifest.json`; no existe descarga desde el navegador, ruta HTTP
ni `/export`.

```bash
export STUDY_EXPORT_HMAC_SECRET_FILE="$HOME/.config/labeler/secrets/export-hmac"
npm run export:study -- \
  --study-key pr-card-sorting-validation-30 \
  --output "$HOME/.config/labeler/exports/validation-30"
```

La operación completa y sus requisitos están descritos en
[`docs/OPERATIONS.md`](docs/OPERATIONS.md).

## Estado de la evidencia

La implementación central y la validación E2E hostil aislada de los dos estudios están
completadas. Eso no convierte en evidencia ejecutada los entornos que aún no se han comprobado.
Siguen pendientes:

- backup y restore externo verificables;
- E2E hostil histórico de la tarea 10.2;
- E2E completo en VPS o entorno público;
- cierre documental histórico de la tarea 10.4;
- captura live de GitHub.

No se debe presentar ninguna de estas evidencias como completada hasta conservar sus resultados,
alcance, fecha y entorno.

## Documentation

- [Multi-study validation](docs/MULTI-STUDY-VALIDATION.md)
- [Participant guide](docs/PARTICIPANT-GUIDE.md)
- [Offline export runbook](docs/EXPORT-RUNBOOK.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Study workflow](docs/STUDY-WORKFLOW.md)
- [Development](docs/DEVELOPMENT.md)
- [JavaScript API](docs/JAVASCRIPT-API.md)
- [Operations](docs/OPERATIONS.md)
- [Troubleshooting](docs/TROUBLESHOOTING.md)
- [Maintenance](docs/MAINTENANCE.md)
- [Checklist de adopción y releases en VPS](docs/VPS-ADOPTION-CHECKLIST.md)
- [Contributing](CONTRIBUTING.md)
- [Security](SECURITY.md)
