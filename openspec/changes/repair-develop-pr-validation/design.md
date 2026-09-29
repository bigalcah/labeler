## Context

See `proposal.md` for the CI failure and intended outcome. The reusable workflow prepares a temporary Compose runtime, creates test identity data, exercises the application, and then cleans up. The inventory in task 1 isolates the relevant runtime differences to `.github/workflows/shared-validation.yml`; credential generation already has a JSON-stdin contract and existing CI and credential workflow tests cover the no-bypass and input expectations.

## Goals / Non-Goals

**Goals:**

- Keep the repair isolated to shared validation behavior and directly justified workflow contract tests.
- Keep generated credentials and session key material inside their existing secure input and container boundaries.
- Make local TLS identity, mounted-file access, study ownership and teardown behavior consistent across setup and test stages.
- Make the required validation result mean every required gate completed successfully for the revision being evaluated.

**Non-Goals:**

- Change application behavior, database schema, dependencies, release automation, production secrets, or unrelated workflows.
- Import unrelated commits or files from another branch, alter the pending feature PR, or weaken a gate to obtain success.
- Treat a green local command or stale GitHub run as proof that all remote gates executed on the intended revision.

## Decisions

### Keep runtime preparation in the shared workflow

Update only the identified runtime setup and cleanup contracts in the reusable workflow, preserving the existing gate sequence and triggers. Reuse the current credential generator and Compose setup rather than adding a new script or dependency. This keeps pull request validation and its callers on one source of truth. Duplicating setup in another workflow or importing unrelated branch changes would make the gate harder to audit.

### Pass credentials as JSON through standard input

Construct the three temporary passwords as a JSON array and pipe them to the existing generator on standard input. Keep the CI username mapping in the study configuration so generated accounts correspond to the participants. Do not use newline framing or file-descriptor command options, and do not include secret values in arguments or output. This matches the generator's established input contract while keeping the secret payload out of process arguments.

### Align local TLS and file-consumer identities

Use `localhost` at each local URL and Caddy identity boundary. Assign the specific mounted credential/session inputs to the runtime UID that must read them through the existing short-lived setup mechanism, and make the Caddyfile read-only and readable. Avoid broader recursive permission changes: ownership and access should cover only the generated runtime files identified by the inventory and their consumers.

### Keep test state study-scoped and create session material in-container

Insert the temporary category with both its study and participant identity, and request quiet, tuple-only database output for the captured identifier. Create the session cookie from inside `labeling-server` using its mounted `/run/secrets/session-current` file. This avoids a host-side key export and ensures the signature uses the same key as the server.

### Preserve fail-closed gates and make cleanup tolerate partial setup

Keep lint, unit, OpenSpec, Compose, Dockerfile, integration and E2E gates mandatory. Do not add path skips, conditional gate removal, `continue-on-error`, or an alternate success path. Keep cleanup unconditional, but guard the Compose teardown on the generated Compose environment file's existence and remove the temporary runtime directory so setup failure before Compose initialization is also handled.

### Verify the exact revision and each gate conclusion

Review the workflow run and job results for the head SHA under test. A summary success line is insufficient if a required job is skipped, absent, or associated with an older revision. Capture sanitized evidence that names the revision and records each required gate's result; do not capture secrets or rely on stale checks.

## Risks / Trade-offs

- [A later setup/runtime defect may only appear after the credential contract is repaired] → Require all Compose, Dockerfile, integration and E2E gates to execute before declaring the check green.
- [Incorrect ownership may make a container unable to read a required mount or broaden secret access] → Limit changes to the inventoried generated files, verify each consumer's access, and avoid recursive permission changes.
- [An earlier setup failure may leave only part of the runtime initialized] → Run cleanup unconditionally, guard Compose teardown on its required environment file, remove temporary files, and preserve failure status.
- [A stale run or summary can look successful while the current head is unvalidated] → Verify the run head SHA and per-gate job conclusions against the current pull request revision.

## Migration Plan

No data migration or persistent configuration change is required. After explicit approval to apply this change, update the shared workflow and only directly justified contract tests, run the local checks in the task list, then validate the resulting workflow on a separate CI pull request. Treat remote validation as incomplete until every required gate has run on the expected head SHA. Recheck the originally blocked pull request only after the workflow repair is accepted; do not merge it as part of this change.
