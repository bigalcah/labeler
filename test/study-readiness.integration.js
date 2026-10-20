import assert from "node:assert/strict";
import {rm} from "node:fs/promises";
import {test} from "node:test";
import pg from "pg";
import {classifyStudyReadiness} from "../util/study-readiness.js";
import {prepareStudyProfiles} from "../util/study-preparation.js";
import {bootstrapStudy} from "../util/study-bootstrap.js";
import {runStudyMigrations} from "../util/study-schema.js";
import {createReadinessProfiles} from "./readiness-fixture.js";
import {startCopilot369Database, closeCopilot369Database, seedHistoricalCopilot369Studies} from "./support/copilot-369-fixture.js";

test("readiness identifies known 001 before migrations and exact persisted decisions without writes", async () => {
    const database = await startCopilot369Database({throughMigration: "001_study_foundation"});
    const fixture = await createReadinessProfiles();
    try {
        const empty = await classifyStudyReadiness({pool: database.pool, profiles: fixture.profiles});
        assert.equal(empty.schema, "001_study_foundation");
        assert.equal(empty.dataBundle, "empty");
        await runStudyMigrations(database.pool);
        await prepareStudyProfiles({pool: database.pool, profiles: fixture.profiles});
        await database.pool.query(`INSERT INTO participant_category(study_id, participant_id, raw_name, normalized_name)
            SELECT study_id, reviewer_id, 'private fixture', 'private fixture' FROM study_participant WHERE ordinal = 0`);
        await database.pool.query(`INSERT INTO pr_classification(pr_card_id, participant_id, category_id, study_id, remarks)
            SELECT card.pr_card_id, participant.reviewer_id, category.id, card.study_id, 'persisted private decision'
            FROM study_card card JOIN study_participant participant ON participant.study_id = card.study_id AND participant.ordinal = 0
            JOIN participant_category category ON category.study_id = card.study_id AND category.participant_id = participant.reviewer_id
            WHERE card.ordinal = 0`);
        await database.pool.query(`INSERT INTO pr_discard(pr_card_id, participant_id, study_id, reason)
            SELECT card.pr_card_id, participant.reviewer_id, card.study_id, 'persisted private discard'
            FROM study_card card JOIN study_participant participant ON participant.study_id = card.study_id AND participant.ordinal = 1
            WHERE card.ordinal = 1`);
        const before = await classifyStudyReadiness({pool: database.pool, profiles: fixture.profiles});
        assert.equal(before.schema, "study-schema-3");
        assert.equal(before.dataBundle, "copilot369-v1");
        const sql = [];
        const pool = {connect: async () => {
            const client = await database.pool.connect();
            return {query: (query, values) => { sql.push(query); return client.query(query, values); }, release: () => client.release()};
        }};
        const after = await classifyStudyReadiness({pool, profiles: fixture.profiles});
        assert.equal(after.fingerprint, before.fingerprint);
        assert.ok(sql.length > 20);
        assert.ok(sql.every(query => /^\s*(?:SELECT|SHOW|BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY|COMMIT|ROLLBACK)\b/.test(query)
            || ["SET LOCAL search_path TO public, pg_catalog, pg_temp", "SET LOCAL search_path TO pg_catalog, public, pg_temp", "SET LOCAL TIME ZONE 'UTC'"].includes(query)));
    } finally {
        await closeCopilot369Database(database);
        await rm(fixture.root, {recursive: true, force: true});
    }
});

test("readiness blocks physical drift and unknown objects before any mutation", async () => {
    const database = await startCopilot369Database({throughMigration: "001_study_foundation"});
    try {
        await database.pool.query("CREATE TABLE public.unexpected_legacy(id integer)");
        await assert.rejects(classifyStudyReadiness({pool: database.pool, profiles: []}), /Unknown physical/);
    } finally {
        await closeCopilot369Database(database);
    }
});

test("strict inspection verifies effective grants and READ ONLY instead of trusting client flags", async () => {
    const database = await startCopilot369Database({throughMigration: "001_study_foundation"});
    let readonly;
    try {
        await assert.rejects(classifyStudyReadiness({pool: database.pool, profiles: [], requireRestrictedRole: true}), /grant-verified/);
        await database.pool.query(`CREATE ROLE readiness_inspector LOGIN;
            REVOKE CREATE ON SCHEMA public FROM PUBLIC;
            REVOKE TEMP ON DATABASE labeler_test FROM PUBLIC;
            GRANT pg_read_all_stats TO readiness_inspector;
            GRANT CONNECT ON DATABASE labeler_test TO readiness_inspector;
            GRANT USAGE ON SCHEMA public TO readiness_inspector;
            GRANT SELECT ON ALL TABLES IN SCHEMA public TO readiness_inspector;
            GRANT EXECUTE ON FUNCTION pg_control_system() TO readiness_inspector`);
        readonly = new pg.Pool({...database.pool.options, user: "readiness_inspector", max: 1});
        const result = await classifyStudyReadiness({pool: readonly, profiles: [], requireRestrictedRole: true});
        assert.equal(result.readOnly.grantsVerified, true);
        assert.equal(result.readOnly.transaction, "read-only");
        await database.pool.query("GRANT UPDATE ON public.study TO readiness_inspector");
        await assert.rejects(classifyStudyReadiness({pool: readonly, profiles: [], requireRestrictedRole: true}), /grant-verified/);
    } finally {
        if (readonly) await readonly.end();
        await closeCopilot369Database(database);
    }
});

test("readiness inventories the historical 300 pair without converting it or modifying protected data", async () => {
    const database = await startCopilot369Database();
    const fixture = await createReadinessProfiles();
    try {
        await seedHistoricalCopilot369Studies({pool: database.pool});
        await database.pool.query("UPDATE participant_account SET password_hash = $1", [fixture.profiles[0].bootstrapInput.credentialManifest.accounts[0].passwordHash]);
        const options = {pool: database.pool, profiles: fixture.profiles,
            legacyCsvPath: new URL("../plans/merged_after_rework_cards_seed_20260510.csv", import.meta.url)};
        const before = await classifyStudyReadiness(options);
        assert.equal(before.dataBundle, "legacy300-v1");
        const after = await classifyStudyReadiness(options);
        assert.equal(after.fingerprint, before.fingerprint);
        const {rows} = await database.pool.query("SELECT expected_card_count FROM study ORDER BY study_key");
        assert.deepEqual(rows.map(row => row.expected_card_count), [300, 30]);
    } finally {
        await closeCopilot369Database(database);
        await rm(fixture.root, {recursive: true, force: true});
    }
});

test("readiness admits an actually empty provisioned database but rejects unknown functions without tables", async () => {
    const database = await startCopilot369Database({throughMigration: "001_study_foundation"});
    let empty;
    try {
        await database.pool.query("CREATE DATABASE readiness_empty");
        empty = new pg.Pool({...database.pool.options, database: "readiness_empty", max: 1});
        const result = await classifyStudyReadiness({pool: empty, profiles: []});
        assert.equal(result.schema, "empty");
        assert.equal(result.dataBundle, "empty");
        await empty.query("CREATE FUNCTION public.unexpected() RETURNS integer LANGUAGE SQL AS 'SELECT 1'");
        await assert.rejects(classifyStudyReadiness({pool: empty, profiles: []}), /Unknown objects/);
    } finally {
        if (empty) await empty.end();
        await closeCopilot369Database(database);
    }
});

test("a partial profile pair is rejected without completing the missing study", async () => {
    const database = await startCopilot369Database();
    const fixture = await createReadinessProfiles();
    try {
        await bootstrapStudy({pool: database.pool, ...fixture.profiles[0].bootstrapInput});
        const before = (await database.pool.query("SELECT id, study_key, created_at, updated_at FROM study")).rows;
        await assert.rejects(classifyStudyReadiness({pool: database.pool, profiles: fixture.profiles}), /Partial, drifted/);
        assert.deepEqual((await database.pool.query("SELECT id, study_key, created_at, updated_at FROM study")).rows, before);
    } finally {
        await closeCopilot369Database(database);
        await rm(fixture.root, {recursive: true, force: true});
    }
});
