import assert from "node:assert/strict";
import {rm} from "node:fs/promises";
import test from "node:test";
import {assertStudySchemaReady, bootstrapStudy, StudyBootstrapConflictError} from "../util/study-bootstrap.js";
import {normalizeStudySchema} from "../util/study-normalization.js";
import {probeStudyNormalization} from "../util/study-readiness.js";
import {prepareStudyProfiles} from "../util/study-preparation.js";
import {createReadinessProfiles} from "./readiness-fixture.js";
import {fingerprintNormalizationRows, seedNormalizationDecisions, startNormalizationDatabase} from "./support/study-normalization-fixture.js";
import {seedHistoricalCopilot369Studies} from "./support/copilot-369-fixture.js";
import {probePost015Normalization, runPost015Prepare} from "./support/normalization-post015-prepare.js";
import {runPost015BackupBinding} from "./support/normalization-post015-host.js";

const legacyCsvPath = new URL("../plans/merged_after_rework_cards_seed_20260510.csv", import.meta.url);

test("unknown 016 in the real ledger blocks bootstrap before a transaction or application writes", async () => {
    const database = await startNormalizationDatabase();
    const fixture = await createReadinessProfiles();
    try {
        await database.pool.query("INSERT INTO labeler_migration(migration_id) VALUES ('016_unapproved')");
        const before = await fingerprintNormalizationRows(database.pool);
        let connections = 0;
        const pool = {query: (sql, values) => database.pool.query(sql, values), connect: async () => {
            connections += 1;
            return database.pool.connect();
        }};
        await assert.rejects(bootstrapStudy({pool, ...fixture.profiles[1].bootstrapInput}), error =>
            error instanceof StudyBootstrapConflictError && error.message === "Study schema migration ledger is invalid");
        assert.equal(connections, 0);
        assert.equal(await fingerprintNormalizationRows(database.pool), before);
    } finally {
        await database.close();
        await rm(fixture.root, {recursive: true, force: true});
    }
});

for (const retired of [false, true]) {
    test(`bootstrap accepts actual full 014 and normalized 015${retired ? " with actual 002 lineage" : " without 002"}`, async () => {
        const database = await startNormalizationDatabase({retired});
        const fixture = await createReadinessProfiles();
        const options = {pool: database.pool, profiles: []};
        try {
            await assertStudySchemaReady(database.pool);
            const {observation: baseline} = await probeStudyNormalization(options);
            await normalizeStudySchema({...options, baseline, operationOrigin: baseline});
            const ledger = (await database.pool.query("SELECT * FROM labeler_migration ORDER BY applied_at, migration_id")).rows;
            const study = await bootstrapStudy({pool: database.pool, ...fixture.profiles[1].bootstrapInput});
            assert.equal(study.bootstrap_state, "READY");
            assert.equal((await database.pool.query("SELECT count(*)::integer AS count FROM study_card WHERE study_id = $1", [study.id])).rows[0].count, 30);
            assert.deepEqual((await database.pool.query("SELECT * FROM labeler_migration ORDER BY applied_at, migration_id")).rows, ledger);
        } finally {
            await database.close();
            await rm(fixture.root, {recursive: true, force: true});
        }
    });
}

test("a real incomplete managed prefix is a typed bootstrap rejection without writes", async () => {
    const database = await startNormalizationDatabase({through: "001_study_foundation"});
    try {
        const before = await fingerprintNormalizationRows(database.pool);
        await assert.rejects(assertStudySchemaReady(database.pool), error =>
            error instanceof StudyBootstrapConflictError && error.message.startsWith("Bootstrap requires migrations "));
        assert.equal(await fingerprintNormalizationRows(database.pool), before);
    } finally {
        await database.close();
    }
});

test("ordinary prepare initializes a normalized empty origin through the real migration entrypoint", async () => {
    const database = await startNormalizationDatabase({retired: true});
    const fixture = await createReadinessProfiles();
    const options = {pool: database.pool, profiles: fixture.profiles, legacyCsvPath};
    try {
        const baseline = await probeStudyNormalization(options);
        await normalizeStudySchema({...options, baseline: baseline.observation, operationOrigin: baseline.observation});
        const normalized = await probePost015Normalization(database, fixture.profiles, legacyCsvPath);
        assert.equal(normalized.applied015, true);
        assert.equal(normalized.observation.dataBundle, "empty");
        const ledger = (await database.pool.query("SELECT * FROM labeler_migration ORDER BY applied_at, migration_id")).rows;
        const prepare = await runPost015Prepare({database, fixture, observation: normalized.observation});
        assert.match(prepare.stdout, /Study schema migration complete/);
        const primaryReady = prepare.stdout.indexOf("Study pr-card-sorting-local is READY");
        const validationReady = prepare.stdout.indexOf("Study pr-card-sorting-validation-30 is READY");
        assert.ok(primaryReady >= 0 && validationReady > primaryReady);
        assert.deepEqual((await database.pool.query("SELECT * FROM labeler_migration ORDER BY applied_at, migration_id")).rows, ledger);
        assert.equal((await database.pool.query("SELECT count(*)::integer AS count FROM labeler_migration WHERE migration_id = '015_normalize_retired_study_schema'")).rows[0].count, 1);
        assert.deepEqual((await database.pool.query("SELECT study_key, expected_card_count FROM study ORDER BY expected_card_count DESC")).rows,
            [{study_key: "pr-card-sorting-local", expected_card_count: 369},
                {study_key: "pr-card-sorting-validation-30", expected_card_count: 30}]);
    } finally {
        await database.close();
        await rm(fixture.root, {recursive: true, force: true});
    }
});

test("Copilot 369+30 with decisions continues through ordinary prepare readonly without a migrator", async () => {
    const database = await startNormalizationDatabase({retired: true});
    const fixture = await createReadinessProfiles();
    const options = {pool: database.pool, profiles: fixture.profiles, legacyCsvPath};
    try {
        await prepareStudyProfiles(options);
        await seedNormalizationDecisions(database.pool);
        const baseline = await probeStudyNormalization(options);
        await normalizeStudySchema({...options, baseline: baseline.observation, operationOrigin: baseline.observation});
        const normalized = await probePost015Normalization(database, fixture.profiles, legacyCsvPath);
        assert.equal(normalized.applied015, true);
        assert.equal(normalized.observation.dataBundle, "copilot369-v1");
        const rows = await fingerprintNormalizationRows(database.pool);
        const ledger = (await database.pool.query("SELECT * FROM labeler_migration ORDER BY applied_at, migration_id")).rows;
        const prepare = await runPost015Prepare({database, fixture});
        assert.match(prepare.stdout, /Approved 369\+30 studies verified read-only/);
        assert.doesNotMatch(prepare.stdout, /migrate:study|bootstrap:study|prepare:study-profiles|retire:legacy/);
        assert.equal(await fingerprintNormalizationRows(database.pool), rows);
        assert.deepEqual((await database.pool.query("SELECT * FROM labeler_migration ORDER BY applied_at, migration_id")).rows, ledger);
        assert.equal((await database.pool.query("SELECT count(*)::integer AS count FROM labeler_migration WHERE migration_id = '015_normalize_retired_study_schema'")).rows[0].count, 1);
    } finally {
        await database.close();
        await rm(fixture.root, {recursive: true, force: true});
    }
});

test("backup authority accepts a fresh post-015 PostgreSQL baseline and rejects its pre-015 snapshot", async () => {
    const database = await startNormalizationDatabase({retired: true});
    const fixture = await createReadinessProfiles();
    const options = {pool: database.pool, profiles: fixture.profiles, legacyCsvPath};
    try {
        await seedHistoricalCopilot369Studies(options);
        await database.pool.query("UPDATE participant_account SET password_hash = $1",
            [fixture.profiles[0].bootstrapInput.credentialManifest.accounts[0].passwordHash]);
        const pre015 = await probePost015Normalization(database, fixture.profiles, legacyCsvPath);
        assert.equal(pre015.applied015, false);
        const baseline = await probeStudyNormalization(options);
        await normalizeStudySchema({...options, baseline: baseline.observation, operationOrigin: baseline.observation});
        const post015 = await probePost015Normalization(database, fixture.profiles, legacyCsvPath);
        assert.equal(post015.applied015, true);
        assert.equal(post015.observation.dataBundle, "legacy300-v1");
        const rows = await fingerprintNormalizationRows(database.pool);
        const ledger = (await database.pool.query("SELECT * FROM labeler_migration ORDER BY applied_at, migration_id")).rows;
        const backup = await runPost015BackupBinding({database, profiles: fixture.profiles, legacyCsvPath,
            pre015: pre015.observation, post015: post015.observation});
        assert.ok(backup.post015Accepted.sha256);
        assert.equal(backup.restoredObservation.fingerprint, post015.observation.fingerprint);
        assert.equal(backup.restoredObservation.schemaFingerprint, post015.observation.schemaFingerprint);
        assert.equal(backup.pre015.accepted, false);
        assert.match(backup.pre015.reason, /backup does not bind the stopped origin/);
        assert.equal(await fingerprintNormalizationRows(database.pool), rows);
        assert.deepEqual((await database.pool.query("SELECT * FROM labeler_migration ORDER BY applied_at, migration_id")).rows, ledger);
    } finally {
        await database.close();
        await rm(fixture.root, {recursive: true, force: true});
    }
});
