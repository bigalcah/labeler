import assert from "node:assert/strict";
import {chmod, mkdtemp, readFile, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";
import test from "node:test";
import pg from "pg";
import {randomUUID} from "node:crypto";
import {normalizeStudySchema} from "../util/study-normalization.js";
import {classifyStudyReadiness, probeStudyNormalization} from "../util/study-readiness.js";
import {runStudyMigrations} from "../util/study-schema.js";
import {assertCopilot369SchemaContract} from "../util/copilot-369-schema-contract.js";
import {assertNoCopilot369History} from "../util/copilot-369-cutover-preflight.js";
import {prepareStudyProfiles} from "../util/study-preparation.js";
import {createReadinessProfiles} from "./readiness-fixture.js";
import {seedHistoricalCopilot369Studies} from "./support/copilot-369-fixture.js";
import {fingerprintNormalizationRows, seedNormalizationDecisions, startNormalizationDatabase} from "./support/study-normalization-fixture.js";

const legacyCsvPath = new URL("../plans/merged_after_rework_cards_seed_20260510.csv", import.meta.url);

const assertCutoverContract = async pool => {
    const client = await pool.connect();
    try {
        await client.query("BEGIN READ ONLY");
        await client.query("SET LOCAL search_path TO public, pg_catalog, pg_temp");
        await assertCopilot369SchemaContract(client);
        await client.query("COMMIT");
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
};

for (const origin of ["empty", "legacy300-v1", "copilot369-v1"]) {
    test(`retired ${origin}: atomic normalization preserves all preexisting rows and repeat is readonly`, async () => {
        const database = await startNormalizationDatabase({retired: true});
        const fixture = await createReadinessProfiles();
        const options = {pool: database.pool, profiles: fixture.profiles, legacyCsvPath};
        try {
            if (origin === "copilot369-v1") await prepareStudyProfiles(options);
            if (origin === "legacy300-v1") {
                await seedHistoricalCopilot369Studies(options);
                await database.pool.query("UPDATE participant_account SET password_hash = $1",
                    [fixture.profiles[0].bootstrapInput.credentialManifest.accounts[0].passwordHash]);
            }
            if (origin !== "empty") await seedNormalizationDecisions(database.pool);
            const before = await probeStudyNormalization(options);
            assert.deepEqual(Object.keys(before).sort(), ["applied015", "eligibility", "observation"]);
            assert.equal(Object.keys(before.observation).length, 7);
            assert.equal(before.observation.schema, "014_copilot_369_cardinality");
            assert.equal(before.observation.dataBundle, origin);
            assert.equal(before.applied015, false);
            assert.equal(before.eligibility, "eligible");
            await assert.rejects(classifyStudyReadiness(options), /physical|normalization/i);
            await assert.rejects(classifyStudyReadiness({...options, allowRetired: true}), /physical|normalization/i);
            const fingerprint = await fingerprintNormalizationRows(database.pool);
            const result = await normalizeStudySchema({...options, baseline: before.observation, operationOrigin: before.observation});
            assert.equal(result.changed, true);
            assert.deepEqual(result.origin, before.observation);
            assert.equal(result.observation.schema, "study-schema-3");
            assert.equal(result.observation.dataBundle, origin);
            assert.equal(result.observation.readOnly.grantsVerified, false);
            assert.equal(await fingerprintNormalizationRows(database.pool), fingerprint);
            const after = await probeStudyNormalization(options);
            assert.equal(after.applied015, true);
            assert.equal(after.eligibility, "already-applied");
            await assert.rejects(assertCutoverContract(database.pool), /schema|history/i);
            if (origin === "legacy300-v1") {
                const {rows: [primary]} = await database.pool.query("SELECT id FROM study WHERE study_key = 'pr-card-sorting-local'");
                await assert.rejects(assertNoCopilot369History(database.pool, primary.id), /histor|classification|decision|categor/i);
            }
            assert.notEqual(after.observation.fingerprint, before.observation.fingerprint);
            const repeated = await normalizeStudySchema({...options, baseline: after.observation, operationOrigin: before.observation});
            assert.equal(repeated.changed, false);
            assert.deepEqual(repeated.origin, before.observation);
            assert.equal(repeated.observation.fingerprint, after.observation.fingerprint);
            assert.equal(await fingerprintNormalizationRows(database.pool), fingerprint);
            const ledgerBefore = (await database.pool.query("SELECT * FROM labeler_migration ORDER BY applied_at, migration_id")).rows;
            await runStudyMigrations(database.pool);
            assert.deepEqual((await database.pool.query("SELECT * FROM labeler_migration ORDER BY applied_at, migration_id")).rows, ledgerBefore);
            if (origin === "copilot369-v1") assert.equal((await classifyStudyReadiness(options)).dataBundle, origin);
        } finally {
            await database.close();
            await rm(fixture.root, {recursive: true, force: true});
        }
    });
}

test("canonical 014 without 015 is ordinary readonly; explicit normalization is corrective-DDL no-op", async () => {
    const database = await startNormalizationDatabase();
    const fixture = await createReadinessProfiles();
    const options = {pool: database.pool, profiles: fixture.profiles};
    const singleConnection = new pg.Pool({...database.pool.options, max: 1});
    try {
        await prepareStudyProfiles(options);
        await seedNormalizationDecisions(database.pool);
        const before = await classifyStudyReadiness(options);
        assert.equal(before.schema, "study-schema-3");
        const probe = await probeStudyNormalization(options);
        assert.equal(probe.applied015, false);
        const sql = [];
        const pool = {connect: async () => {
            const client = await singleConnection.connect();
            return {query: (query, values) => { sql.push(query); return client.query(query, values); }, release: () => client.release()};
        }};
        const result = await normalizeStudySchema({...options, pool, baseline: before, operationOrigin: before});
        assert.equal(result.changed, true);
        assert.equal(result.observation.schemaFingerprint, before.schemaFingerprint);
        const after = await probeStudyNormalization(options);
        assert.equal(after.applied015, true);
        sql.length = 0;
        await normalizeStudySchema({...options, pool, baseline: after.observation, operationOrigin: before});
        assert.ok(sql.every(query => /^\s*(?:SELECT|SHOW|SET LOCAL|BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY|COMMIT|ROLLBACK)\b/.test(query)));
    } finally {
        await singleConnection.end();
        await database.close();
        await rm(fixture.root, {recursive: true, force: true});
    }
});

test("actual DB ledger consumers reject unknown, gapped, misordered and premature 015 rows", async () => {
    const database = await startNormalizationDatabase();
    try {
        const prior = (await database.pool.query("SELECT migration_id, applied_at::text AS applied_at FROM labeler_migration ORDER BY applied_at, migration_id")).rows;
        const mutations = [
            "INSERT INTO labeler_migration(migration_id) VALUES ('016_unapproved')",
            "DELETE FROM labeler_migration WHERE migration_id = '013_category_definition_color'",
            "UPDATE labeler_migration SET applied_at = '1990-01-01' WHERE migration_id = '014_copilot_369_cardinality'",
            "DELETE FROM labeler_migration WHERE migration_id = '014_copilot_369_cardinality'; INSERT INTO labeler_migration(migration_id) VALUES ('015_normalize_retired_study_schema')",
        ];
        for (const mutation of mutations) {
            await database.pool.query(mutation);
            const before = await fingerprintNormalizationRows(database.pool);
            await assert.rejects(probeStudyNormalization({pool: database.pool, profiles: []}), /migration|Migration/);
            await assert.rejects(runStudyMigrations(database.pool), /migration|Migration/);
            await assert.rejects(assertCutoverContract(database.pool), /migration|Migration/);
            assert.equal(await fingerprintNormalizationRows(database.pool), before);
            await database.pool.query("DELETE FROM labeler_migration");
            await database.pool.query(`INSERT INTO labeler_migration SELECT * FROM jsonb_to_recordset($1::jsonb)
                AS row(migration_id text, applied_at timestamptz)`, [JSON.stringify(prior)]);
        }
        await database.pool.query("ALTER TABLE labeler_migration DROP CONSTRAINT labeler_migration_pkey");
        await database.pool.query("INSERT INTO labeler_migration SELECT * FROM labeler_migration WHERE migration_id = '001_study_foundation'");
        await assert.rejects(probeStudyNormalization({pool: database.pool, profiles: []}), /Duplicate migration/);
        await assert.rejects(runStudyMigrations(database.pool), /Duplicate migration/);
    } finally {
        await database.close();
    }
});

for (const [name, mutation] of [
    ["missing actual 002 proof", "DELETE FROM labeler_migration WHERE migration_id = '002_retire_legacy_labeler'"],
    ["forged 015 on retired catalog", "INSERT INTO labeler_migration(migration_id) VALUES ('015_normalize_retired_study_schema')"],
    ["wrong removable index", "DROP INDEX study_card_pr_card_id_idx; CREATE INDEX study_card_pr_card_id_idx ON study_card(ordinal)"],
    ["wrong replacement index", "DROP INDEX study_card_pr_card_idx; CREATE INDEX study_card_pr_card_idx ON study_card(ordinal)"],
    ["unexpected removable dependency", `INSERT INTO pg_depend(classid, objid, objsubid, refclassid, refobjid, refobjsubid, deptype)
        VALUES ('pg_class'::regclass, 'study_card_pr_card_id_idx'::regclass, 0, 'pg_class'::regclass, 'study'::regclass, 0, 'n')`],
    ["non-user removable dependency", `INSERT INTO pg_depend(classid, objid, objsubid, refclassid, refobjid, refobjsubid, deptype)
        VALUES ('pg_class'::regclass, 'study_card_pr_card_id_idx'::regclass, 0, 'pg_class'::regclass, 'pg_class'::regclass, 0, 'n')`],
    ["invalid deferrable FK", `ALTER TABLE participant_category ADD CONSTRAINT participant_category_participant_id_fkey
        FOREIGN KEY(participant_id) REFERENCES reviewer(id) DEFERRABLE INITIALLY DEFERRED`],
    ["partial source", "DROP INDEX study_card_pr_card_id_idx"],
    ["unexpected data", "INSERT INTO reviewer(name) VALUES ('unapproved participant')"],
]) {
    test(`normalization rejects ${name} without repair or 015 writes`, async () => {
        const database = await startNormalizationDatabase({retired: true});
        const options = {pool: database.pool, profiles: []};
        try {
            const baseline = (await probeStudyNormalization(options)).observation;
            await database.pool.query(mutation);
            const before = await fingerprintNormalizationRows(database.pool);
            await assert.rejects(normalizeStudySchema({...options, baseline, operationOrigin: baseline}));
            assert.equal(await fingerprintNormalizationRows(database.pool), before);
        } finally {
            await database.close();
        }
    });
}

for (const stage of ["mid-DDL", "pre-commit", "post-commit"]) {
    test(`real PostgreSQL ${stage} failure rolls back or leaves independently provable 015`, async () => {
        const database = await startNormalizationDatabase({retired: true});
        const options = {pool: database.pool, profiles: []};
        try {
            const baseline = (await probeStudyNormalization(options)).observation;
            const before = await fingerprintNormalizationRows(database.pool);
            let ddl = false;
            const pool = {connect: async () => {
                const client = await database.pool.connect();
                return {release: () => client.release(), query: async (sql, values) => {
                    if (sql.startsWith("DO $normalization$")) {
                        ddl = true;
                        if (stage === "mid-DDL") return client.query(sql.replace("DROP INDEX public.pr_classification_participant_id_updated_at_idx;",
                            "DROP INDEX public.pr_classification_participant_id_updated_at_idx; RAISE EXCEPTION 'injected mid-DDL';"));
                    }
                    if (ddl && sql === "COMMIT" && stage === "pre-commit") throw new Error("injected pre-commit");
                    const result = await client.query(sql, values);
                    if (ddl && sql === "COMMIT" && stage === "post-commit") throw new Error("injected post-commit pre-observer");
                    return result;
                }};
            }};
            await assert.rejects(normalizeStudySchema({...options, pool, baseline, operationOrigin: baseline}), /injected/);
            assert.equal(await fingerprintNormalizationRows(database.pool), before);
            const observed = await probeStudyNormalization(options);
            assert.equal(observed.applied015, stage === "post-commit");
            assert.equal(observed.observation.schema, stage === "post-commit" ? "study-schema-3" : baseline.schema);
            if (stage === "post-commit") {
                const repeat = await normalizeStudySchema({...options, baseline: observed.observation, operationOrigin: baseline});
                assert.equal(repeat.changed, false);
            } else assert.equal(observed.observation.fingerprint, baseline.fingerprint);
        } finally {
            await database.close();
        }
    });
}

test("grant-verified probe and its CLI inspect the actual restricted-role snapshot", async () => {
    const database = await startNormalizationDatabase({retired: true});
    const directory = await mkdtemp(path.join(tmpdir(), "normalization-cli-"));
    let readonly;
    try {
        const name = database.pool.options.database;
        await database.pool.query(`CREATE ROLE normalization_inspector LOGIN;
            REVOKE CREATE ON SCHEMA public FROM PUBLIC; REVOKE TEMP ON DATABASE "${name}" FROM PUBLIC;
            GRANT pg_read_all_stats TO normalization_inspector;
            GRANT CONNECT ON DATABASE "${name}" TO normalization_inspector;
            GRANT USAGE ON SCHEMA public TO normalization_inspector;
            GRANT SELECT ON ALL TABLES IN SCHEMA public TO normalization_inspector;
            GRANT EXECUTE ON FUNCTION pg_control_system() TO normalization_inspector`);
        readonly = new pg.Pool({...database.pool.options, user: "normalization_inspector", max: 1});
        const result = await probeStudyNormalization({pool: readonly, profiles: [], requireRestrictedRole: true});
        assert.equal(result.observation.readOnly.grantsVerified, true);
        assert.equal(result.observation.readOnly.transaction, "read-only");
        await assert.rejects(probeStudyNormalization({pool: database.pool, profiles: [], requireRestrictedRole: true}), /grant-verified/);
        const passwordFile = path.join(directory, "password");
        await writeFile(passwordFile, "isolated-test-only");
        await chmod(passwordFile, 0o400);
        const env = {...process.env, DATABASE_HOST: "127.0.0.1", DATABASE_PORT: String(database.pool.options.port),
            DATABASE_NAME: name, DATABASE_USER: "normalization_inspector", DATABASE_PASS_FILE: passwordFile,
            LABELER_READINESS_STRICT: "true"};
        delete env.STUDY_PROFILES_INPUT;
        delete env.LABELER_RELEASE_CONTEXT;
        const cli = spawnSync(process.execPath, ["scripts/study-readiness.js", "--normalization-probe"], {env, encoding: "utf8"});
        assert.equal(cli.status, 0, cli.stderr);
        const parsed = JSON.parse(cli.stdout);
        assert.equal(parsed.applied015, false);
        assert.equal(parsed.observation.fingerprint, result.observation.fingerprint);
        const nameOfProbe = `normalization-probe-${randomUUID()}`;
        const dockerArguments = ["run", "--rm", "--name", nameOfProbe, "--read-only", "--network", "host", "--entrypoint", "node",
            "--user", `${process.getuid()}:${process.getgid()}`];
        for (const source of ["util", "scripts", "schema/migrations"]) {
            dockerArguments.push("--mount", `type=bind,source=${path.resolve(source)},target=/labeling/${source},readonly`);
        }
        dockerArguments.push("--mount", `type=bind,source=${passwordFile},target=/normalization-password,readonly`);
        for (const key of ["DATABASE_HOST", "DATABASE_PORT", "DATABASE_NAME", "DATABASE_USER", "LABELER_READINESS_STRICT"]) {
            dockerArguments.push("--env", `${key}=${env[key]}`);
        }
        dockerArguments.push("--env", "DATABASE_PASS_FILE=/normalization-password",
            process.env.LABELER_READINESS_TEST_IMAGE || "labeler-readiness-local:copilot369-apply", "scripts/study-readiness.js", "--normalization-probe");
        const imageCli = spawnSync("docker", dockerArguments, {encoding: "utf8", timeout: 30000});
        assert.equal(imageCli.status, 0, imageCli.stderr);
        assert.equal(JSON.parse(imageCli.stdout).observation.fingerprint, result.observation.fingerprint);
        assert.notEqual(spawnSync("docker", ["inspect", nameOfProbe], {encoding: "utf8"}).status, 0);
        const prepare = spawnSync(process.execPath, ["scripts/study-readiness.js", "--prepare"], {env, encoding: "utf8"});
        assert.notEqual(prepare.status, 0);
        assert.doesNotMatch(prepare.stdout, /EXACT/);
        await database.pool.query("GRANT UPDATE ON study TO normalization_inspector");
        await assert.rejects(probeStudyNormalization({pool: readonly, profiles: [], requireRestrictedRole: true}), /grant-verified/);
    } finally {
        if (readonly) await readonly.end();
        await database.close();
        await rm(directory, {recursive: true, force: true});
    }
});

test("orphaned, conflicting and partial study content is rejected, not repaired", async () => {
    const database = await startNormalizationDatabase({retired: true});
    const fixture = await createReadinessProfiles();
    const options = {pool: database.pool, profiles: fixture.profiles, legacyCsvPath};
    try {
        const {primaryStudyId, validationStudyId} = await seedHistoricalCopilot369Studies(options);
        await database.pool.query("UPDATE participant_account SET password_hash = $1",
            [fixture.profiles[0].bootstrapInput.credentialManifest.accounts[0].passwordHash]);
        const baseline = (await probeStudyNormalization(options)).observation;
        const mutations = [
            {sql: `INSERT INTO participant_category(study_id, participant_id, raw_name, normalized_name)
                VALUES ('${randomUUID()}', -1, 'orphan', 'orphan')`, cleanup: "DELETE FROM participant_category WHERE participant_id = -1"},
            {sql: `INSERT INTO pr_discard(study_id, pr_card_id, participant_id)
                SELECT study_id, pr_card_id, participant_id FROM pr_classification`, cleanup: `DELETE FROM pr_discard discard
                USING pr_classification classification WHERE discard.study_id = classification.study_id
                AND discard.pr_card_id = classification.pr_card_id AND discard.participant_id = classification.participant_id`},
            {sql: `INSERT INTO pr_discard(study_id, pr_card_id, participant_id)
                SELECT '${validationStudyId}', member.pr_card_id, participant.reviewer_id FROM study_card member
                JOIN study_participant participant ON participant.study_id = member.study_id AND participant.ordinal = 2
                WHERE member.study_id = '${primaryStudyId}' AND NOT EXISTS
                    (SELECT 1 FROM study_card validation WHERE validation.study_id = '${validationStudyId}'
                        AND validation.pr_card_id = member.pr_card_id) LIMIT 1`, cleanup: `DELETE FROM pr_discard discard
                WHERE NOT EXISTS (SELECT 1 FROM study_card member WHERE member.study_id = discard.study_id AND member.pr_card_id = discard.pr_card_id)`},
            {sql: "INSERT INTO pr_cards(source_card_id, title, raw_payload) VALUES ('unapproved', 'unknown', '{}'::jsonb)",
                cleanup: "DELETE FROM pr_cards WHERE source_card_id = 'unapproved'"},
            {sql: `UPDATE study_card SET ordinal = 10000 WHERE study_id = '${validationStudyId}' AND ordinal = 29`,
                cleanup: `UPDATE study_card SET ordinal = 29 WHERE study_id = '${validationStudyId}' AND ordinal = 10000`},
        ];
        for (const {sql, cleanup} of mutations) {
            const client = await database.pool.connect();
            try {
                await client.query("SET session_replication_role = replica");
                await client.query(sql);
            } finally {
                await client.query("SET session_replication_role = origin");
                client.release();
            }
            const before = await fingerprintNormalizationRows(database.pool);
            await assert.rejects(probeStudyNormalization(options), /Orphan|invalid|membership|Unknown retained/);
            await assert.rejects(normalizeStudySchema({...options, baseline, operationOrigin: baseline}));
            assert.equal(await fingerprintNormalizationRows(database.pool), before);
            await database.pool.query(cleanup);
        }
        assert.equal((await probeStudyNormalization(options)).applied015, false);
    } finally {
        await database.close();
        await rm(fixture.root, {recursive: true, force: true});
    }
});

test("SQL rejects standalone execution; advisory and table-lock contenders never mutate", async () => {
    const database = await startNormalizationDatabase({retired: true});
    const options = {pool: database.pool, profiles: []};
    const locker = await database.pool.connect();
    try {
        const baseline = (await probeStudyNormalization(options)).observation;
        const sql = await readFile(new URL("../schema/migrations/015_normalize_retired_study_schema.sql", import.meta.url), "utf8");
        await assert.rejects(database.pool.query(sql), /locked.*maintenance transaction/);
        for (const lock of ["SELECT pg_advisory_xact_lock(hashtext('labeler:study-schema'))", "LOCK TABLE study IN ACCESS SHARE MODE"]) {
            await locker.query("BEGIN");
            await locker.query(lock);
            await assert.rejects(normalizeStudySchema({...options, baseline, operationOrigin: baseline}), /lock timeout|lock on relation/);
            await locker.query("ROLLBACK");
            assert.equal((await probeStudyNormalization(options)).observation.fingerprint, baseline.fingerprint);
        }
    } finally {
        await locker.query("ROLLBACK");
        locker.release();
        await database.close();
    }
});

test("normalization probes preserve known incomplete prefixes and reject them as mutation targets", async () => {
    const database = await startNormalizationDatabase({through: "001_study_foundation"});
    const options = {pool: database.pool, profiles: []};
    try {
        for (const through of ["001_study_foundation", "003_private_pr_discard", "013_category_definition_color"]) {
            await runStudyMigrations(database.pool, through);
            const probe = await probeStudyNormalization(options);
            assert.equal(probe.observation.schema, through);
            assert.equal(probe.observation.dataBundle, "empty");
            assert.equal(probe.applied015, false);
            assert.equal(probe.eligibility, "ineligible");
            await assert.rejects(normalizeStudySchema({...options, baseline: probe.observation, operationOrigin: probe.observation}), /complete schema/);
        }
    } finally {
        await database.close();
    }
});

test("a committed baseline change between initial observation and table locks aborts before DDL", async () => {
    const database = await startNormalizationDatabase({retired: true});
    const options = {pool: database.pool, profiles: []};
    try {
        const baseline = (await probeStudyNormalization(options)).observation;
        let changedFingerprint;
        const pool = {connect: async () => {
            const client = await database.pool.connect();
            return {release: () => client.release(), query: async (sql, values) => {
                const result = await client.query(sql, values);
                if (sql.includes("pg_advisory_xact_lock")) {
                    await database.pool.query(`UPDATE labeler_migration SET applied_at = applied_at + interval '1 microsecond'
                        WHERE migration_id = '001_study_foundation'`);
                    changedFingerprint = await fingerprintNormalizationRows(database.pool);
                }
                return result;
            }};
        }};
        await assert.rejects(normalizeStudySchema({...options, pool, baseline, operationOrigin: baseline}), /baseline changed: fingerprint/);
        assert.ok(changedFingerprint);
        assert.equal(await fingerprintNormalizationRows(database.pool), changedFingerprint);
        assert.equal((await probeStudyNormalization(options)).applied015, false);
    } finally {
        await database.close();
    }
});
