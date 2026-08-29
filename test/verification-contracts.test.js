import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
    assertLedgerState,
    managedMigrations,
    parseThrough,
    runStudyMigrations,
} from "../util/study-schema.js";
import {assertStudySchemaReady, bootstrapStudy} from "../util/study-bootstrap.js";
import {
    loadParticipantCategories,
    loadStudyCard,
    loadStudyProgress,
} from "../util/study-runtime.js";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const readRepositoryFile = relativePath => readFile(path.join(root, relativePath), "utf8");

test("migration ledger accepts only ordered managed migrations and external retirement", () => {
    assert.deepEqual(managedMigrations.map(migration => migration.id), [
        "001_study_foundation",
        "003_private_pr_discard",
        "004_github_pr_api_enrichment",
        "005_github_enrichment_checkpoints",
        "006_github_api_telemetry",
    ]);
    assert.doesNotThrow(() => assertLedgerState([]));
    assert.doesNotThrow(() => assertLedgerState([ "001_study_foundation" ]));
    assert.doesNotThrow(() => assertLedgerState([ "001_study_foundation", "002_retire_legacy_labeler" ]));
    assert.doesNotThrow(() => assertLedgerState([ "001_study_foundation", "002_retire_legacy_labeler", "003_private_pr_discard" ]));
    assert.doesNotThrow(() => assertLedgerState([ "001_study_foundation", "003_private_pr_discard", "004_github_pr_api_enrichment", "005_github_enrichment_checkpoints", "006_github_api_telemetry" ]));
    assert.doesNotThrow(() => assertLedgerState([ "001_study_foundation", "002_retire_legacy_labeler", "003_private_pr_discard", "004_github_pr_api_enrichment", "005_github_enrichment_checkpoints", "006_github_api_telemetry" ]));
    assert.throws(() => assertLedgerState([ "003_private_pr_discard" ]), /out of order/);
    assert.throws(() => assertLedgerState([ "001_study_foundation", "003_private_pr_discard", "002_retire_legacy_labeler" ]), /out of order/);
    assert.throws(() => assertLedgerState([ "unexpected" ]), /Unknown migration ID/);
});

test("migration runner is idempotent, ordered, and never executes external retirement", async () => {
    const commands = [];
    const client = {
        query: async (sql, parameters) => {
            commands.push([ sql, parameters ]);
            if (sql.startsWith("SELECT migration_id")) {
                return {rows: commands.filter(([query]) => query.includes("003_private_pr_discard.sql"))
                    .map(() => ({migration_id: "001_study_foundation"}))};
            }
            return {rows: []};
        },
        release: () => {},
    };
    const pool = {connect: async () => client};

    await runStudyMigrations(pool, "001_study_foundation");
    assert.equal(commands.some(([sql]) => sql.includes("002_retire_legacy_labeler")), false);
    assert.equal(commands.filter(([sql]) => sql.includes("CREATE TABLE")).length, 1);
    assert.match(commands[0][0], /pg_advisory_lock/);
    assert.match(commands.at(-1)[0], /pg_advisory_unlock/);
});

test("partial migration rejects external retirement as a runner target", async () => {
    assert.equal(parseThrough([ "--through", "002_retire_legacy_labeler" ]), "002_retire_legacy_labeler");
    await assert.rejects(
        () => runStudyMigrations({connect: async () => ({})}, "002_retire_legacy_labeler"),
        /managed migration/,
    );
});

test("migration failure releases the advisory lock and client for rollback", async () => {
    const commands = [];
    let released = false;
    const client = {
        query: async sql => {
            commands.push(sql);
            if (sql.includes("CREATE TABLE")) throw new Error("migration failed");
            if (sql.startsWith("SELECT migration_id")) return {rows: []};
            return {rows: []};
        },
        release: () => {
            released = true;
        },
    };

    await assert.rejects(() => runStudyMigrations({connect: async () => client}), /migration failed/);
    assert.match(commands[0], /pg_advisory_lock/);
    assert.match(commands.at(-1), /pg_advisory_unlock/);
    assert.equal(released, true);
});

test("private discard migration contains transactional, private, and replay-safe constraints", async () => {
    const migration = await readRepositoryFile("schema/migrations/003_private_pr_discard.sql");

    assert.match(migration, /^BEGIN;/);
    assert.match(migration, /pr_discard/);
    assert.match(migration, /PRIMARY KEY \("pr_card_id", "participant_id"\)/);
    assert.match(migration, /REFERENCES "pr_cards" \("id"\)/);
    assert.match(migration, /REFERENCES "reviewer" \("id"\)/);
    assert.match(migration, /INSERT INTO "labeler_migration" \("migration_id"\)/);
    assert.doesNotMatch(migration, /ON CONFLICT/);
    assert.match(migration, /COMMIT;\s*$/);
});

test("GitHub enrichment migration is additive, ordered, guarded, and replay-safe", async () => {
    const migration = await readRepositoryFile("schema/migrations/004_github_pr_api_enrichment.sql");

    assert.match(migration, /^BEGIN;/);
    assert.match(migration, /003_private_pr_discard/);
    for (const table of [
        "github_enrichment_run",
        "github_run_page",
        "github_card_snapshot",
        "github_enrichment_run_card",
        "study_enrichment_promotion",
    ]) {
        assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS "${table}"`));
    }
    assert.match(migration, /ADD COLUMN IF NOT EXISTS "study_id" UUID/);
    assert.match(migration, /ADD COLUMN IF NOT EXISTS "enrichment_run_id" UUID/);
    assert.match(migration, /INSERT INTO "labeler_migration"[\s\S]*ON CONFLICT \("migration_id"\) DO NOTHING/);
    assert.match(migration, /Cannot backfill study_id/);
    assert.match(migration, /study_count <> 1/);
    assert.match(migration, /ALTER COLUMN "study_id" SET NOT NULL/);
    assert.match(migration, /FOREIGN KEY \("study_id", "pr_card_id"\)\s*REFERENCES "study_card"/);
    assert.match(migration, /FOREIGN KEY \("study_id", "participant_id"\)\s*REFERENCES "study_participant"/);
    assert.match(migration, /FOREIGN KEY \("enrichment_run_id", "study_id", "pr_card_id"\)/);
    assert.match(migration, /github_reject_terminal_run_mutation/);
    assert.match(migration, /Terminal GitHub enrichment runs are immutable/);
    assert.match(migration, /study_enrichment_promotion_immutable/);
    assert.match(migration, /study_enrichment_promotion_validate/);
    assert.match(migration, /Only COMPLETED GitHub enrichment runs can be promoted/);
    assert.match(migration, /A study with decisions cannot receive an enrichment promotion/);
    assert.match(migration, /ON CONFLICT \("migration_id"\) DO NOTHING/);
    assert.match(migration, /COMMIT;\s*$/);
    assert.doesNotMatch(migration, /DROP\s+(?:TABLE|COLUMN|VIEW|TYPE)/i);
});

test("rollback compose omits preparation and forces read-only PostgreSQL access", async () => {
    const compose = await readRepositoryFile("deployment/docker-compose.rollback-readonly.yml");

    assert.doesNotMatch(compose, /labeling-study-prepare/);
    assert.match(compose, /default_transaction_read_only=on/);
    assert.match(compose, /ROLLBACK_DATABASE_USER:-labeling_readonly/);
    assert.match(compose, /ROLLBACK_DATABASE_PASS/);
    assert.match(compose, /condition: service_started/);
    assert.doesNotMatch(compose, /condition: service_completed_successfully/);
});

test("rollback runbook requires a separate pre-discard backup for writes", async () => {
    const runbook = await readRepositoryFile("deployment/ROLLBACK.md");

    assert.match(runbook, /solo puede consultar/i);
    assert.match(runbook, /default_transaction_read_only=on/);
    assert.match(runbook, /otra base de datos aprobada/i);
    assert.match(runbook, /antes del primer descarte/i);
    assert.match(runbook, /Nunca restaures sobre `labeling-data`/);
    assert.match(runbook, /down -v/);
});

test("bootstrap requires both managed migrations before any write", async () => {
    const queries = [];
    const incompletePool = {
        query: async (sql) => {
            queries.push(sql);
            return {rows: [ {migration_id: "001_study_foundation"} ]};
        },
    };

    await assert.rejects(
        () => assertStudySchemaReady(incompletePool),
        /requires migrations 001_study_foundation, 003_private_pr_discard, and 004_github_pr_api_enrichment/,
    );
    assert.equal(queries.length, 1);

    const completePool = {
        query: async () => ({
            rows: [
                {migration_id: "001_study_foundation"},
                {migration_id: "003_private_pr_discard"},
                {migration_id: "004_github_pr_api_enrichment"},
            ],
        }),
    };
    await assertStudySchemaReady(completePool);
});

test("bootstrap readiness failure happens before opening a write transaction", async () => {
    let connectCalls = 0;
    const pool = {
        query: async () => ({rows: [ {migration_id: "001_study_foundation"} ]}),
        connect: async () => {
            connectCalls += 1;
            throw new Error("write transaction must not start");
        },
    };

    await assert.rejects(
        () => bootstrapStudy({
            pool,
            config: {studyKey: "study", expectedCardCount: 300, participants: [ "one" ]},
            cards: [],
            sourceChecksum: "checksum",
        }),
        /requires migrations 001_study_foundation, 003_private_pr_discard, and 004_github_pr_api_enrichment/,
    );
    assert.equal(connectCalls, 0);
});

test("categories, classifications, and discards remain private for three participants", async () => {
    const participantState = new Map([
        [ 11, {
            categories: [ {id: "category-one", raw_name: "One"} ],
            card: {status: "CLASSIFIED", own_category: "One", discard_reason: null},
            progress: {total: 300, classified: 1, discarded: 0, pending: 299},
        } ],
        [ 22, {
            categories: [ {id: "category-two", raw_name: "Two"} ],
            card: {status: "DISCARDED", own_category: null, discard_reason: "not relevant"},
            progress: {total: 300, classified: 0, discarded: 1, pending: 299},
        } ],
        [ 33, {
            categories: [ {id: "category-three", raw_name: "Three"} ],
            card: {status: "PENDING", own_category: null, discard_reason: null},
            progress: {total: 300, classified: 0, discarded: 0, pending: 300},
        } ],
    ]);
    const queries = [];
    const executor = {
        query: async (sql, parameters = []) => {
            queries.push([sql, parameters]);
            if (sql.includes("FROM participant_category")) {
                return {rows: participantState.get(parameters[0]).categories};
            }
            if (sql.includes("COUNT(study_card.pr_card_id)")) {
                return {rows: [ participantState.get(parameters[1]).progress ]};
            }
            if (sql.includes("FROM study_card") && sql.includes("LEFT JOIN pr_classification")) {
                return {rows: [ participantState.get(parameters[1]).card ]};
            }
            throw new Error(`Unexpected runtime query: ${sql}`);
        },
    };

    for (const [participantId, state] of participantState) {
        assert.deepEqual(await loadParticipantCategories(executor, participantId), state.categories);
        assert.deepEqual(await loadStudyCard(executor, "study-id", participantId, "card-id"), state.card);
        assert.deepEqual(await loadStudyProgress(executor, "study-id", participantId), {
            ...state.progress,
            completed: state.progress.classified + state.progress.discarded,
        });
    }

    const categoryQueries = queries.filter(([sql]) => sql.includes("FROM participant_category"));
    const cardQueries = queries.filter(([sql]) => sql.includes("FROM study_card")
        && sql.includes("LEFT JOIN pr_classification")
        && !sql.includes("COUNT(study_card.pr_card_id)"));
    const progressQueries = queries.filter(([sql]) => sql.includes("COUNT(study_card.pr_card_id)"));
    assert.deepEqual(categoryQueries.map(([, parameters]) => parameters), [ [ 11 ], [ 22 ], [ 33 ] ]);
    assert.deepEqual(cardQueries.map(([, parameters]) => parameters), [
        [ "study-id", 11, "card-id" ],
        [ "study-id", 22, "card-id" ],
        [ "study-id", 33, "card-id" ],
    ]);
    assert.deepEqual(progressQueries.map(([, parameters]) => parameters), [
        [ "study-id", 11 ],
        [ "study-id", 22 ],
        [ "study-id", 33 ],
    ]);
    assert.match(cardQueries[0][0], /classification\.participant_id = \$2/);
    assert.match(cardQueries[0][0], /discard\.participant_id = \$2/);
    assert.match(cardQueries[0][0], /category\.participant_id = \$2/);
});
