# Labeler

## Configuración de despliegue

Define las credenciales de base en `deployment/.env`:

```dotenv
COMPOSE_PROJECT_NAME=labeling

DATABASE_NAME=labeling
DATABASE_USER=labeling_admin
DATABASE_PASS=<set-a-unique-local-password>
```

El bootstrap del estudio lee el CSV canónico de 300 tarjetas montado por Compose. Su configuración protegida crea o
reutiliza los participantes mediante `reviewer`, persiste `pr_cards` y gobierna la membresía del estudio. `reviewer` se
conserva mientras existan referencias estructurales desde membresías, cuentas, categorías o clasificaciones del MVP. El
despliegue no carga fixtures legacy de labels o instancias.

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

Abre `http://localhost:7755/login` después de que pase el health check del servidor. No uses `clean` con una base
existente que aún contenga objetos legacy. La guarda se detiene antes del bootstrap y nunca los elimina
automáticamente.

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
```

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

Reejecutar contra un volumen ya retirado sigue exigiendo backup verificado y confirmación, pero no reaplica la migración.
La eliminación final de objetos restantes pertenece a cambios posteriores, cuando no queden consumidores ni referencias.

Para rollback, detén el stack, restaura la versión anterior de la aplicación y restaura el backup verificado en una base
separada o en otro destino aprobado. Nunca uses borrado de volumen como rollback y nunca pruebes una restauración sobre
el volumen de producción.

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
