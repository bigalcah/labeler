# Labeler

## Configuración de despliegue

Define únicamente la configuración no secreta y las rutas externas de secretos en
`deployment/.env`:

```dotenv
COMPOSE_PROJECT_NAME=labeling

DATABASE_NAME=labeling
DATABASE_USER=labeling_admin
DATABASE_PORT=5432
PUBLIC_HOSTNAME=labeler.example.org
APP_ORIGIN=https://labeler.example.org
DATABASE_PASSWORD_HOST_PATH=/absolute/external/database-password
DATABASE_PASSWORD_DATABASE_HOST_PATH=/absolute/external/database-password-postgres
SESSION_SECRET_CURRENT_HOST_PATH=/absolute/external/session-current
SESSION_SECRET_PREVIOUS_HOST_PATH=/absolute/external/session-previous
```

Cada ruta de secreto debe ser absoluta, quedar fuera del repositorio y apuntar a un archivo
protegido. `DATABASE_PASSWORD_HOST_PATH` debe ser legible por el usuario Node y
`DATABASE_PASSWORD_DATABASE_HOST_PATH` por el usuario PostgreSQL del contenedor; ambos deben
contener la misma contraseña. Compose monta la segunda como `POSTGRES_PASSWORD_FILE` y la
primera como `DATABASE_PASS_FILE`. No guardes contraseñas, tokens, cookies ni secretos de sesión
en `deployment/.env`.

El bootstrap del estudio lee el CSV canónico de 300 tarjetas montado por Compose. Su configuración protegida crea o
reutiliza los participantes mediante `reviewer`, persiste `pr_cards` y gobierna la membresía del estudio. `reviewer` se
conserva mientras existan referencias estructurales desde membresías, cuentas, categorías o clasificaciones del MVP. El
despliegue no carga fixtures legacy de labels o instancias.

### Manifiesto de cuentas

Antes del despliegue, genera fuera de Docker el manifiesto de hashes de las cuentas con el mismo archivo de configuración
del estudio que usará el bootstrap:

```bash
npm run credentials:generate -- \
  --study-config /absolute/external/study-config.json \
  --output /absolute/external/study-account-manifest.json
chmod 0400 /absolute/external/study-account-manifest.json
```

El comando recibe una contraseña por participante mediante entrada estándar, o desde un descriptor indicado con
`--password-fd`; no las guardes en `deployment/.env`. Configura únicamente la ruta absoluta del archivo generado:

```dotenv
STUDY_ACCOUNT_MANIFEST_HOST_PATH=/absolute/external/study-account-manifest.json
```

El manifiesto contiene hashes, debe permanecer con permiso `0400` y Compose lo monta en modo lectura solo para
`labeling-study-prepare` como `/run/secrets/study-account-manifest.json`. `labeling-server` no recibe el archivo, su
ruta ni contraseñas de participantes.

## Base limpia

`STUDY_DATABASE_MODE` usa `clean` por defecto. Después de que PostgreSQL esté saludable, el servicio
`labeling-study-prepare`:

1. aplica la migración aditiva de base del estudio;
2. inventaria objetos legacy del etiquetador anterior;
3. falla si encuentra cualquier objeto legacy;
4. prepara los participantes configurados y las tarjetas PR canónicas solo si la guarda anterior pasó.

Solo después de que ese servicio termine correctamente arranca `labeling-server`:

```bash
docker compose --env-file deployment/.env -f deployment/docker-compose.yml up --build -d
```

Abre `https://labeler.example.org/login` después de que Caddy pase a depender del health check del servidor. Caddy es
el único borde público y publica 80 y 443; no se publica ningún puerto de la aplicación o PostgreSQL. No uses
`clean` con una base existente que aún contenga objetos legacy. La guarda se detiene antes del bootstrap y nunca los
elimina automáticamente.

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
