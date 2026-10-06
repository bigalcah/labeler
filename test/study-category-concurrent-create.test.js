import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {randomBytes, randomUUID} from "node:crypto";
import {after, before, test} from "node:test";
import pg from "pg";
import {managedMigrations, runStudyMigrations} from "../util/study-schema.js";
import {withTransaction} from "../util/transaction.js";
import {
    createParticipantCategory,
    lockParticipantCategory,
    updateParticipantCategory,
} from "../util/study-write-repository.js";

const {Pool} = pg;
const containerName = `labeler-study-category-concurrent-${randomUUID()}`;
const password = randomBytes(24).toString("base64url");
const concurrentStudyId = "11111111-1111-4111-8111-111111111111";
const bobCategoryId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
const aliceCategoryIds = [
    "aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
    "aaaaaaa2-aaaa-4aaa-8aaa-aaaaaaaaaaa2",
    "aaaaaaa3-aaaa-4aaa-8aaa-aaaaaaaaaaa3",
    "aaaaaaa4-aaaa-4aaa-8aaa-aaaaaaaaaaa4",
    "aaaaaaa5-aaaa-4aaa-8aaa-aaaaaaaaaaa5",
];
const bobBackfillCategoryIds = [
    "cccccccc-cccc-4ccc-8ccc-ccccccccccc1",
    "cccccccc-cccc-4ccc-8ccc-ccccccccccc2",
    "cccccccc-cccc-4ccc-8ccc-ccccccccccc3",
];
let pool;
let backfillPool;
let guardPool;
let aliceId;
let bobId;

const docker = argumentsList => {
    const result = spawnSync("docker", argumentsList, {encoding: "utf8"});
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    return result.stdout.trim();
};

const createDatabasePool = async database => {
    const endpoint = docker(["port", containerName, "5432/tcp"]);
    const candidate = new Pool({
        host: "127.0.0.1",
        port: Number(endpoint.slice(endpoint.lastIndexOf(":") + 1)),
        user: "labeler_test",
        password,
        database,
    });
    for (let attempt = 0; attempt < 60; attempt += 1) {
        try {
            await candidate.query("SELECT 1");
            return candidate;
        } catch (_error) {
            await new Promise(resolve => setTimeout(resolve, 250));
        }
    }
    throw new Error(`PostgreSQL database ${database} did not become ready`);
};

const seedConcurrentStudy = async () => {
    await pool.query(
        `INSERT INTO study(id, study_key, config, source_checksum, expected_card_count, bootstrap_state)
         VALUES ($1, 'concurrent-study', $2, 'concurrent-checksum', 30, 'READY')`,
        [concurrentStudyId, {studyKey: "concurrent-study", expectedCardCount: 30, participants: ["alice", "bob"]}],
    );
    await pool.query("INSERT INTO reviewer(name) VALUES ('alice'), ('bob')");
    await pool.query(
        `INSERT INTO study_participant(study_id, reviewer_id, participant_key, ordinal)
         SELECT $1, reviewer.id, participant.name, participant.ordinal
         FROM (VALUES ('alice', 0), ('bob', 1)) participant(name, ordinal)
         JOIN reviewer ON reviewer.name = participant.name`,
        [concurrentStudyId],
    );
    await pool.query(
        `INSERT INTO pr_cards(source_card_id, title, raw_payload, source_checksum, content_checksum)
         SELECT 'concurrent-card-' || ordinal, 'Concurrent card ' || ordinal,
                jsonb_build_object('card_id', 'concurrent-card-' || ordinal),
                'concurrent-checksum', 'concurrent-content-' || ordinal
         FROM generate_series(0, 29) ordinal`,
    );
    await pool.query(
        `INSERT INTO study_card(study_id, pr_card_id, source_card_id, ordinal, source_checksum)
         SELECT $1, card.id, card.source_card_id, substring(card.source_card_id FROM 17)::integer, card.content_checksum
         FROM pr_cards card WHERE card.source_card_id LIKE 'concurrent-card-%'`,
        [concurrentStudyId],
    );
    const {rows: participants} = await pool.query("SELECT id, name FROM reviewer ORDER BY name");
    aliceId = participants.find(participant => participant.name === "alice").id;
    bobId = participants.find(participant => participant.name === "bob").id;
    await pool.query(
        `INSERT INTO participant_category(id, study_id, participant_id, raw_name, normalized_name, definition)
         VALUES ($1, $2, $3, 'Bob preserved', 'bob preserved', 'Bob preserved definition')`,
        [bobCategoryId, concurrentStudyId, bobId],
    );
    await pool.query(
        `INSERT INTO pr_classification(pr_card_id, participant_id, category_id, remarks, study_id)
         SELECT card.pr_card_id, $1, $2, 'preserved classification', $3
         FROM study_card card
         WHERE card.study_id = $3 AND card.ordinal = 0`,
        [bobId, bobCategoryId, concurrentStudyId],
    );
};

const seedBackfillStudy = async databasePool => {
    const studyId = "22222222-2222-4222-8222-222222222222";
    await databasePool.query(
        `INSERT INTO study(id, study_key, config, source_checksum, expected_card_count, bootstrap_state)
         VALUES ($1, 'backfill-study', $2, 'backfill-checksum', 30, 'READY')`,
        [studyId, {studyKey: "backfill-study", expectedCardCount: 30, participants: ["alice", "bob"]}],
    );
    await databasePool.query("INSERT INTO reviewer(name) VALUES ('alice'), ('bob')");
    await databasePool.query(
        `INSERT INTO study_participant(study_id, reviewer_id, participant_key, ordinal)
         SELECT $1, reviewer.id, participant.name, participant.ordinal
         FROM (VALUES ('alice', 0), ('bob', 1)) participant(name, ordinal)
         JOIN reviewer ON reviewer.name = participant.name`,
        [studyId],
    );
    const {rows: participants} = await databasePool.query("SELECT id, name FROM reviewer ORDER BY name");
    const seedAliceId = participants.find(participant => participant.name === "alice").id;
    const seedBobId = participants.find(participant => participant.name === "bob").id;
    for (const [index, categoryId] of aliceCategoryIds.entries()) {
        await databasePool.query(
            `INSERT INTO participant_category(id, study_id, participant_id, raw_name, normalized_name, created_at)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [categoryId, studyId, seedAliceId, `Alice ${index}`, `alice ${index}`, `2026-01-01T00:00:0${index}Z`],
        );
    }
    for (const [index, categoryId] of bobBackfillCategoryIds.entries()) {
        await databasePool.query(
            `INSERT INTO participant_category(id, study_id, participant_id, raw_name, normalized_name, created_at)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [categoryId, studyId, seedBobId, `Bob ${index}`, `bob ${index}`, `2026-01-01T00:00:0${index}Z`],
        );
    }
    return studyId;
};

before(async () => {
    docker(["run", "--rm", "--detach", "--name", containerName, "--tmpfs",
        "/var/lib/postgresql/data:rw,nosuid,nodev", "--publish", "127.0.0.1::5432",
        "--env", "POSTGRES_USER=labeler_test", "--env", `POSTGRES_PASSWORD=${password}`,
        "--env", "POSTGRES_DB=labeler_test", "postgres:17.6-alpine"]);
    pool = await createDatabasePool("labeler_test");
    for (const database of [ "labeler_backfill", "labeler_guard" ]) {
        await pool.query(`CREATE DATABASE ${database}`);
    }
    backfillPool = await createDatabasePool("labeler_backfill");
    guardPool = await createDatabasePool("labeler_guard");

    await runStudyMigrations(pool);
    await seedConcurrentStudy();

    await runStudyMigrations(backfillPool, "012_global_normalized_username");
    await seedBackfillStudy(backfillPool);
    await runStudyMigrations(backfillPool, "013_category_definition_color");

    await runStudyMigrations(guardPool, "012_global_normalized_username");
    await guardPool.query("ALTER TABLE \"participant_category\" ADD COLUMN IF NOT EXISTS \"color_slot\" INTEGER NOT NULL DEFAULT 0");
});

after(async () => {
    for (const candidate of [ pool, backfillPool, guardPool ]) {
        if (candidate) await candidate.end();
    }
    spawnSync("docker", ["rm", "--force", containerName], {encoding: "utf8"});
});

test("two simultaneous category creates serialize on the membership lock and assign distinct slots", async () => {
    const [ first, second ] = await Promise.all([
        withTransaction(pool, client => createParticipantCategory(
            client, concurrentStudyId, aliceId, "Concurrent alpha", "concurrent alpha", "Alpha definition")),
        withTransaction(pool, client => createParticipantCategory(
            client, concurrentStudyId, aliceId, "Concurrent beta", "concurrent beta", null)),
    ]);

    assert.notEqual(first.color_slot, second.color_slot, "concurrent creates must not collide on the same slot");
    assert.deepEqual([ first.color_slot, second.color_slot ].sort((left, right) => left - right), [ 0, 1 ]);
    assert.deepEqual(
        [ first.definition, second.definition ].sort((left, right) => String(left).localeCompare(String(right))),
        [ "Alpha definition", null ].sort((left, right) => String(left).localeCompare(String(right))),
    );

    const {rows: stored} = await pool.query(
        `SELECT color_slot, definition FROM participant_category
         WHERE study_id = $1 AND participant_id = $2 ORDER BY color_slot`,
        [ concurrentStudyId, aliceId ],
    );
    assert.deepEqual(stored.map(row => row.color_slot), [ 0, 1 ]);
    assert.deepEqual(stored.map(row => row.definition).sort((left, right) => String(left).localeCompare(String(right))),
        [ "Alpha definition", null ]);
});

test("a second runner invocation preserves slots, definitions, identifiers, timestamps, and classification references", async () => {
    const snapshot = async () => {
        const {rows: categories} = await pool.query(
            `SELECT id, study_id, participant_id, raw_name, normalized_name, definition, color_slot, created_at, updated_at
             FROM participant_category ORDER BY id`,
        );
        const {rows: classifications} = await pool.query(
            `SELECT pr_card_id, participant_id, category_id, study_id
             FROM pr_classification ORDER BY study_id, participant_id, pr_card_id`,
        );
        return {categories, classifications};
    };
    const before = await snapshot();
    assert.ok(before.classifications.length > 0, "the seed must keep a classification reference");

    await Promise.all([ runStudyMigrations(pool), runStudyMigrations(pool) ]);

    assert.deepEqual(await snapshot(), before, "runner replay must not reassign slots, definitions, or references");
    const {rows: [ledger]} = await pool.query(
        "SELECT COUNT(*)::integer AS count FROM labeler_migration WHERE migration_id = '013_category_definition_color'",
    );
    assert.equal(ledger.count, 1);
});

test("migration 013 backfills cycles per participant and enforces the 12-slot CHECK", async () => {
    const {rows: stored} = await backfillPool.query(
        "SELECT id, definition, color_slot FROM participant_category ORDER BY id",
    );
    const {rows: expected} = await backfillPool.query(
        `SELECT id, ((ROW_NUMBER() OVER (PARTITION BY study_id, participant_id ORDER BY created_at, id)) - 1) % 12 AS slot
         FROM participant_category ORDER BY id`,
    );
    assert.deepEqual(
        stored.map(row => ({id: row.id, color_slot: row.color_slot})),
        expected.map(row => ({id: row.id, color_slot: Number(row.slot)})),
        "the backfill must assign cyclic slots deterministically per study and participant",
    );
    assert.deepEqual(stored.map(row => row.color_slot), [ 0, 1, 2, 3, 4, 0, 1, 2 ], "five + three categories must cycle every 12");
    assert.ok(stored.every(row => row.definition === null), "existing categories must not receive invented definitions");

    await assert.rejects(
        () => backfillPool.query("UPDATE participant_category SET color_slot = 12 WHERE id = $1", [ aliceCategoryIds[0] ]),
        error => error.code === "23514" && error.constraint === "participant_category_color_slot_check",
        "the CHECK must reject a slot outside 0..11",
    );
});

test("migration 013 fails closed on an unexpected pre-existing color_slot column", async () => {
    await assert.rejects(
        () => runStudyMigrations(guardPool, "013_category_definition_color"),
        /Unexpected pre-existing color_slot column on participant_category/,
    );
    const {rows: [ledger]} = await guardPool.query(
        "SELECT COUNT(*)::integer AS count FROM labeler_migration WHERE migration_id = '013_category_definition_color'",
    );
    assert.equal(ledger.count, 0, "a rejected migration must not be recorded as applied");
});

test("migration 013 is registered after 012 and the runner exposes every managed id", () => {
    const ids = managedMigrations.map(migration => migration.id);
    assert.equal(ids.indexOf("013_category_definition_color"), ids.indexOf("012_global_normalized_username") + 1);
});

test("rename accepts the millisecond timestamp returned by create despite microsecond storage precision", async () => {
    const created = await withTransaction(pool, client => createParticipantCategory(
        client,
        concurrentStudyId,
        aliceId,
        "Rename precision target",
        "rename precision target",
        "definition for rename precision",
    ));
    const expectedUpdatedAt = created.updated_at.toISOString();
    const updated = await withTransaction(pool, async client => {
        const locked = await lockParticipantCategory(client, concurrentStudyId, aliceId, created.id);
        assert.ok(locked, "the created category must be lockable for rename");
        return updateParticipantCategory(
            client,
            concurrentStudyId,
            aliceId,
            created.id,
            "Renamed precision target",
            "renamed precision target",
            "definition for rename precision",
            expectedUpdatedAt,
        );
    });
    assert.equal(updated.raw_name, "Renamed precision target");
    assert.equal(updated.definition, "definition for rename precision");
});
