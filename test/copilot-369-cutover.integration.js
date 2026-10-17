import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {mkdtemp, readFile, rm, writeFile} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {spawn} from "node:child_process";
import {test} from "node:test";
import pg from "pg";
import {parse} from "csv-parse/sync";
import {cutoverCopilot369} from "../util/copilot-369-cutover.js";
import {CUTOVER_CONFIRMATION, LEGACY_300_CHECKSUM} from "../util/copilot-369-cutover-preflight.js";
import {CUTOVER_TABLES} from "../util/copilot-369-schema-contract.js";
import {COPILOT_369_SOURCE_CHECKSUM, readCopilot369Cards} from "../util/copilot-369-source.js";
import {persistCopilot369Cards} from "../util/copilot-369-persistence.js";
import {createStudyService} from "../util/study-service.js";
import {closeCopilot369Database, fingerprintProtectedCopilot369State,
    seedHistoricalCopilot369Studies, startCopilot369Database} from "./support/copilot-369-fixture.js";

const fixture = async (context, settings) => {
    const db = await startCopilot369Database(settings);
    context.after(() => closeCopilot369Database(db));
    const ids = await seedHistoricalCopilot369Studies(db);
    await db.pool.query(`INSERT INTO participant_account(study_id,reviewer_id,normalized_username,password_hash,credential_version)
        SELECT member.study_id,member.reviewer_id,member.participant_key || CASE WHEN study.expected_card_count=30 THEN '-30' ELSE '' END,
            'synthetic-only-' || member.study_id || '-' || member.participant_key,member.ordinal+1
        FROM study_participant member JOIN study ON study.id=member.study_id
        ON CONFLICT(study_id,reviewer_id) DO NOTHING`);
    assert.equal((await db.pool.query("SELECT count(*)::integer AS count FROM participant_account")).rows[0].count, 6);
    const {rows: [study]} = await db.pool.query("SELECT config FROM study WHERE id = $1", [ids.primaryStudyId]);
    const {rows: members} = await db.pool.query("SELECT pr_card_id, source_card_id, ordinal, source_checksum FROM study_card WHERE study_id = $1 ORDER BY ordinal", [ids.primaryStudyId]);
    const options = {pool: db.pool, confirmation: CUTOVER_CONFIRMATION,
        maintenance: {applicationStopped: true, preparationStopped: true, enrichmentStopped: true, schemaWritersStopped: true},
        expectedStudyId: ids.primaryStudyId, expectedStudyKey: "pr-card-sorting-local", expectedLegacyConfig: study.config,
        expectedLegacyChecksum: LEGACY_300_CHECKSUM, expectedTargetChecksum: COPILOT_369_SOURCE_CHECKSUM,
        expectedLegacyMemberships: members, legacyCsvPath: "plans/merged_after_rework_cards_seed_20260510.csv",
        targetCsvPath: "plans/copilot-369-cards.csv", targetManifestPath: "plans/copilot-369-cards.manifest.json"};
    return {...db, ...ids, options};
};
const state = async pool => Object.fromEntries(await Promise.all(CUTOVER_TABLES.map(async table => {
    const {rows} = await pool.query(`SELECT md5(COALESCE(string_agg(to_jsonb(record)::text || record.xmin::text, '' ORDER BY to_jsonb(record)::text), '')) AS hash FROM public.${table} record`);
    return [table, rows[0].hash];
})));
const categoryAndCard = async db => {
    const {rows: [participant]} = await db.pool.query("SELECT reviewer_id FROM study_participant WHERE study_id = $1 ORDER BY ordinal LIMIT 1", [db.primaryStudyId]);
    const context = {studyId: db.primaryStudyId, participantId: participant.reviewer_id};
    const service = createStudyService({pool: db.pool});
    const category = await service.createCategory(context, {name: "Preserved primary category", definition: "Synthetic"});
    const {rows: [card]} = await db.pool.query("SELECT pr_card_id FROM study_card WHERE study_id = $1 ORDER BY ordinal LIMIT 1", [db.primaryStudyId]);
    return {context, service, category, card};
};
const runCli = argumentsList => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["scripts/cutover-copilot-369.js", ...argumentsList], {stdio: ["ignore", "pipe", "pipe"]});
    let stdout = "", stderr = "";
    child.stdout.on("data", chunk => { stdout += chunk; });
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.on("error", reject);
    child.on("exit", code => resolve({code, stdout, stderr}));
});

test("cutover preserves every original card, snapshot, identity and protected30 when eligible", async context => {
    const db = await fixture(context);
    await categoryAndCard(db);
    const before = await fingerprintProtectedCopilot369State(db.pool, db.validationStudyId);
    const original = await state(db.pool);
    const {rows: oldCards} = await db.pool.query("SELECT to_jsonb(card) AS card FROM pr_cards card ORDER BY id");
    const result = await cutoverCopilot369(db.options);
    assert.equal(result.status, "CUTOVER_369");
    const target = await readCopilot369Cards(db.options.targetCsvPath);
    const {rows: members} = await db.pool.query("SELECT source_card_id, ordinal FROM study_card WHERE study_id = $1 ORDER BY ordinal", [db.primaryStudyId]);
    assert.deepEqual(members, target.cards.map((card, ordinal) => ({source_card_id: card.source_card_id, ordinal})));
    assert.deepEqual(await fingerprintProtectedCopilot369State(db.pool, db.validationStudyId), before);
    const {rows: retained} = await db.pool.query("SELECT to_jsonb(card) AS card FROM pr_cards card WHERE id = ANY($1::uuid[]) ORDER BY id", [oldCards.map(row => row.card.id)]);
    assert.deepEqual(retained, oldCards);
    const after = await state(db.pool);
    for (const table of CUTOVER_TABLES.filter(table => !["pr_cards", "study", "study_card"].includes(table))) assert.equal(after[table], original[table], table);
});

test("replay is genuinely readonly when primary decisions and enrichment history exist", async context => {
    const db = await fixture(context);
    await cutoverCopilot369(db.options);
    const {service, category, card, context: participant} = await categoryAndCard(db);
    await service.classifyCard(participant, card.pr_card_id, {categoryId: category.id, expectedRevision: 0});
    const next = await service.resolveQueue(participant);
    await service.discardCard(participant, next, {expectedRevision: 0});
    await db.pool.query("INSERT INTO github_enrichment_run(study_id, source_checksum, config_fingerprint, normalizer_version, state) VALUES ($1, $2, 'synthetic', 'synthetic', 'RUNNING')", [db.primaryStudyId, COPILOT_369_SOURCE_CHECKSUM]);
    const role = `readonly_${randomUUID().replaceAll("-", "")}`;
    await db.pool.query(`CREATE ROLE ${role} LOGIN; GRANT USAGE ON SCHEMA public TO ${role}; GRANT SELECT ON ALL TABLES IN SCHEMA public TO ${role}; ALTER ROLE ${role} SET default_transaction_read_only = on`);
    const pool = new pg.Pool({...db.pool.options, user: role});
    try {
        const before = await state(db.pool);
        const statements = [];
        const wrapped = {connect: async () => {
            const client = await pool.connect();
            return {release: () => client.release(), query: async (sql, values) => {
                statements.push(sql);
                const result = await client.query(sql, values);
                if (sql.startsWith("BEGIN")) assert.equal((await client.query("SHOW transaction_read_only")).rows[0].transaction_read_only, "on");
                return result;
            }};
        }};
        assert.equal((await cutoverCopilot369({...db.options, pool: wrapped})).status, "ALREADY_369");
        assert.equal(statements[0], "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
        assert.equal(statements.some(sql => /^(INSERT|UPDATE|DELETE|LOCK|SELECT pg_advisory)/.test(sql)), false);
        assert.deepEqual(await state(db.pool), before);
        const {rows: [member]} = await db.pool.query("SELECT * FROM study_card WHERE study_id=$1 AND ordinal=368", [db.primaryStudyId]);
        await db.pool.query("DELETE FROM study_card WHERE study_id=$1 AND ordinal=368", [db.primaryStudyId]);
        const drifted = await state(db.pool);
        await assert.rejects(cutoverCopilot369({...db.options, pool: wrapped}), /membership/);
        assert.deepEqual(await state(db.pool), drifted);
        await db.pool.query("INSERT INTO study_card(study_id,pr_card_id,source_card_id,ordinal,source_checksum) VALUES ($1,$2,$3,$4,$5)", [member.study_id, member.pr_card_id, member.source_card_id, member.ordinal, member.source_checksum]);
    } finally { await pool.end(); }
});

test("all operator and persisted preconditions fail without changing data when drifted", async context => {
    const db = await fixture(context);
    const invalid = [{confirmation: ""}, {maintenance: {...db.options.maintenance, schemaWritersStopped: false}},
        {expectedStudyId: randomUUID()}, {expectedStudyKey: "other"}, {expectedLegacyChecksum: "wrong"},
        {expectedTargetChecksum: "wrong"}, {expectedLegacyConfig: {...db.options.expectedLegacyConfig, expectedCardCount: 30}},
        {expectedLegacyMemberships: [...db.options.expectedLegacyMemberships].reverse()},
        {expectedLegacyMemberships: db.options.expectedLegacyMemberships.slice(1)},
        {expectedLegacyMemberships: db.options.expectedLegacyMemberships.map((member, ordinal) => ordinal === 0
            ? {...member, source_checksum: LEGACY_300_CHECKSUM} : member)}];
    for (const overrides of invalid) {
        const before = await state(db.pool);
        await assert.rejects(cutoverCopilot369({...db.options, ...overrides}));
        assert.deepEqual(await state(db.pool), before);
    }
    for (const mutation of ["expected_card_count = 30", "source_checksum = 'drift'", "config = config || '{\"unexpected\":true}'::jsonb", "bootstrap_state = 'PENDING'"]) {
        const {rows: [old]} = await db.pool.query("SELECT * FROM study WHERE id = $1", [db.primaryStudyId]);
        await db.pool.query(`UPDATE study SET ${mutation} WHERE id = $1`, [db.primaryStudyId]);
        const before = await state(db.pool);
        await assert.rejects(cutoverCopilot369(db.options));
        assert.deepEqual(await state(db.pool), before);
        await db.pool.query("UPDATE study SET expected_card_count=$2,source_checksum=$3,config=$4,bootstrap_state=$5 WHERE id=$1", [old.id, old.expected_card_count, old.source_checksum, old.config, old.bootstrap_state]);
    }
});

test("invalid duplicate, malformed, wrong-agent, wrong-source and count CSVs never connect to PostgreSQL", async context => {
    const db = await fixture(context);
    const directory = await mkdtemp(path.join(os.tmpdir(), "copilot369-invalid-"));
    context.after(() => rm(directory, {recursive: true, force: true}));
    const rows = parse(await readFile(db.options.targetCsvPath));
    const variants = [records => { records[2] = records[1]; }, records => { records[1][records[0].indexOf("reviews_json")] = "{"; },
        records => { records[1][records[0].indexOf("agent")] = "Other"; }, records => { records.pop(); }];
    let connections = 0;
    const pool = {connect: () => { connections += 1; throw new Error("Unexpected database connection"); }};
    for (const [index, mutate] of variants.entries()) {
        const records = structuredClone(rows);
        mutate(records);
        const file = path.join(directory, `${index}.csv`);
        await writeFile(file, records.map(row => row.map(value => `"${value.replaceAll("\"", "\"\"")}"`).join(",")).join("\n"));
        await assert.rejects(cutoverCopilot369({...db.options, pool, targetCsvPath: file}), {code: "CSV_CHECKSUM_MISMATCH"});
    }
    await assert.rejects(cutoverCopilot369({...db.options, pool, targetCsvPath: db.options.legacyCsvPath}), {code: "CSV_CHECKSUM_MISMATCH"});
    assert.equal(connections, 0);
});

test("unrecognized schema objects, dependencies, functions and disabled triggers block without mutation", async context => {
    const db = await fixture(context);
    const {rows: [knownFunction]} = await db.pool.query("SELECT pg_get_functiondef('github_reject_snapshot_mutation()'::regprocedure) AS definition");
    const cases = [
        ["CREATE TABLE unexpected_study_history(study_id uuid)", "DROP TABLE unexpected_study_history"],
        ["CREATE TABLE unexpected_reference(study_id uuid REFERENCES study(id))", "DROP TABLE unexpected_reference"],
        ["CREATE TABLE unexpected_member(study_id uuid, pr_card_id uuid, FOREIGN KEY(study_id,pr_card_id) REFERENCES study_card(study_id,pr_card_id))", "DROP TABLE unexpected_member"],
        ["ALTER TABLE study ALTER COLUMN source_checksum DROP NOT NULL", "ALTER TABLE study ALTER COLUMN source_checksum SET NOT NULL"],
        ["CREATE INDEX unexpected_index ON study(updated_at)", "DROP INDEX unexpected_index"],
        ["ALTER TABLE study ADD CONSTRAINT unexpected_check CHECK(expected_card_count > 0)", "ALTER TABLE study DROP CONSTRAINT unexpected_check"],
        ["CREATE FUNCTION unexpected_hook() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$; CREATE TRIGGER unexpected_trigger BEFORE UPDATE ON study FOR EACH ROW EXECUTE FUNCTION unexpected_hook()", "DROP TRIGGER unexpected_trigger ON study; DROP FUNCTION unexpected_hook()"],
        ["ALTER TABLE github_run_page DISABLE TRIGGER github_run_page_terminal_immutable", "ALTER TABLE github_run_page ENABLE TRIGGER github_run_page_terminal_immutable"],
        ["CREATE OR REPLACE FUNCTION github_reject_snapshot_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$", knownFunction.definition],
        ["INSERT INTO labeler_migration(migration_id) VALUES ('999_unknown')", "DELETE FROM labeler_migration WHERE migration_id='999_unknown'"],
    ];
    for (const [setup, teardown] of cases) {
        await db.pool.query(setup);
        const before = await state(db.pool);
        await assert.rejects(cutoverCopilot369(db.options), /schema|ledger/);
        assert.deepEqual(await state(db.pool), before);
        await db.pool.query(teardown);
    }
    await cutoverCopilot369(db.options);
});

test("preexisting target cards with null checksums or shared content conflicts cannot be backfilled", async context => {
    const db = await fixture(context);
    const target = await readCopilot369Cards(db.options.targetCsvPath);
    await persistCopilot369Cards(db.pool, target.cards, target.sourceChecksum);
    const {rows: [card]} = await db.pool.query("SELECT id, content_checksum, title FROM pr_cards WHERE source_card_id=$1", [target.cards[0].source_card_id]);
    await db.pool.query("INSERT INTO github_card_snapshot(pr_card_id,snapshot_checksum,normalizer_version,manifest) VALUES ($1,'shared','synthetic','{}')", [card.id]);
    for (const mutation of ["content_checksum = NULL", "source_checksum = NULL", "title = 'conflicting shared content'"]) {
        await db.pool.query(`UPDATE pr_cards SET ${mutation} WHERE id = $1`, [card.id]);
        const before = await state(db.pool);
        await assert.rejects(cutoverCopilot369(db.options), /differs/);
        assert.deepEqual(await state(db.pool), before);
        await db.pool.query("UPDATE pr_cards SET content_checksum=$2,source_checksum=$3,title=$4 WHERE id=$1", [card.id, card.content_checksum, COPILOT_369_SOURCE_CHECKSUM, card.title]);
    }
    const before = await state(db.pool);
    assert.equal((await cutoverCopilot369(db.options)).status, "CUTOVER_369");
    const after = await state(db.pool);
    assert.equal(after.pr_cards, before.pr_cards);
    assert.equal(after.github_card_snapshot, before.github_card_snapshot);
});

test("cutover CLI requires explicit request and works only against the UUID-owned disposable fixture", async context => {
    const db = await fixture(context);
    const directory = await mkdtemp(path.join(os.tmpdir(), "copilot369-cli-"));
    context.after(() => rm(directory, {recursive: true, force: true}));
    const passwordFile = path.join(directory, "synthetic-password");
    await writeFile(passwordFile, "synthetic-only", {mode: 0o600});
    const requestPath = path.join(directory, "request.json");
    const {pool: _pool, ...request} = db.options;
    await writeFile(requestPath, JSON.stringify({...request, database: {host: "127.0.0.1", port: db.pool.options.port,
        database: "labeler_test", user: "labeler_test", passwordFile}}));
    assert.equal((await runCli(["--help"])).code, 0);
    assert.equal((await runCli(["--invalid"])).code, 1);
    const result = await runCli(["--request", requestPath]);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).status, "CUTOVER_369");
    assert.equal(JSON.parse((await runCli(["--request", requestPath])).stdout).status, "ALREADY_369");
});
