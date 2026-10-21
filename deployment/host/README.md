# Host Release V2 Controller

This consumer is installed separately on the host, before accepting a v2 package. Local tests do not authorize
installation, adoption, a production release, or cutover. HOLD remains in force. The consumer requires Python 3.10+
standard library, Bash, Docker Compose and curl; Node is used inside the server image, not on the host.

## Entrypoints

- Restricted SSH: `deployment/deploy-vps.sh`, with exactly `deploy <release-id>` or `rollback` in
  `SSH_ORIGINAL_COMMAND`. Direct arguments are not accepted on a forced SSH invocation.
- Local root only: `python3 -B deployment/release-host-control.py adopt`, `reconcile`,
  `maintenance <release-id>`, `maintenance normalize <release-id>`, `continue`, or `finalize-publication`.
- Innocuous local fingerprint: `python3 -B deployment/release-host-control.py --version`.
- `deploy` and `maintenance` consume the three-file tar/tar.gz package on stdin. Continuation reads the already
  installed, hash-bound candidate, not a replacement package. All stateful modes hold `locks/deploy.lock`.

## Normalization Checkpoint

`maintenance normalize <release-id>` is local-root only. Its external request `action` and receipt
`authorization.action` must both be exactly `maintenance-normalize`; ordinary `maintenance` authorizes only the
existing historical cutover and cannot authorize normalization. Restricted SSH still accepts only deploy/rollback.
The candidate image must contain the independently pinned 015 source
`53f8188e453101b9a06f16e1b2891c7538aecaed8e83b954d00cf3e6a4dbf951`.

The read-only observer uses `scripts/study-readiness.js --normalization-probe` with the restricted inspection role.
An exact retired catalog with ledger proof of 002 is inventory/normalization eligibility only, never app readiness.
Ordinary deploy rejects it before installation or database startup. Complete canonical 014 can be explicitly
normalized (DDL no-op plus 015); canonical with validated 015 is verified without rerunning the normalizer.

Before SQL the host verifies candidate images, source pin, mounts, healthy database endpoint and volume, stopped
writers, and a typed full custom backup with isolated restore. It durably reserves the candidate before raising the
floor and writes pending before creating the root-owned handoff. The child checks all four SQL identity fields,
including `serverVersion`. Host endpoint/volume are checked by the parent; only the raw four-field SQL observation
is passed as the mutation library baseline. Writer observations are never presented as grant-verified inspection.

All three eligible data origins (`empty`, `legacy300-v1`, `copilot369-v1`, including valid saved decisions) stop at
`normalization_verified`. A fresh restricted-role probe must independently prove canonical schema and actual valid
015 before the checkpoint is written. The step target is schema 3 plus the unchanged observed data bundle.
It never bootstraps, cuts over, starts/restarts runtime, changes pointers, publishes, or consumes the reservation,
even when the original data already matches the final release tokens.

A separately authorized local `continue` uses the same installed candidate, reservation and floor. The target may
change to the final schema/data pair only at this checkpoint. `origin` remains immutable and pre-015; the next
baseline comes from the verified checkpoint. Empty initialization and historical cutover require a new full backup
and isolated restore matching the normalized baseline; a pre-015 receipt fails before SQL. Empty uses ordinary
prepare once. Historical uses the existing `Runtime.maintenance()` migration/cutover entrypoints and still requires
both inventoried v1 pointers and zero primary history; valid decisions permit normalization, not cutover. That
cutover stops at its existing checkpoint and a fresh deploy of the same candidate can finish runtime/publication.
Copilot continues by readonly verification directly to runtime/smoke/publication, without prepare or migrations.

After a crash, `reconcile` is readonly: actual canonical catalog plus validated 015 can prove only the normalization
checkpoint, never generic cutover success. It preserves normalization intent through immutable predecessor receipts
even though the latest authorization is `reconcile`. Intact source needs a new `maintenance-normalize` authorization;
canonical without 015 does not prove commit, and drift/partial state remains blocked. Reconcile never writes SQL,
restarts services or repairs pointers; the existing exact surviving-reservation floor repair is its only floor change.

## External Host Configuration

The root-owned deployment root must already exist and must not be group/world writable. Configure these values in
the trusted host launch environment, not through client-supplied SSH environment forwarding:

```dotenv
LABELER_DEPLOY_ROOT=/absolute/host/state
LABELER_ENV_FILE=/absolute/external/production.env
LABELER_PUBLIC_BASE_URL=https://labeler.example
LABELER_BACKUP_COMMAND=/absolute/external/bin/full-backup-and-restore
LABELER_AUTHORIZATION_FILE=/absolute/external/operator-authorization.json
LABELER_DATABASE_NAME=labeling
LABELER_READONLY_USER=labeler_inspection
LABELER_READONLY_PASSWORD_FILE=/absolute/external/inspection-password
LABELER_OBSERVER_IMAGE=ghcr.io/owner/server:sha-<40-hex>@sha256:<64-hex>
LABELER_OBSERVER_ASSETS_ROOT=/absolute/approved/observer-assets
LABELER_OBSERVER_MOUNTS_FILE=/absolute/external/observer-mounts.json
LABELER_CUTOVER_REQUEST_FILE=/absolute/external/approved-cutover-request.json
```

The observer image, assets and mounts are used during adoption before a candidate exists. Install the approved readonly
`util/`, `scripts/`, `schema/` and `data/` observer asset trees separately with the host consumer. Data contains the four
canonical source files plus the historical CSV for readonly inventory; code and migration sources come from the approved
consumer revision. The existing digest-bound image supplies Node and the already installed dependencies. Root ownership,
regular files, source hashes, and the entire observer file tree are checked and included in the `--version` fingerprint
and operator approval. This avoids requiring a newly published v2 image or a host Node installation during adoption.
The assets are host-only consumer installation material, not release-package entries, secrets, or a VPS checkout/build.
They are never overlaid on an incoming candidate image. The mounts JSON maps exactly the
five `/run/config/...` and `/run/secrets/studies/...` prepare targets to their external files, excluding the database
password. Once a candidate exists, its validated rendered Compose supplies these five mounts instead. The observer
uses a separate password and role, never the application or migration credential.

Provision PostgreSQL and its healthcheck independently first. The inspector must have effective SELECT access,
`pg_read_all_stats`, and EXECUTE on `pg_control_system()`, but no elevated role membership, database CREATE/TEMP,
schema CREATE, table/column writes, or sequence USAGE/UPDATE. Revoke inherited PUBLIC write privileges as necessary.
External provisioning must also arrange read grants for tables subsequently created by the approved migration owner.
The controller does not provision roles or change grants. Inspection always runs in REPEATABLE READ READ ONLY and
checks the actual grants and absence of writer sessions before initialization/backup handoff.
Readiness fingerprints use UTC, a fixed transaction-local search path, and normalize PostgreSQL-generated internal TOAST
identifiers, not application objects or declared schema structure. Pins cover each approved migration prefix. The dedicated
historical cutover reader is unchanged.

External inputs must be regular files, not symlinks, outside deployment state, owned by root or the prepare UID 1000,
and not group/world writable. Authorizations and the executable backup boundary require root ownership. Secret-file
modes must also satisfy the image's existing secret-file contract and be readable by its UID 1000. Configurations and
account manifests must identify exactly the approved ordered 369 and 30 profiles. Both image digest and revision
labels, all four source hashes, the real prepare UID/GID and offline profile validation precede installation/reservation.

## Operator Authorization

The authorization file has exactly these keys:

```json
{
  "version": 1,
  "action": "deploy",
  "actor": "operator-name",
  "issuedAt": "2026-10-17T00:00:00Z",
  "expiresAt": "2026-10-17T01:00:00Z",
  "candidate": {},
  "databaseIdentity": {},
  "writersStopped": true,
  "drain": null,
  "consumerSha256": "<approved aggregate from --version>"
}
```

`candidate` is null only for adoption. Otherwise it contains exactly `releaseId`, `generation`, `commit`, `images`
(`server`, `database`), and `packageHashes` (`Caddyfile`, `docker-compose.yml`, `release-manifest.json`). Identity contains
exactly `systemIdentifier`, `databaseOid`, `databaseName`, `serverVersion`, `endpoint`, and host `volume` identity.
The authorization must match the observed DB and complete candidate, be current, and approve the installed consumer
fingerprint. For adoption, `drain` contains `pushesExcluded`, `rerunsBlocked`, `ciTerminal`, all true, and arrays
`queued`, `running`, `awaitingApproval`, `retryable`, `inFlight`. Every inventoried operation contains `id`, `startedAt`,
`terminalAt`, and terminal `status` (`completed` or `cancelled`). This is an operator-controlled attestation boundary,
not automatic GitHub administration or a replacement for real operational evidence.

## Backup Boundary

`LABELER_BACKUP_COMMAND` returns only the absolute path of an external version-1 receipt, never the old
`STUDY_BACKUP_VERIFIED` marker. Its closed root keys are `kind`, `version`, `databaseIdentity`, `origin`, `interval`,
`tools`, `archive`, `prerequisites`, `restore`, `writersStopped`; kind is `labeler-full-postgresql-backup`.

- `origin`: the full readonly observation: `schema`, `dataBundle`, `fingerprint`, `schemaFingerprint`, `observedAt`,
  `databaseIdentity`, `readOnly` (`role`, `transaction`, `grantsVerified`, `writersStopped`).
- `interval`: UTC `startedAt`, `completedAt`; `tools`: `pgDump`, `pgRestore`, `serverVersion`.
- `archive`: `format="custom"`, `scope="full-database"`, `location`, `sha256`, `encryptionKeyRef`, `retentionUntil`.
- `prerequisites`: arrays `roles`, `extensions`, `tablespaces`, each item containing `name`, `disposition`
  (`restored` or `approved-mapping`), `evidenceSha256`; `globals` contains `disposition` (`protected-globals` or
  `approved-mapping`), `location`, `sha256`.
- `restore`: isolated `databaseIdentity`, `completedAt`, `result="verified"`, `schemaFingerprint`, `dataFingerprint`,
  `archiveSha256`. Cluster/system, endpoint and volume must differ from the source.

The archive and globals/mapping hashes are checked. Restore fingerprints must equal the captured origin. The origin
is reread and writers must remain stopped before handoff. After expected cutover the same immutable backup reference
continues to bind the origin; it is not falsely compared with the target snapshot. The host never restores in place.

## Durable State And Recovery

Receipts have exactly the twelve root keys required by the approved design and a 64 KiB limit. The journal also has
the twelve keys explicitly enumerated in the design, including the approved `origin` field. It retains the exact prior
observation without presenting it as effective pending/unknown state or authorization, preserving explicit origin/target
binding. Files and parent directories are fsynced; receipts are immutable.

Reservation is durable before raising the generation floor. A retained reservation is not a generic retry ticket.
Each attempt also retains its validated public manifest, a sanitized Compose summary, bounded warnings and a result
under `evidence/<release-id>/attempt-.../`. Private environment values, account manifests and external source paths are
not copied into these diagnostics. Failed preflight retains diagnostics without changing compatibility or generation.
An interrupted attempt blocks ordinary deploy/rollback until local readonly reconciliation; a fresh authorization for
the exact candidate then permits `continue` or `finalize-publication`. Reconciliation never writes SQL, restarts a
service, or repairs a pointer. Only a recorded ordered publication prefix can be finalized. Completion is last, after
`previous`, `current`, `active-schema-version`, and `deployment`. Rollback never lowers the floor.

The controller alone sets `LABELER_RELEASE_CONTEXT_HOST_PATH`. Compose mounts that root-owned 0440 file from its private
0700 runtime directory at `/run/labeler-release/context.json`, only in `labeling-study-prepare`, with supplementary GID
1000. The container environment is `LABELER_RELEASE_CONTEXT=/run/labeler-release/context.json`. No context is packaged
or mounted in server/Caddy. Prepare validates the typed receipt and current DB binding and accepts only its own pending
step. Environment tokens, PIDs and timestamps from clients are not admission credentials.
Standalone shell preparation may verify an existing exact pair, but cannot initialize an empty database without this
host handoff. Local initialization fixtures must supply the same trusted boundary instead of bypassing it.

The existing dedicated cutover request and command remain unchanged. Maintenance validates and reserves the candidate,
checks both historical baseline pointers, requires stopped writers and backup/restore evidence, records pending, then
runs the existing migration and cutover entrypoints. A verified DB-ahead bridge belongs only to that same candidate.
Normal releases reject historical 300. A first v2 failure cannot activate a v1 image. Compatible v2 image recovery still
returns failure for the failed release, and does not assert successful publication.

## Local Verification

`test/deploy-vps.test.js` runs the complete Python unittest selection once in a root-isolated Python Docker container,
including command spies, real temporary filesystems, fsync failures, flock exclusion, backup receipts and crash/recovery
cases. No Docker socket or production state is mounted into that fixture. The Node wrapper preserves the launcher
behavioral contracts while replacing the old producer-dependent v1 fixtures with independent historical fixtures.

`test/study-readiness.integration.js` uses disposable PostgreSQL databases. The actual full shell-entrypoint and handoff
tests use `LABELER_READINESS_TEST_IMAGE` (local default `labeler-copilot369-local:b5cddf3`) with current source mounted
readonly. A clean runner must supply its prepared server image; a missing image is a failing prerequisite, not a skip.
The new entrypoint integration verifies initial ordered creation and a completely readonly second run.
