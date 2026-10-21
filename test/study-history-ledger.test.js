import assert from "node:assert/strict";
import test from "node:test";
import {assertLedgerState, historyMigrationId, managedMigrationIds, normalizationMigrationId, readHistorySource} from "../util/study-ledger.js";

test("history ledger allows 016 only after exact 014 prefix and optional pinned 015", () => {
    for (const before of [managedMigrationIds, [...managedMigrationIds, normalizationMigrationId]]) {
        const state = assertLedgerState([...before, historyMigrationId], {requireComplete: true});
        assert.equal(state.applied016, true);
        assert.equal(state.complete, true);
    }
    for (const invalid of [[historyMigrationId], [...managedMigrationIds.slice(0, -1), historyMigrationId],
        [...managedMigrationIds, historyMigrationId, historyMigrationId],
        [...managedMigrationIds, historyMigrationId, normalizationMigrationId]]) {
        assert.throws(() => assertLedgerState(invalid), /order|Duplicate/);
    }
});

test("history source pin binds a separate physical schema-4 contract without changing 001 through 015", async () => {
    const {contract, sql, body} = await readHistorySource();
    assert.equal(contract.migration.id, historyMigrationId);
    assert.equal(contract.schema.observation, "study-schema-4");
    assert.equal(contract.schema.postgresMajor, 17);
    assert.equal(contract.schema.migrations.at(-1).id, "014_copilot_369_cardinality");
    assert.ok(sql.startsWith("BEGIN;"));
    assert.ok(!body.startsWith("BEGIN;"));
    assert.ok(!body.endsWith("COMMIT;\n"));
    assert.match(body, /Terminal enrichment history is immutable/);
});
