import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {mkdtemp, readFile, rm, stat, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import test from "node:test";
import "./support/deployment-harness-readiness.test-helper.js";
import "./support/deployment-container-inputs-contract.test-helper.js";

const harnessUrl = new URL("../scripts/test-study-deployment.sh", import.meta.url);
const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const dockerIgnore = await readFile(new URL("../.dockerignore", import.meta.url), "utf8");
const integration = await readFile(new URL("./multi-study-hostile-e2e.integration.js", import.meta.url), "utf8");
const handoffHelper = await readFile(new URL("./support/locked-prepare-handoff.py", import.meta.url), "utf8");
const normalizationHelper = await readFile(new URL("./support/locked-normalization-handoff.py", import.meta.url), "utf8");
const normalizationRuntime = await readFile(new URL("./support/normalization_harness_runtime.py", import.meta.url), "utf8");
const normalizationDbHelper = await readFile(new URL("./support/normalization-harness-db.js", import.meta.url), "utf8");
const hostContracts = await readFile(new URL("../deployment/host/contracts.py", import.meta.url), "utf8");

test("successive prepare accepts schema4 unchanged and rejects normalization, history or persistent drift", async () => {
    const harness = await readFile(harnessUrl, "utf8");
    const command = "node --input-type=module - \"$CLEAN_014_BEFORE_RERUN\" \"$CLEAN_014_AFTER_RERUN\" <<'NODE'\n";
    const start = harness.indexOf(command);
    assert.ok(start >= 0);
    const assertion = harness.slice(start + command.length).split("\nNODE\n", 1)[0];
    const directory = await mkdtemp(path.join(tmpdir(), "labeler-successive-prepare-"));
    const beforePath = path.join(directory, "before.json");
    const afterPath = path.join(directory, "after.json");
    const baseline = {probe: {applied015: false, eligibility: "ineligible", observation: {
        schema: "study-schema-4", dataBundle: "copilot369-v1", fingerprint: "data",
        schemaFingerprint: "catalog", databaseIdentity: {systemIdentifier: "isolated-fixture"},
    }}, historyProbe: {applied016: true}, applicationRowsSha256: "unchanged-rows"};
    try {
        await writeFile(beforePath, JSON.stringify(baseline));
        await writeFile(afterPath, JSON.stringify(baseline));
        const run = () => spawnSync(process.execPath, ["--input-type=module", "-", beforePath, afterPath],
            {input: assertion, encoding: "utf8"});
        const unchanged = run();
        assert.equal(unchanged.status, 0, unchanged.stderr);
        for (const mutate of [
            state => { state.probe.applied015 = true; },
            state => { state.probe.eligibility = "eligible"; },
            state => { state.probe.observation.schema = "study-schema-3"; },
            state => { state.historyProbe.applied016 = false; },
            state => { state.applicationRowsSha256 = "changed-rows"; },
            state => { state.probe.observation.fingerprint = "changed-data"; },
        ]) {
            const changed = structuredClone(baseline);
            mutate(changed);
            await writeFile(afterPath, JSON.stringify(changed));
            assert.notEqual(run().status, 0, "successive prepare must reject drift");
        }
    } finally {
        await rm(directory, {recursive: true, force: true});
    }
});

test("deployment harness fails with an actionable prerequisite when Docker is unavailable", () => {
    const result = spawnSync("/bin/sh", [harnessUrl.pathname], {
        env: {...process.env, PATH: "/nonexistent"},
        encoding: "utf8",
    });

    assert.equal(result.status, 2);
    assert.match(result.stderr, /^DEPLOYMENT_HARNESS_PREREQUISITE: docker CLI is required/m);
});

test("deployment harness scopes generated resources and cleanup to its unique projects", async () => {
    const harness = await readFile(harnessUrl, "utf8");

    assert.match(harness, /mktemp -d/);
    assert.match(harness, /umask 077/);
    assert.match(harness, /CLEAN_PROJECT=.*RUN_ID.*clean/);
    assert.match(harness, /EXISTING_PROJECT=.*RUN_ID.*existing/);
    assert.match(harness, /ports: !override/);
    assert.match(harness, /127\.0\.0\.1:\$\{HTTP_PORT\}:80/);
    assert.match(harness, /127\.0\.0\.1:\$\{HTTPS_PORT\}:443/);
    assert.doesNotMatch(harness, /127\.0\.0\.1:\$\{SERVER_PORT\}:3000/);
    assert.match(harness, /row\.Service !== "labeling-caddy" && publishers\.length > 0/);
    assert.match(harness, /name: \$\{project\}-data/);
    assert.match(harness, /name: \$\{project\}-network/);
    assert.match(harness, /docker compose -p "\$project"/);
    assert.match(harness, /down --remove-orphans/);
    assert.doesNotMatch(harness, /down (?:-v|--volumes)/);
    assert.doesNotMatch(harness, /docker (?:system|volume|network) prune/);
    assert.match(harness, /docker rm --force/);
    assert.match(harness, /docker volume rm/);
    assert.ok(harness.includes("docker image rm") && harness.includes("image-reference"));
    assert.ok(harness.includes("absence_verified=true") && harness.includes("absenceVerified"));
    assert.match(harness, /stop_handoff_owner/);
    assert.match(harness, /handoffOwnerVerified/);
    assert.doesNotMatch(harness, /deployment\/\.env(?:\s|"|'|$)/);
});

test("clean dual-profile harness invokes authenticated CSV and snapshot-race checks before drift", async () => {
    const harness = await readFile(harnessUrl, "utf8");

    assert.match(harness, /multi-study-e2e-credentials\.json/);
    assert.equal(/multi-study-export-hmac-secret|STUDY_MULTI_STUDY_E2E_EXPORT_HMAC_SECRET_FILE/.test(harness), false);
    assert.equal(/multi-study-export(?:-manifest)?/.test(harness), false);
    assert.match(harness, /STUDY_MULTI_STUDY_E2E_ISOLATED_RUNTIME=true/);
    assert.match(harness, /STUDY_MULTI_STUDY_E2E_BASE_URL="https:\/\/127\.0\.0\.1:\$CLEAN_HTTPS_PORT"/);
    assert.match(harness, /STUDY_MULTI_STUDY_E2E_VIRTUAL_HOST=localhost/);
    assert.match(harness, /STUDY_MULTI_STUDY_E2E_DATABASE_HOST="\$CLEAN_DATABASE_HOST"/);
    assert.match(harness, /unset NODE_TEST_CONTEXT/);
    assert.equal(harness.includes("STUDY_MULTI_STUDY_E2E_EXPORT_OUTPUT"), false);
    assert.match(harness, /STAGE_PRIVATE_DISCARD_HTTP_OK/);
    assert.match(harness, /STAGE_INTERNAL_RUNTIME_HEALTH_OK/);
    assert.match(harness, /STAGE_SUCCESSIVE_READONLY_PRESERVATION_OK/);
    assert.match(harness, /for path in \/actuator \/actuator\/health \/actuator\/private\/child/);
    assert.match(harness, /docker run --rm --network "\$\{CLEAN_PROJECT\}-network" --read-only/);
    assert.match(harness, /STUDY_E2E_BASE_URL=http:\/\/labeling-server:3000/);
    assert.doesNotMatch(harness, /STUDY_E2E_BASE_URL="http:\/\/127\.0\.0\.1:/);
    assert.match(harness, /READINESS_TEST_IMAGE=\$\{LABELER_READINESS_TEST_IMAGE:-labeler-copilot369-local:b5cddf3\}/);
    assert.match(harness, /docker image inspect --format '\{\{\.Id\}\}' "\$READINESS_TEST_IMAGE"/);
    assert.match(harness, /LABELER_SERVER_IMAGE=\$CLEAN_SERVER_IMAGE/);
    assert.match(harness, /LABELER_READINESS_TEST_IMAGE="\$CLEAN_SERVER_IMAGE" npm run test:integration/);
    assert.match(harness, /\[ "\$CLEAN_RUNNING_IMAGE" = "\$CLEAN_SERVER_IMAGE" \]/);
    assert.match(harness, /docker build --tag "\$CLEAN_PROJECT-database-fixture:latest" --file "\$ROOT\/deployment\/database\/Dockerfile"/);
    assert.doesNotMatch(harness, /up --build/);
    assert.doesNotMatch(harness, /labeler-readiness-local:copilot369-apply|seart\/labeling-server:1\.0\.0/);
    assert.match(integration, /parseComparisonCsv\(primaryTwoParticipantExport\.body, 369, 2\)/);
    assert.match(integration, /parseComparisonCsv\(primaryThreeParticipantExport\.body, 369, 3\)/);
    assert.match(integration, /parseComparisonCsv\(validationTwoParticipantExport\.body, 30, 2\)/);
    assert.match(integration, /parseComparisonCsv\(validationThreeParticipantExport\.body, 30, 3\)/);
    assert.match(integration, /from "csv-parse\/sync"/);
    assert.match(integration, /createStudyComparisonExport/);
    assert.match(integration, /study-export:study/);
    assert.match(integration, /\/export\/download/);
    assert.match(integration, /snapshotEstablished/);
    assert.equal(integration.includes("spawnSync"), false);
    assert.equal(integration.includes("[\"export:study\""), false);
    assert.equal(integration.includes("multi-study-export-manifest"), false);
    assert.equal(integration.includes(".split(\"\\n\")"), false);
    assert.match(harness, /MULTI_STUDY_HOSTILE_E2E_OK/);
    assert.ok(harness.indexOf("multi-study-hostile-e2e.integration.js") > harness.indexOf("SEED_SQL"));
    assert.ok(harness.indexOf("multi-study-hostile-e2e.integration.js") < harness.indexOf("STAGE_SUCCESSIVE_READONLY_PRESERVATION_OK"));
});

test("deployment harness has a separate explicit package gate", () => {
    assert.equal(packageJson.scripts["test:deployment"],
        "node --test test/deployment-harness.integration.js");
    assert.match(dockerIgnore, /^scripts\/test-study-deployment\.sh$/m);
});

test("offline export command and entry point are retired", async () => {
    assert.equal(packageJson.scripts["export:study"], undefined);
    await assert.rejects(stat(new URL("../scripts/export-study.js", import.meta.url)), {code: "ENOENT"});
});

test("Given the canonical sources When the CI runtime is prepared Then it seeds separate 369 and 30 account manifests", async () => {
    const harness = await readFile(harnessUrl, "utf8");

    assert.match(harness, /expectedCardCount[" ]*:[" ]*369/);
    assert.match(harness, /expectedCardCount[" ]*:[" ]*30/);
    for (const username of ["javier", "diego", "pablo", "javier-30", "diego-30", "pablo-30"]) {
        assert.ok(harness.includes(username), `missing synthetic account ${username}`);
    }
    assert.match(harness, /validation-study-account-manifest\.json/);
    assert.equal((harness.match(/credentials:generate --/g) ?? []).length, 2);
    assert.match(harness, /new Set\(\[\.\.\.current, \.\.\.validation\]\)\.size !== 6/);
    assert.match(harness, /copilot-369-cards\.csv/);
    assert.match(harness, /validation-30-cards\.csv/);
    assert.match(harness, /GITHUB_ENRICHMENT_ENABLED=false/);
    assert.doesNotMatch(harness, /GITHUB_TOKEN_HOST_PATH|GITHUB_TOKEN=/);
});

test("Given isolated runtime teardown When Docker removal fails or resources remain Then cleanup is unconfirmed and fails closed", async () => {
    const harness = await readFile(harnessUrl, "utf8");

    assert.doesNotMatch(harness, /\|\|\s*true\b/);
    assert.match(harness, /docker ps .*com\.docker\.compose\.project/);
    assert.match(harness, /docker network ls .*com\.docker\.compose\.project/);
    assert.match(harness, /docker volume ls .*com\.docker\.compose\.project/);
    assert.match(harness, /cleanup-receipt\.json/);
    assert.match(harness, /cleanupVerified/);
    assert.match(harness, /temporaryDirectoryRemoved/);
});

test("Given both study profiles When all runtime gates execute Then private HTTP, hostile edge E2E, integration, internal health, and readonly preservation remain separate stages", async () => {
    const harness = await readFile(harnessUrl, "utf8");
    const stages = [
        "STAGE_UNTRUSTED_CONTEXT_REJECTIONS_OK",
        "STAGE_LOCKED_ROOT_HANDOFF_PREPARE_OK",
        "STAGE_ROOT_HANDOFF_CLEANUP_OK",
        "STAGE_CANONICAL_014_NO_015_INITIAL_OK",
        "STAGE_PRIVATE_DISCARD_HTTP_OK",
        "STAGE_MULTI_STUDY_HOSTILE_E2E_OK",
        "STAGE_INTEGRATION_SUITE_OK",
        "STAGE_INTERNAL_RUNTIME_HEALTH_OK",
        "STAGE_CANONICAL_014_NO_015_OK",
        "STAGE_SUCCESSIVE_READONLY_PRESERVATION_OK",
        "STAGE_ORDINARY_EXISTING_REJECTION_OK",
        "STAGE_GUARDED_LEGACY_RETIREMENT_OK",
        "STAGE_CORRUPT_BACKUP_REJECTION_OK",
        "STAGE_NORMALIZATION_PROBE_OK",
        "STAGE_NORMALIZATION_PENDING_BEFORE_SQL_OK",
        "STAGE_NORMALIZATION_SQL_VERIFIED_OK",
        "STAGE_NORMALIZATION_CHECKPOINT_STOP_OK",
        "STAGE_POST_015_PREPARE_OK",
        "STAGE_FRESH_POST_015_CONTINUATION_OK",
        "STAGE_POST_RETIREMENT_INITIALIZATION_OK",
        "STAGE_POST_RETIREMENT_PERSISTENCE_OK",
        "STAGE_NORMALIZATION_OWNER_CLEANUP_OK",
    ].map(stage => harness.indexOf(stage));

    assert.ok(stages.every(index => index >= 0));
    assert.deepEqual(stages, [...stages].sort((left, right) => left - right));
    assert.ok(harness.includes("test/multi-study-hostile-e2e.integration.js"));
    assert.match(harness, /npm run test:integration/);
    assert.match(harness, /--entrypoint npm "\$CLEAN_SERVER_IMAGE" run test:e2e/);
    assert.match(harness, /STUDY_E2E_BASE_URL/);
    assert.match(harness, /protected-30-before/);
    assert.match(harness, /protected-30-after/);
    assert.match(harness, /deployment\/docker-compose\.existing\.yml/);
    assert.match(harness, /002_retire_legacy_labeler/);
});

test("Given legacy objects When ordinary preparation and guarded retirement run Then the harness preserves fail-closed sequencing and post-retirement readiness", async () => {
    const harness = await readFile(harnessUrl, "utf8");
    const legacyHarness = harness.slice(harness.indexOf("write_runtime \"$EXISTING_DIR\""));
    const ordinaryRejection = legacyHarness.indexOf("STAGE_ORDINARY_EXISTING_REJECTION_BEGIN");
    const foundationMigration = legacyHarness.indexOf("npm run migrate:study -- --through 001_study_foundation");
    const retirementApply = legacyHarness.indexOf("npm run retire:legacy:apply", foundationMigration);
    const finalMigration = legacyHarness.indexOf("npm run migrate:study'", retirementApply);
    const normalizationProbe = legacyHarness.indexOf("STAGE_NORMALIZATION_PROBE_OK");
    const normalizationPending = legacyHarness.indexOf("STAGE_NORMALIZATION_PENDING_BEFORE_SQL_OK");
    const normalizationSql = legacyHarness.indexOf("STAGE_NORMALIZATION_SQL_VERIFIED_OK");
    const normalizationCheckpoint = legacyHarness.indexOf("STAGE_NORMALIZATION_CHECKPOINT_STOP_OK");
    const freshContinuation = legacyHarness.indexOf("STAGE_FRESH_POST_015_CONTINUATION_OK");
    const post015Prepare = legacyHarness.indexOf("STAGE_POST_015_PREPARE_OK");
    const retiredInitialization = legacyHarness.indexOf("STAGE_POST_RETIREMENT_INITIALIZATION_OK");

    assert.match(legacyHarness, /Unexpected legacy or unknown database objects\./);
    assert.match(legacyHarness, /database_schema_data_fingerprint/);
    assert.match(legacyHarness, /labeler_migration/);
    assert.match(legacyHarness, /LEGACY_AFTER_REJECTION.*LEGACY_BEFORE/);
    assert.match(legacyHarness, /ps --services --status running/);
    assert.match(harness, /LEGACY_RETIREMENT_CONFIRM=retire-legacy-labeler/);
    assert.match(harness, /LEGACY_BACKUP_DIRECTORY=.*backup/);
    assert.match(harness, /PGPASSFILE_HOST_PATH=.*legacy-retirement\.pgpass/);
    assert.ok(ordinaryRejection >= 0 && ordinaryRejection < foundationMigration);
    assert.ok(foundationMigration < retirementApply && retirementApply < finalMigration);
    assert.ok(finalMigration < retiredInitialization);
    assert.match(legacyHarness, /database state: already-retired/);
    assert.match(legacyHarness, /Backup archive checksum mismatch/);
    assert.match(legacyHarness, /legacy\.valid\.dump/);
    assert.match(legacyHarness, /STAGE_CORRUPT_BACKUP_REJECTION_OK/);
    assert.match(legacyHarness, /compose_for_existing_clean_profiles/);
    assert.match(harness, /docker-compose\.existing\.yml[\s\S]*docker-compose\.clean\.yml[\s\S]*retired-mode\.yml[\s\S]*handoff\.yml/);
    assert.match(harness, /test\/support\/locked-normalization-handoff\.py/);
    assert.ok(normalizationHelper.includes("normalization.start(state, runtime, source)") && normalizationHelper.includes("continue_operation(state, runtime, \"continue\")"));
    assert.match(normalizationRuntime, /"archiveScope": "full-database"/);
    assert.match(normalizationRuntime, /"syntheticFixture": True/);
    assert.match(normalizationRuntime, /"hostBoundaryAccepted": True/);
    assert.match(normalizationHelper, /fresh_authorization and final_receipt\["phase"\] == "completed"/);
    assert.match(harness, /probeStudyNormalization\(\{pool: inspector, profiles: \[\], requireRestrictedRole: true\}\)/);
    assert.match(legacyHarness, /scripts\/normalize-retired-study-schema\.js/);
    assert.match(legacyHarness, /normalization-harness-db\.js" post-normalization/);
    assert.match(legacyHarness, /normalization-harness-db\.js" prepared/);
    assert.match(normalizationDbHelper, /015_normalize_retired_study_schema/);
    assert.match(normalizationDbHelper, /participant_category_participant_id_fkey/);
    assert.match(normalizationDbHelper, /pr_classification_participant_id_updated_at_idx/);
    assert.match(normalizationDbHelper, /study_card_pr_card_id_idx/);
    assert.match(normalizationDbHelper, /study_participant_reviewer_id_idx/);
    assert.ok(finalMigration < normalizationProbe);
    assert.ok(normalizationProbe < normalizationPending && normalizationPending < normalizationSql);
    assert.ok(normalizationSql < normalizationCheckpoint && normalizationCheckpoint < post015Prepare);
    assert.ok(post015Prepare < freshContinuation && freshContinuation < retiredInitialization);
    assert.match(harness, /\$ROOT\/scripts:\/labeling\/scripts:ro/);
    assert.match(harness, /\$ROOT\/util:\/labeling\/util:ro/);
    assert.match(harness, /\$ROOT\/schema\/migrations:\/labeling\/schema\/migrations:ro/);
    assert.match(legacyHarness, /sh scripts\/prepare-study-deployment\.sh/);
    assert.match(legacyHarness, /EXISTING_BEFORE=\$\(database_schema_data_fingerprint/);
    assert.match(legacyHarness, /post-retirement runtime restart changed persisted 369\/30 state/);
    assert.doesNotMatch(legacyHarness, /002_retire_legacy_labeler\.sql/);
    assert.doesNotMatch(legacyHarness, /up --build/);
    assert.match(handoffHelper, /origin\["schema"\] != "empty" and origin\["dataBundle"\] == "empty"/);
    assert.match(hostContracts, /"study-schema-3"/);
});
