import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {after, before, test} from "node:test";
import {runStudyMigrations} from "../util/study-schema.js";
import {closeCopilot369Database, startCopilot369Database} from "./support/copilot-369-fixture.js";

let database;

before(async () => {
    database = await startCopilot369Database({throughMigration: "012_global_normalized_username"});
});

after(async () => {
    if (database) await closeCopilot369Database(database);
});

test("Given a schema without migration 013 When migration 014 runs Then it rejects without recording the migration", async () => {
    const migration = await readFile(new URL("../schema/migrations/014_copilot_369_cardinality.sql", import.meta.url), "utf8");
    const client = await database.pool.connect();
    try {
        await assert.rejects(() => client.query(migration), /must be applied before 014_copilot_369_cardinality/);
        await client.query("ROLLBACK");
    } finally {
        client.release();
    }
    const {rows} = await database.pool.query(
        "SELECT migration_id FROM labeler_migration WHERE migration_id = '014_copilot_369_cardinality'",
    );
    assert.deepEqual(rows, []);
});

test("Given migrations through 013 When migration 014 is applied Then only counts 30, 300, and 369 are accepted", async () => {
    const ledger = await runStudyMigrations(database.pool);
    assert.equal(ledger.at(-1), "014_copilot_369_cardinality");
    for (const expectedCardCount of [30, 300, 369]) {
        await database.pool.query(
            `INSERT INTO study(study_key, config, source_checksum, expected_card_count)
             VALUES ($1, '{}'::jsonb, 'synthetic-checksum', $2)`,
            [`schema-count-${expectedCardCount}`, expectedCardCount],
        );
    }
    await assert.rejects(
        () => database.pool.query(
            `INSERT INTO study(study_key, config, source_checksum, expected_card_count)
             VALUES ('schema-count-31', '{}'::jsonb, 'synthetic-checksum', 31)`,
        ),
        error => error.code === "23514",
    );
    const {rows} = await database.pool.query(
        "SELECT expected_card_count FROM study WHERE study_key LIKE 'schema-count-%' ORDER BY expected_card_count",
    );
    assert.deepEqual(rows.map(row => row.expected_card_count), [30, 300, 369]);
});
