import assert from "node:assert/strict";
import test from "node:test";
import {assertStudySchemaReady, StudyBootstrapConflictError} from "../util/study-bootstrap.js";
import {managedMigrations} from "../util/study-schema.js";

const managed = managedMigrations.map(migration => migration.id);
const retirement = "002_retire_legacy_labeler";
const normalization = "015_normalize_retired_study_schema";
const ledgerPool = ids => ({query: async () => ({rows: ids.map(migration_id => ({migration_id}))})});

test("bootstrap admits complete ordered 014 with optional retirement and external 015", async () => {
    for (const retired of [false, true]) {
        for (const normalized of [false, true]) {
            const ids = retired ? [managed[0], retirement, ...managed.slice(1)] : [...managed];
            if (normalized) ids.push(normalization);
            await assert.doesNotReject(assertStudySchemaReady(ledgerPool(ids)));
        }
    }
});

test("bootstrap rejects malformed ledgers with a sanitized typed conflict", async () => {
    const unknown = "016_unapproved_private_value";
    const invalid = [
        [...managed, unknown],
        [...managed, managed.at(-1)],
        [managed[1], managed[0], ...managed.slice(2)],
        [managed[0], ...managed.slice(2)],
        [...managed, retirement],
        [...managed.slice(0, -1), normalization],
        [normalization, ...managed],
    ];
    for (const ids of invalid) {
        await assert.rejects(assertStudySchemaReady(ledgerPool(ids)), error =>
            error instanceof StudyBootstrapConflictError
            && error.message === "Study schema migration ledger is invalid"
            && !error.message.includes(unknown));
    }
});

test("bootstrap keeps typed missing-prefix and missing-table errors", async () => {
    for (const ids of [[], managed.slice(0, 1), managed.slice(0, -1)]) {
        await assert.rejects(assertStudySchemaReady(ledgerPool(ids)), error =>
            error instanceof StudyBootstrapConflictError
            && error.message === `Bootstrap requires migrations ${managed.join(", ")}`);
    }
    const missing = {query: async () => { throw Object.assign(new Error("private SQL detail"), {code: "42P01"}); }};
    await assert.rejects(assertStudySchemaReady(missing), error =>
        error instanceof StudyBootstrapConflictError && error.message === "Study schema migrations are missing");
});
