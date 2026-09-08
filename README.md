# Labeler

## Deployment configuration

Define the database credentials in `deployment/.env`:

```dotenv
COMPOSE_PROJECT_NAME=labeling

DATABASE_NAME=labeling
DATABASE_USER=labeling_admin
DATABASE_PASS=<set-a-unique-local-password>
```

The study bootstrap reads the canonical 300-card CSV mounted by Compose. Its protected configuration creates or reuses
the configured participants through `reviewer`, persists `pr_cards`, and owns study membership. The deployment does not
load the retired global-labeler fixtures.

## Clean database

`STUDY_DATABASE_MODE` defaults to `clean`. After PostgreSQL is healthy, the one-shot `labeling-study-prepare` service:

1. applies the non-destructive study foundation migration;
2. fails if any legacy labeler database object exists;
3. bootstraps the configured participants and canonical PR cards.

Only after that service exits successfully does `labeling-server` start:

```bash
docker compose --env-file deployment/.env -f deployment/docker-compose.yml up --build -d
```

Open `http://localhost:7755/login` after the server health check passes. Do not select `clean` for an existing database
that still contains legacy objects; the guard will stop before bootstrap rather than deleting them.

## Existing database retirement

Retirement is opt-in. First create and verify a legacy backup with `npm run backup:legacy` using absolute archive and
manifest paths outside this repository. Keep those files read-only and retain the previous application image for
rollback. Then add the following values to `deployment/.env`:

```dotenv
STUDY_DATABASE_MODE=existing
LEGACY_RETIREMENT_CONFIRM=retire-legacy-labeler
LEGACY_BACKUP_DIRECTORY=/absolute/external/backup/directory
LEGACY_BACKUP_ARCHIVE_FILE=legacy.dump
LEGACY_BACKUP_MANIFEST_FILE=legacy.manifest.json
```

The one-shot service waits for PostgreSQL health, verifies both backup files and their database identity, checks the
legacy inventory, applies `schema/migrations/002_retire_legacy_labeler.sql`, and only then runs the study bootstrap. Any
missing confirmation, unreadable backup, checksum mismatch, partial schema, or migration failure prevents server
startup. Re-running against an already-retired volume still requires the verified backup and confirmation but does not
reapply the migration.

For rollback, stop the stack, restore the previous application version, and restore the verified backup into a separate
or otherwise approved database target. Never use volume deletion as rollback, and never test backup restoration against
the production volume.

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
