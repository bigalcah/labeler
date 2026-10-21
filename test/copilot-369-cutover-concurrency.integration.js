import assert from "node:assert/strict";
import {test} from "node:test";
import {readFile} from "node:fs/promises";
import {cutoverCopilot369} from "../util/copilot-369-cutover.js";
import {CUTOVER_CONFIRMATION, LEGACY_300_CHECKSUM} from "../util/copilot-369-cutover-preflight.js";
import {CUTOVER_TABLES} from "../util/copilot-369-schema-contract.js";
import {COPILOT_369_SOURCE_CHECKSUM} from "../util/copilot-369-source.js";
import {createStudyService} from "../util/study-service.js";
import {lockStudyCard, createStudyClassification, createStudyDiscard} from "../util/study-write-repository.js";
import {closeCopilot369Database, fingerprintProtectedCopilot369State,
    seedHistoricalCopilot369Studies, startCopilot369Database} from "./support/copilot-369-fixture.js";

const fixture = async (context, settings) => {
    const db = await startCopilot369Database(settings);
    context.after(() => closeCopilot369Database(db));
    const ids = await seedHistoricalCopilot369Studies(db);
    if (settings?.throughMigration !== "013_category_definition_color") {
        await db.pool.query(await readFile(new URL("../schema/migrations/016_preserve_study_card_history.sql", import.meta.url), "utf8"));
    }
    await db.pool.query(`INSERT INTO participant_account(study_id,reviewer_id,normalized_username,password_hash,credential_version)
        SELECT member.study_id,member.reviewer_id,member.participant_key || CASE WHEN study.expected_card_count=30 THEN '-30' ELSE '' END,
            'synthetic-only-' || member.study_id || '-' || member.participant_key,member.ordinal+1
        FROM study_participant member JOIN study ON study.id=member.study_id
        ON CONFLICT(study_id,reviewer_id) DO NOTHING`);
    assert.equal((await db.pool.query("SELECT count(*)::integer AS count FROM participant_account")).rows[0].count, 6);
    const {rows: [study]} = await db.pool.query("SELECT config FROM study WHERE id = $1", [ids.primaryStudyId]);
    const {rows: members} = await db.pool.query("SELECT pr_card_id, source_card_id, ordinal, source_checksum FROM study_card WHERE study_id = $1 ORDER BY ordinal", [ids.primaryStudyId]);
    return {...db, ...ids, options: {pool: db.pool, confirmation: CUTOVER_CONFIRMATION,
        maintenance: {applicationStopped: true, preparationStopped: true, enrichmentStopped: true, schemaWritersStopped: true},
        expectedStudyId: ids.primaryStudyId, expectedStudyKey: "pr-card-sorting-local", expectedLegacyConfig: study.config,
        expectedLegacyChecksum: LEGACY_300_CHECKSUM, expectedTargetChecksum: COPILOT_369_SOURCE_CHECKSUM,
        expectedLegacyMemberships: members, legacyCsvPath: "plans/merged_after_rework_cards_seed_20260510.csv",
        targetCsvPath: "plans/copilot-369-cards.csv", targetManifestPath: "plans/copilot-369-cards.manifest.json"}};
};
const state = async pool => Object.fromEntries(await Promise.all(CUTOVER_TABLES.map(async table => {
    if (!(await pool.query("SELECT to_regclass($1) AS relation", [`public.${table}`])).rows[0].relation) return [table, {absent: true}];
    const {rows} = await pool.query(`SELECT count(*)::integer AS count, md5(COALESCE(string_agg(to_jsonb(record)::text || record.xmin::text, '' ORDER BY to_jsonb(record)::text), '')) AS hash FROM public.${table} record`);
    return [table, rows[0]];
})));
const wrapPool = (pool, intercept) => ({connect: async () => {
    const client = await pool.connect();
    return {release: () => client.release(), query: (sql, values) => intercept({sql, values, client,
        execute: () => client.query(sql, values)})};
}});
const pauseAt = (pool, predicate) => {
    const entered = Promise.withResolvers(), resume = Promise.withResolvers();
    const wrapped = wrapPool(pool, async call => {
        const result = await call.execute();
        if (predicate(call.sql)) { entered.resolve(); await resume.promise; }
        return result;
    });
    return {pool: wrapped, entered, resume};
};
const decisionFixture = async db => {
    const {rows: [participant]} = await db.pool.query("SELECT reviewer_id FROM study_participant WHERE study_id=$1 ORDER BY ordinal LIMIT 1", [db.primaryStudyId]);
    const context = {studyId: db.primaryStudyId, participantId: participant.reviewer_id};
    const service = createStudyService({pool: db.pool});
    const category = await service.createCategory(context, {name: "Concurrent synthetic category"});
    return {context, service, category, cardId: db.options.expectedLegacyMemberships[0].pr_card_id};
};

test("each active table writer fails NOWAIT before any row locks or mutation", {timeout: 120000}, async context => {
    const db = await fixture(context);
    const before = await state(db.pool);
    const writer = await db.pool.connect();
    try {
        for (const table of CUTOVER_TABLES) {
            const barrier = pauseAt(db.pool, sql => sql === "BEGIN ISOLATION LEVEL READ COMMITTED");
            const operation = cutoverCopilot369({...db.options, pool: barrier.pool});
            operation.catch(barrier.entered.reject);
            const rejected = assert.rejects(operation, {code: "55P03"});
            await barrier.entered.promise;
            await writer.query("BEGIN");
            await writer.query(`LOCK TABLE public.${table} IN ROW EXCLUSIVE MODE`);
            barrier.resume.resolve();
            await rejected;
            await writer.query("ROLLBACK");
            assert.deepEqual(await state(db.pool), before, table);
        }
    } finally { await writer.query("ROLLBACK"); writer.release(); }
});

for (const kind of ["classification", "discard"]) {
    test(`committed ${kind} between preflight and locks aborts on a fresh READ COMMITTED snapshot`, {timeout: 60000}, async context => {
        const db = await fixture(context);
        const decision = await decisionFixture(db);
        const protectedBefore = await fingerprintProtectedCopilot369State(db.pool, db.validationStudyId);
        const barrier = pauseAt(db.pool, sql => sql === "BEGIN ISOLATION LEVEL READ COMMITTED");
        const operation = cutoverCopilot369({...db.options, pool: barrier.pool});
        operation.catch(barrier.entered.reject);
        const rejected = assert.rejects(operation, new RegExp(`history in pr_${kind}`));
        await barrier.entered.promise;
        if (kind === "classification") await decision.service.classifyCard(decision.context, decision.cardId, {categoryId: decision.category.id, expectedRevision: 0});
        else await decision.service.discardCard(decision.context, decision.cardId, {expectedRevision: 0, reason: "Concurrent decision"});
        const withDecision = await state(db.pool);
        barrier.resume.resolve();
        await rejected;
        assert.deepEqual(await state(db.pool), withDecision);
        assert.deepEqual(await fingerprintProtectedCopilot369State(db.pool, db.validationStudyId), protectedBefore);
    });

    test(`uncommitted ${kind} retaining the real study_card lock fails NOWAIT without deadlock`, {timeout: 60000}, async context => {
        const db = await fixture(context);
        const decision = await decisionFixture(db);
        const writer = await db.pool.connect();
        const before = await state(db.pool);
        const barrier = pauseAt(db.pool, sql => sql === "BEGIN ISOLATION LEVEL READ COMMITTED");
        const operation = cutoverCopilot369({...db.options, pool: barrier.pool});
        operation.catch(barrier.entered.reject);
        const rejected = assert.rejects(operation, {code: "55P03"});
        try {
            await barrier.entered.promise;
            await writer.query("BEGIN");
            await lockStudyCard(writer, db.primaryStudyId, decision.cardId);
            if (kind === "classification") await createStudyClassification(writer, db.primaryStudyId, decision.context.participantId, decision.cardId, decision.category.id, null, null);
            else await createStudyDiscard(writer, db.primaryStudyId, decision.context.participantId, decision.cardId, null, null);
            barrier.resume.resolve();
            await rejected;
            await writer.query("ROLLBACK");
            assert.deepEqual(await state(db.pool), before);
        } finally { barrier.resume.resolve(); await writer.query("ROLLBACK"); writer.release(); }
    });

    test(`held cutover table locks block a late ${kind} writer until the transaction ends`, {timeout: 60000}, async context => {
        const db = await fixture(context);
        const decision = await decisionFixture(db);
        const writer = await db.pool.connect();
        const barrier = pauseAt(db.pool, sql => sql.startsWith("UPDATE public.study SET"));
        const operation = cutoverCopilot369({...db.options, pool: barrier.pool});
        operation.catch(barrier.entered.reject);
        try {
            await barrier.entered.promise;
            await writer.query("BEGIN");
            await writer.query("SET LOCAL lock_timeout = '100ms'");
            const save = async () => {
                await lockStudyCard(writer, db.primaryStudyId, decision.cardId);
                if (kind === "classification") await createStudyClassification(writer, db.primaryStudyId, decision.context.participantId, decision.cardId, decision.category.id, null, null);
                else await createStudyDiscard(writer, db.primaryStudyId, decision.context.participantId, decision.cardId, null, null);
            };
            await assert.rejects(save(), {code: "55P03"});
            await writer.query("ROLLBACK");
            barrier.resume.resolve();
            assert.equal((await operation).status, "CUTOVER_369");
        } finally { barrier.resume.resolve(); await writer.query("ROLLBACK"); writer.release(); }
    });
}

test("injected failure after all data mutations rolls back cards, memberships and study together", async context => {
    const db = await fixture(context);
    const before = await state(db.pool);
    let mutationsReached = false;
    const pool = wrapPool(db.pool, async call => {
        const result = await call.execute();
        if (call.sql.startsWith("UPDATE public.study SET")) {
            mutationsReached = true;
            throw new Error("Synthetic failure after mutations");
        }
        return result;
    });
    await assert.rejects(cutoverCopilot369({...db.options, pool}), /Synthetic failure/);
    assert.equal(mutationsReached, true);
    assert.deepEqual(await state(db.pool), before);
});

test("final full fingerprints reject accidental protected-state writes before commit", async context => {
    const db = await fixture(context);
    const before = await state(db.pool);
    for (const mutation of ["UPDATE participant_account SET credential_version=credential_version+1",
        "UPDATE participant_account SET credential_version=credential_version",
        "UPDATE pr_cards SET body='accidental mutation' WHERE id=(SELECT card.pr_card_id FROM study_card card JOIN study ON study.id=card.study_id WHERE study.expected_card_count=30 LIMIT 1)"]) {
        const pool = wrapPool(db.pool, async call => {
            const result = await call.execute();
            if (call.sql.startsWith("UPDATE public.study SET")) {
                const changed = await call.client.query(mutation);
                assert.ok(changed.rowCount > 0);
            }
            return result;
        });
        await assert.rejects(cutoverCopilot369({...db.options, pool}), /protected persistent data/);
        assert.deepEqual(await state(db.pool), before);
    }
});

test("the real lock set has schema and study advisories then ordered EXCLUSIVE tables before the study row", async context => {
    const db = await fixture(context);
    const statements = [];
    const pool = wrapPool(db.pool, async call => {
        statements.push(call.sql);
        if (call.sql === "SELECT id FROM public.study WHERE id = $1 FOR UPDATE") {
            const {rows} = await call.client.query(`SELECT relation::regclass::text AS relation FROM pg_locks
                WHERE pid=pg_backend_pid() AND mode='ExclusiveLock' AND locktype='relation' AND granted`);
            assert.deepEqual(rows.map(row => row.relation).sort(), [...CUTOVER_TABLES].sort());
        }
        return call.execute();
    });
    await cutoverCopilot369({...db.options, pool});
    const lockSql = statements.filter(sql => sql.startsWith("LOCK TABLE"));
    assert.deepEqual(lockSql, CUTOVER_TABLES.map(table => `LOCK TABLE public.${table} IN EXCLUSIVE MODE NOWAIT`));
    const schemaLock = statements.indexOf("SELECT pg_advisory_xact_lock(hashtext('labeler:study-schema'))");
    const studyLock = statements.indexOf("SELECT pg_advisory_xact_lock(hashtext($1))");
    assert.ok(schemaLock < studyLock && studyLock < statements.indexOf(lockSql[0]));
    assert.ok(statements.indexOf(lockSql.at(-1)) < statements.indexOf("SELECT id FROM public.study WHERE id = $1 FOR UPDATE"));
});

test("temporary shadow tables and replica-trigger execution contexts fail closed", async context => {
    const db = await fixture(context);
    const before = await state(db.pool);
    for (const setup of ["CREATE TEMP TABLE unexpected_study_history(study_id uuid)", "SET LOCAL session_replication_role = replica"]) {
        const pool = wrapPool(db.pool, async call => {
            if (setup.startsWith("CREATE") && call.sql.startsWith("BEGIN")) await call.client.query(setup);
            const result = await call.execute();
            if (setup.startsWith("SET") && call.sql.startsWith("BEGIN")) await call.client.query(setup);
            if (call.sql === "ROLLBACK") await call.client.query("DROP TABLE IF EXISTS pg_temp.unexpected_study_history");
            return result;
        });
        await assert.rejects(cutoverCopilot369({...db.options, pool}), /schema execution context/);
        assert.deepEqual(await state(db.pool), before);
    }
});

for (const kind of ["run", "page", "mapping", "promotion", "telemetry"]) {
    test(`primary ${kind} history ${kind === "promotion" ? "is retained during" : "while RUNNING blocks"} cutover`, async context => {
        const db = await fixture(context);
        const {rows: [run]} = await db.pool.query("INSERT INTO github_enrichment_run(study_id,source_checksum,config_fingerprint,normalizer_version,state) VALUES ($1,$2,'synthetic','synthetic','RUNNING') RETURNING id", [db.primaryStudyId, LEGACY_300_CHECKSUM]);
        if (kind === "page") await db.pool.query(`INSERT INTO github_run_page(run_id,study_id,pr_card_id,endpoint,page_ordinal,request_fingerprint,api_version,accept,state)
            SELECT $2,$1,pr_card_id,'metadata',0,'synthetic','2022-11-28','application/json','COMPLETE_EMPTY' FROM study_card WHERE study_id=$1 AND ordinal=0`, [db.primaryStudyId, run.id]);
        if (["mapping", "promotion"].includes(kind)) {
            await db.pool.query(`INSERT INTO github_card_snapshot(pr_card_id,snapshot_checksum,normalizer_version,manifest)
                SELECT pr_card_id,'history','synthetic','{}' FROM study_card WHERE study_id=$1`, [db.primaryStudyId]);
            await db.pool.query(`INSERT INTO github_enrichment_run_card(run_id,study_id,pr_card_id,snapshot_id,snapshot_checksum,ordinal)
                SELECT $2,member.study_id,member.pr_card_id,snapshot.id,snapshot.snapshot_checksum,member.ordinal
                FROM study_card member JOIN github_card_snapshot snapshot ON snapshot.pr_card_id=member.pr_card_id AND snapshot.snapshot_checksum='history'
                WHERE member.study_id=$1`, [db.primaryStudyId, run.id]);
        }
        if (kind === "promotion") {
            await db.pool.query("UPDATE github_enrichment_run SET state='COMPLETED' WHERE id=$1", [run.id]);
            await db.pool.query("INSERT INTO study_enrichment_promotion(study_id,run_id,source_checksum) VALUES ($1,$2,$3)", [db.primaryStudyId, run.id, LEGACY_300_CHECKSUM]);
        }
        if (kind === "telemetry") await db.pool.query("INSERT INTO github_api_telemetry_event(event_id,event_type,run_id,study_id,occurred_at) VALUES (gen_random_uuid(),'RESUME_STARTED',$1,$2,now())", [run.id, db.primaryStudyId]);
        const before = await state(db.pool);
        if (kind === "promotion") {
            assert.equal((await cutoverCopilot369(db.options)).status, "CUTOVER_369");
            const after = await state(db.pool);
            for (const table of CUTOVER_TABLES.filter(table => !["study", "study_card", "pr_cards",
                "study_card_reference", "study_source_membership"].includes(table))) assert.deepEqual(after[table], before[table], table);
        } else {
            await assert.rejects(cutoverCopilot369(db.options), /history/);
            assert.deepEqual(await state(db.pool), before);
        }
    });
}

test("missing structural migration014 fails before any independent migrations or data writes", async context => {
    const db = await fixture(context, {throughMigration: "013_category_definition_color"});
    const before = await state(db.pool);
    await assert.rejects(cutoverCopilot369(db.options), /schema|014/);
    assert.deepEqual(await state(db.pool), before);
});
