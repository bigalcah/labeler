# Copilot 369 operations runbook

## Scope and release hold

The product's primary study uses the canonical Copilot CSV at
`plans/copilot-369-cards.csv` and its sidecar
`plans/copilot-369-cards.manifest.json`. The CSV preserves the original 85-column
source and has SHA-256
`fad0881b9e40b1b68a577e84ad60c90d48fcebe79db8d55d05613fc1746794fb`.
The sidecar pins the source manifest, column header, provenance and ordered PR
identities. Exactly 369 unique PRs are used. The separate historical 300-card
CSV is retained only as the exact source for a protected transition of an
existing primary study, not as an ordinary product profile or fallback.

The release gate remains **HOLD**. The frozen shared validation still requires
300 cards and release still identifies the historical CSV. This runbook does
not authorize a release, merge to `master`, or deployment. See
[`COPILOT-369-RELEASE-HOLD.md`](COPILOT-369-RELEASE-HOLD.md). Resolving the gate
requires a separate, explicitly approved pipeline change.

## Source preparation and omissions

The original source and manifest used to create the packaged product copy are
external inputs. The preparation script currently reads them from
`/home/javier/Descargas/practica2/muestras_def/muestra_copilot.csv` and
`manifest.json`, then writes the canonical CSV copy and sidecar under `plans/`:

```bash
node scripts/prepare-copilot-369-source.js
```

Do not run this command with different inputs or treat it as a routine refresh.
It requires the pinned original CSV and source-manifest checksums and verifies
their provenance before writing. Runtime validation reads the packaged CSV and
sidecar. The import validates the checksum, exact 85-column header, row count,
identities, order, URLs and JSON before database writes. Invalid JSON or
identity drift rejects the input; valid empty JSON collections remain distinct
from absent fields.

The source omits `repository_language` for three PRs and has no `evidence_text`
column for any of the 369 PRs. The importer reports those omissions with their
field, PR identities, reason, count and provenance. The corresponding values
are omitted, not inferred or replaced. The 37 reserve PRs are not in the
canonical source and are never imported.

## Ordinary preparation

An empty, isolated study database is prepared from exactly two ordered profiles:
the primary 369-card profile followed by the validation 30-card profile. The
descriptor example is
[`test-data/copilot-369/profiles/profiles.json`](../test-data/copilot-369/profiles/profiles.json);
its neighboring config and account files are examples for test/preparation
contracts, not production credentials. Account manifests must be generated and
protected outside the repository using the approved credential process.

The normal preparation command is:

```bash
npm run prepare:study-profiles
```

It reads `STUDY_PROFILES_INPUT` and the mounted profile inputs. The exact
approved CSV names, checksums, counts, participant identities and order are
enforced by the profile reader. GitHub enrichment is disabled for these
profiles. The 369 CSV determines the sample; no GitHub API credential or
network request is needed for classification.

Before running this command, use the deployment's documented preparation
sequence and verify that all inputs are the intended approved profiles. On an
empty study database, normal preparation creates the 369 and 30 studies in
order. If both approved studies already exist and validate, preparation returns
them via read-only checks. It does not bootstrap, reprovision credentials,
import cards, refresh snapshots or enrich either existing study. A partial
pair, a historical 300-card primary, or any drift fails closed. The historical
primary requires the dedicated transition below; do not try to make ordinary
preparation accept it.

The schema must have migration `014_copilot_369_cardinality` applied after
`013`. It permits stored counts 30, 300 and 369 to support legacy records, but
does not authorize creating a new 300-card primary. Preserve the existing
validation-30 CSV, manifest, fixture, membership, decisions, accounts and
snapshots. Do not reset or regenerate those artifacts as part of primary
preparation.

## Existing primary: protected 300-to-369 transition

This is a separate maintenance operation, not an ordinary bootstrap or
deployment command. It preserves the primary study identity and participant
accounts while replacing its ordered card membership. It is permitted only
when all expected legacy identity, configuration, source checksum and exact
300 ordered memberships match; the target source is valid; there are no primary
classifications, discards or dependent history; and the database matches the
pinned PostgreSQL 17 schema contract through migration 014. Unknown schema,
migration history, dependencies, drift or concurrent writers block the
operation. Never remove or detach history to make it pass.

### Before scheduling

1. Obtain an explicitly approved maintenance window and a separately approved
   recovery target. Create and verify the required external backup through the
   approved backup process. The cutover command does not create or attest a
   backup, stop services, or verify a restore.
2. Stop the application, all study preparation processes, enrichment writers
   and schema writers. Keep them stopped for the entire operation. The CLI
   accepts a maintenance attestation; it does not perform or verify these
   stops.
3. Obtain the exact existing study UUID/key, persisted legacy config and all
   300 ordered membership values (`pr_card_id`, `source_card_id`, `ordinal`,
   `source_checksum`) from the operator's verified source of truth. Do not
   guess, derive or copy real database identifiers into documentation or an
   unprotected request file.
4. Confirm migration 014 is already applied and the database schema is exactly
   the pinned PostgreSQL 17 contract. This command does not run migrations.
5. Use the CLI's own help as the authoritative current request contract:

   ```bash
   node scripts/cutover-copilot-369.js --help
   ```

### Request and execution

Create a protected request file outside the repository, with permissions
restricted to the operator. The following is a shape example only. Replace
every placeholder from verified operator records; it is deliberately not a
usable request and contains no real database identity or credentials:

```json
{
  "confirmation": "cutover-primary-300-to-copilot-369",
  "maintenance": {
    "applicationStopped": true,
    "preparationStopped": true,
    "enrichmentStopped": true,
    "schemaWritersStopped": true
  },
  "expectedStudyId": "<verified-study-uuid>",
  "expectedStudyKey": "pr-card-sorting-local",
  "expectedLegacyConfig": "<exact-persisted-legacy-config>",
  "expectedLegacyChecksum": "4051c10c39a1634aa80d9018aa53b59fd6009fdc4d7f2526d5e73708b02f53ef",
  "expectedTargetChecksum": "fad0881b9e40b1b68a577e84ad60c90d48fcebe79db8d55d05613fc1746794fb",
  "expectedLegacyMemberships": "<all-300-exact-ordered-memberships>",
  "legacyCsvPath": "<verified-historical-300-csv-path>",
  "targetCsvPath": "<canonical-copilot-369-csv-path>",
  "targetManifestPath": "<canonical-copilot-369-sidecar-path>",
  "database": {
    "host": "<approved-database-host>",
    "port": 5432,
    "database": "<approved-database-name>",
    "user": "<approved-database-role>",
    "passwordFile": "<absolute-protected-external-password-file>"
  }
}
```

The placeholders above must be replaced with values of the exact types shown
by `--help`; do not use this illustrative JSON as-is. Passwords belong only in
the protected external password file. Never put secrets in request JSON, shell
arguments, environment dumps, logs or documentation. Run only after the
preconditions and backup have been independently confirmed:

```bash
node scripts/cutover-copilot-369.js --request /absolute/protected/operator-request.json
```

The command performs a read-only preflight, then a transaction with advisory,
table and study locks and a second precondition check. A valid transition
updates only the primary study's source/configuration/count and ordered
`study_card` memberships. Compatible pre-existing `pr_cards` may be reused
only without updates. It does not backfill or update `pr_cards`, alter accounts
or participant memberships, alter snapshots, move/delete history, detach
references, disable triggers or run migrations. Any failure rolls the
transaction back. Do not retry after investigating a failure unless the
preconditions have been independently re-established.

An already matching 369 primary returns `ALREADY_369` after read-only
verification. It does not rewrite state. A successful transition reports
`CUTOVER_369`. Neither response indicates release readiness or deployment.

After a primary is prepared, participants use the existing private card-sorting
flow: each participant sees the same ordered sample, while categories,
classifications, discards, remarks and progress remain private. The existing
comparison CSV route and its eligibility checks remain the product export; no
offline export command or package is provided. Do not treat 300-card history as
a second active primary.

### Recovery and stop conditions

On any mismatch, unknown schema/history, lock conflict or rollback, stop and
preserve the database for investigation. Do not use `down -v`, remove a volume,
detach historical references, run a destructive downgrade or reset
credentials. Recovery is a separate approved operation: stop writers and
restore a verified backup only to a separately approved target. Never restore
over the protected 30-card study or use production-volume deletion as rollback.

## Verification evidence and limits

Executed on 2026-10-17 using source fixtures and UUID-owned disposable PostgreSQL
17.6 containers, without a real database or real credentials:

- The combined `copilot-369` suite passed 81 tests, with zero failures or skips.
  It includes source validation, migration, persistence, ordinary preparation,
  cutover, concurrent writers, rollback and real HTTP authentication/privacy.
- The complete unit selection passed 559 tests with zero failures or skips when
  run sequentially. The default concurrent run exposed an unrelated intermittent
  login-layout browser assertion; its isolated three-test suite also passed.
- Export and private-route characterization passed 44 tests, including exact
  368-of-369 incompletion and 8/11-column comparative CSVs.
- Deployment wiring, hardening and frozen-pipeline checks passed 22 tests.
- Projection/provider regressions passed 20 tests. A separate driver compared
  all 30 historical card projections and rendered HTML with the `develop`
  baseline and found deep-identical projections and byte-identical rendering.
- The server image built locally; a network-disabled, read-only container
  verified the five packaged source/manifest checksums and read 369 cards.
- Parent-run browser QA authenticated synthetic primary and validation accounts,
  checked primary cards at 1280/768/375 pixels and validation cards at 1280/375,
  found no horizontal overflow, confirmed missing-language omission and sanitized
  malicious Markdown, and observed zero requests to GitHub hosts.
- Full JavaScript, CSS and root Markdown lint passed, along with scoped runbook
  and task Markdown checks, strict OpenSpec validation and Dockerfile lint.
- The final independent gate review returned `APPROVE` without blocking issues.
  It independently ran 87 focused tests, seven preparation integration tests and
  two cutover cases in a separate locked review worktree. The parent also reran
  all 81 new tests successfully from that review copy.

These overlapping test groups must not be added into a single test total.
The reproducible combined-suite command is:

```bash
node --test --test-concurrency=1 test/copilot-369-*.test.js test/copilot-369-*.integration.js
npm run lint:js
```

Run database integration tests only in the disposable fixture environment they
create. Parent evidence is retained locally under
`/tmp/opencode/copilot-369-evidence`: `isolated-tests.tap`, `unit-tests-serial.tap`,
`review-copy-tests.tap`, `manual-qa.json`, primary and validation
viewport screenshots, missing-language and safe-Markdown screenshots, and the
isolated QA server transcript. The server transcript contains only explicitly
synthetic fixture credentials. Temporary evidence is not a production audit log.

None of this establishes a real-database preflight, verified external backup or
restore, release-pipeline compatibility, or public deployment. The release remains
on HOLD regardless of isolated test results.
