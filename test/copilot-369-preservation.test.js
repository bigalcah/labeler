import assert from "node:assert/strict";
import {after, before, test} from "node:test";
import {runStudyMigrations} from "../util/study-schema.js";
import {
    closeCopilot369Database,
    fingerprintProtectedCopilot369State,
    seedHistoricalCopilot369Studies,
    startCopilot369Database,
} from "./support/copilot-369-fixture.js";

let database;
let studies;

before(async () => {
    database = await startCopilot369Database({throughMigration: "013_category_definition_color"});
    studies = await seedHistoricalCopilot369Studies({pool: database.pool});
});

after(async () => {
    if (database) await closeCopilot369Database(database);
});

test("Given historical 300 and protected 30 state When migration 014 applies Then all protected data fingerprints remain identical", async () => {
    const beforeMigration = await fingerprintProtectedCopilot369State(database.pool, studies.validationStudyId);
    assert.equal(beforeMigration.state.accounts.length, 3);
    assert.equal(beforeMigration.state.participants.length, 3);
    assert.equal(beforeMigration.state.memberships.length, 30);
    assert.ok(beforeMigration.state.accounts.every(account => account.password_hash
        && Number.isInteger(account.credential_version)));

    await runStudyMigrations(database.pool);

    const afterMigration = await fingerprintProtectedCopilot369State(database.pool, studies.validationStudyId);
    assert.deepEqual(afterMigration, beforeMigration);
    const {rows} = await database.pool.query(
        "SELECT migration_id FROM labeler_migration WHERE migration_id = '014_copilot_369_cardinality'",
    );
    assert.equal(rows.length, 1);
});
