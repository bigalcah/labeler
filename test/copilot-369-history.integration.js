import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {test} from "node:test";
import {rm} from "node:fs/promises";
import {createReadinessProfiles} from "./readiness-fixture.js";
import {classifyStudyReadiness, probeStudyHistory} from "../util/study-readiness.js";
import {preserveStudyCardHistory} from "../util/study-history.js";
import {prepareStudyProfiles} from "../util/study-preparation.js";
import {startCopilot369Database, closeCopilot369Database, seedHistoricalCopilot369Studies} from "./support/copilot-369-fixture.js";

const migrationUrl = new URL("../schema/migrations/016_preserve_study_card_history.sql", import.meta.url);
const protectedTables = ["study", "study_card", "study_participant", "participant_account", "participant_category",
    "pr_cards", "pr_classification", "pr_discard", "github_enrichment_run", "github_run_page",
    "github_enrichment_run_card", "github_card_snapshot", "study_enrichment_promotion", "github_api_telemetry_event"];
const fingerprint = async pool => Object.fromEntries(await Promise.all(protectedTables.map(async table => {
    const {rows: [row]} = await pool.query(`SELECT md5(COALESCE(string_agg(
        to_jsonb(record)::text || record.xmin::text,'' ORDER BY to_jsonb(record)::text),'')) AS hash FROM ${table} record`);
    return [table, row.hash];
})));

test("history migration retains enriched 013 rows including xmin and validates replacement FKs", async context => {
    const db = await startCopilot369Database({throughMigration: "013_category_definition_color"});
    context.after(() => closeCopilot369Database(db));
    const ids = await seedHistoricalCopilot369Studies(db, {enriched: true});
    const before = await fingerprint(db.pool);
    assert.deepEqual((await db.pool.query(
        "SELECT state,count(*)::integer AS count FROM github_enrichment_run GROUP BY state ORDER BY state")).rows,
    [{state: "COMPLETED", count: 2}, {state: "FAILED", count: 2}]);
    assert.equal((await db.pool.query("SELECT count(*)::integer AS count FROM participant_account")).rows[0].count, 6);
    await db.pool.query(await readFile(new URL("../schema/migrations/014_copilot_369_cardinality.sql", import.meta.url), "utf8"));
    await db.pool.query(await readFile(migrationUrl, "utf8"));
    assert.deepEqual(await fingerprint(db.pool), before);
    assert.equal((await db.pool.query("SELECT count(*)::integer AS count FROM study_card_reference")).rows[0].count, 330);
    assert.equal((await db.pool.query("SELECT count(*)::integer AS count FROM study_source_membership")).rows[0].count, 330);
    const {rows: fks} = await db.pool.query(`SELECT conrelid::regclass::text AS child,convalidated,
        confrelid::regclass::text AS parent FROM pg_constraint WHERE contype='f'
        AND conrelid IN ('github_run_page'::regclass,'github_enrichment_run_card'::regclass)
        AND confrelid IN ('study_card'::regclass,'study_card_reference'::regclass) ORDER BY child`);
    assert.deepEqual(fks, ["github_enrichment_run_card", "github_run_page"].map(child => ({
        child, convalidated: true, parent: "study_card_reference",
    })));
    await db.pool.query("DELETE FROM study_card WHERE study_id=$1", [ids.primaryStudyId]);
    const after = await fingerprint(db.pool);
    for (const table of protectedTables.filter(table => table !== "study_card")) assert.equal(after[table], before[table], table);
    for (const table of ["study_card_reference", "study_source_membership"]) {
        await assert.rejects(db.pool.query(`DELETE FROM ${table} WHERE study_id=$1`, [ids.primaryStudyId]), /append-only/);
        await assert.rejects(db.pool.query(`UPDATE ${table} SET study_id=study_id WHERE study_id=$1`, [ids.primaryStudyId]), /append-only/);
        await assert.rejects(db.pool.query(`TRUNCATE ${table} CASCADE`), /append-only/);
    }
    const {rows: [running]} = await db.pool.query(`INSERT INTO github_enrichment_run(
        study_id,source_checksum,config_fingerprint,normalizer_version,state)
        VALUES($1,'unknown-source','fixture','fixture','RUNNING') RETURNING id`, [ids.primaryStudyId]);
    const {rows: [card]} = await db.pool.query("SELECT pr_card_id FROM study_card_reference WHERE study_id=$1 LIMIT 1", [ids.primaryStudyId]);
    await assert.rejects(db.pool.query(`INSERT INTO github_run_page(run_id,study_id,pr_card_id,endpoint,
        page_ordinal,request_fingerprint,api_version,accept,state)
        VALUES($1,$2,$3,'pulls',0,'fixture','fixture','fixture','PARTIAL')`,
    [running.id, ids.primaryStudyId, card.pr_card_id]), /run source membership/);
    const {rows: [closed]} = await db.pool.query("SELECT id FROM github_enrichment_run WHERE study_id=$1 AND state='FAILED'", [ids.primaryStudyId]);
    await assert.rejects(db.pool.query("DELETE FROM github_run_page WHERE run_id=$1", [closed.id]), /immutable/);
    await db.pool.query(`UPDATE github_enrichment_run SET source_checksum=(SELECT source_checksum FROM study WHERE id=$2)
        WHERE id=$1`, [running.id, ids.primaryStudyId]);
    await assert.rejects(db.pool.query("UPDATE github_run_page SET run_id=$1 WHERE run_id=$2", [running.id, closed.id]),
        /Terminal enrichment history is immutable/);
});

test("history migration rejects RUNNING or unknown source without adding metadata or a ledger row", async context => {
    for (const source of ["running", "unknown"]) {
        const db = await startCopilot369Database();
        context.after(() => closeCopilot369Database(db));
        const {primaryStudyId} = await seedHistoricalCopilot369Studies(db);
        const {rows: [run]} = await db.pool.query(`INSERT INTO github_enrichment_run(
            study_id,source_checksum,config_fingerprint,normalizer_version,state)
            SELECT id,CASE WHEN $2='unknown' THEN 'unknown' ELSE source_checksum END,
            'fixture','fixture','RUNNING' FROM study WHERE id=$1 RETURNING id`, [primaryStudyId, source]);
        if (source === "unknown") await db.pool.query("UPDATE github_enrichment_run SET state='FAILED' WHERE id=$1", [run.id]);
        const before = await fingerprint(db.pool);
        const client = await db.pool.connect();
        try {
            await assert.rejects(client.query(await readFile(migrationUrl, "utf8")), /RUNNING|Unknown source/);
            await client.query("ROLLBACK");
        } finally { client.release(); }
        assert.deepEqual(await fingerprint(db.pool), before);
        assert.equal((await db.pool.query("SELECT to_regclass('study_card_reference') AS relation")).rows[0].relation, null);
        assert.equal((await db.pool.query("SELECT 1 FROM labeler_migration WHERE migration_id='016_preserve_study_card_history'")).rows.length, 0);
    }
});

test("locked history operation verifies physical schema-4 and repeats without rewriting protected rows", async context => {
    const db = await startCopilot369Database();
    context.after(() => closeCopilot369Database(db));
    const fixture = await createReadinessProfiles();
    context.after(() => rm(fixture.root, {recursive: true, force: true}));
    await seedHistoricalCopilot369Studies(db, {enriched: true});
    await db.pool.query("UPDATE participant_account SET password_hash=$1", [fixture.profiles[0].bootstrapInput.credentialManifest.accounts[0].passwordHash]);
    const options = {pool: db.pool, profiles: fixture.profiles,
        legacyCsvPath: new URL("../plans/merged_after_rework_cards_seed_20260510.csv", import.meta.url)};
    const {rows: [running]} = await db.pool.query(`INSERT INTO github_enrichment_run(
        study_id,source_checksum,config_fingerprint,normalizer_version,state)
        SELECT id,source_checksum,'eligibility-fixture','fixture','RUNNING'
        FROM study WHERE study_key='pr-card-sorting-local' RETURNING id`);
    assert.equal((await probeStudyHistory(options)).eligibility, "ineligible");
    await db.pool.query("UPDATE github_enrichment_run SET state='FAILED' WHERE id=$1", [running.id]);
    assert.equal((await probeStudyHistory(options)).eligibility, "eligible");
    const baseline = await classifyStudyReadiness(options);
    const before = await fingerprint(db.pool);
    assert.equal(baseline.schema, "study-schema-3");
    const result = await preserveStudyCardHistory({...options, baseline});
    assert.equal(result.changed, true);
    assert.equal(result.observation.schema, "study-schema-4");
    assert.equal(result.observation.dataBundle, "legacy300-v1");
    assert.deepEqual(await fingerprint(db.pool), before);
    const repeated = await preserveStudyCardHistory({...options, baseline: result.observation});
    assert.equal(repeated.changed, false);
    assert.equal(repeated.observation.fingerprint, result.observation.fingerprint);
    assert.deepEqual(await fingerprint(db.pool), before);
});

for (const prefix of ["013_category_definition_color", "014_copilot_369_cardinality"]) {
    test(`history rollback from ${prefix} leaves no partial DDL or ledger and a retry preserves enriched rows`, async context => {
        const db = await startCopilot369Database({throughMigration: prefix});
        context.after(() => closeCopilot369Database(db));
        const fixture = await createReadinessProfiles();
        context.after(() => rm(fixture.root, {recursive: true, force: true}));
        await seedHistoricalCopilot369Studies(db, {enriched: true});
        await db.pool.query("UPDATE participant_account SET password_hash=$1", [fixture.profiles[0].bootstrapInput.credentialManifest.accounts[0].passwordHash]);
        const options = {pool: db.pool, profiles: fixture.profiles,
            legacyCsvPath: new URL("../plans/merged_after_rework_cards_seed_20260510.csv", import.meta.url)};
        const baseline = await classifyStudyReadiness(options);
        const before = await fingerprint(db.pool);
        const {rows: ledger} = await db.pool.query("SELECT to_jsonb(record) AS row,xmin::text FROM labeler_migration record ORDER BY migration_id");
        const interrupted = {connect: async () => {
            const client = await db.pool.connect();
            return {release: () => client.release(), query: async (sql, parameters) => {
                const result = await client.query(sql, parameters);
                if (sql.includes("CREATE TABLE study_card_reference")) throw new Error("injected failure after history DDL");
                return result;
            }};
        }};
        await assert.rejects(preserveStudyCardHistory({...options, pool: interrupted, baseline}), /injected failure/);
        assert.deepEqual(await fingerprint(db.pool), before);
        assert.deepEqual((await db.pool.query("SELECT to_jsonb(record) AS row,xmin::text FROM labeler_migration record ORDER BY migration_id")).rows, ledger);
        assert.equal((await db.pool.query("SELECT to_regclass('study_card_reference') AS relation")).rows[0].relation, null);
        const retried = await preserveStudyCardHistory({...options, baseline});
        assert.equal(retried.observation.schema, "study-schema-4");
        assert.deepEqual(await fingerprint(db.pool), before);
    });
}

test("empty initialization and existing 369 pair prepare preserve data after the authorized history step", async context => {
    const db = await startCopilot369Database();
    context.after(() => closeCopilot369Database(db));
    const fixture = await createReadinessProfiles();
    context.after(() => rm(fixture.root, {recursive: true, force: true}));
    const options = {pool: db.pool, profiles: fixture.profiles};
    const empty = await classifyStudyReadiness(options);
    assert.equal(empty.dataBundle, "empty");
    await preserveStudyCardHistory({...options, baseline: empty});
    await prepareStudyProfiles(options);
    assert.equal((await classifyStudyReadiness(options)).schema, "study-schema-4");
    assert.equal((await db.pool.query("SELECT count(*)::integer AS count FROM study_source_membership")).rows[0].count, 399);
    await db.pool.query(`INSERT INTO pr_discard(study_id,pr_card_id,participant_id,reason)
        SELECT card.study_id,card.pr_card_id,participant.reviewer_id,'preserve existing decision'
        FROM study_card card JOIN study_participant participant USING(study_id) WHERE card.ordinal=0 AND participant.ordinal=0`);
    const before = await fingerprint(db.pool);
    await prepareStudyProfiles(options);
    const existing = await classifyStudyReadiness(options);
    assert.equal(existing.dataBundle, "copilot369-v1");
    assert.equal((await preserveStudyCardHistory({...options, baseline: existing})).changed, false);
    assert.deepEqual(await fingerprint(db.pool), before);
});

test("a lost 016 commit response is observed as schema-4 and repeated without DDL or protected row rewrites", async context => {
    const db = await startCopilot369Database();
    context.after(() => closeCopilot369Database(db));
    const fixture = await createReadinessProfiles();
    context.after(() => rm(fixture.root, {recursive: true, force: true}));
    await seedHistoricalCopilot369Studies(db, {enriched: true});
    await db.pool.query("UPDATE participant_account SET password_hash=$1", [fixture.profiles[0].bootstrapInput.credentialManifest.accounts[0].passwordHash]);
    const options = {pool: db.pool, profiles: fixture.profiles,
        legacyCsvPath: new URL("../plans/merged_after_rework_cards_seed_20260510.csv", import.meta.url)};
    const baseline = await classifyStudyReadiness(options);
    const before = await fingerprint(db.pool);
    let ddlStarted = false;
    const interrupted = {connect: async () => {
        const client = await db.pool.connect();
        return {release: () => client.release(), query: async (sql, values) => {
            if (sql.includes("CREATE TABLE study_card_reference")) ddlStarted = true;
            const result = await client.query(sql, values);
            if (ddlStarted && sql === "COMMIT") throw new Error("lost committed 016 response");
            return result;
        }};
    }};
    await assert.rejects(preserveStudyCardHistory({...options, pool: interrupted, baseline}), /lost committed 016 response/);
    const actual = await classifyStudyReadiness(options);
    assert.equal(actual.schema, "study-schema-4");
    assert.deepEqual(await fingerprint(db.pool), before);
    const statements = [];
    const observed = {connect: async () => {
        const client = await db.pool.connect();
        return {release: () => client.release(), query: (sql, values) => {
            statements.push(sql);
            return client.query(sql, values);
        }};
    }};
    assert.equal((await preserveStudyCardHistory({...options, pool: observed, baseline: actual})).changed, false);
    assert.ok(statements.every(sql => !/^(CREATE|ALTER|INSERT|UPDATE|DELETE|LOCK|SELECT pg_advisory)/.test(sql)));
    assert.deepEqual(await fingerprint(db.pool), before);
});
