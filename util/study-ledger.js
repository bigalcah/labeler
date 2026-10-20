import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {readFile} from "node:fs/promises";

const managedMigrationIds = Object.freeze(JSON.parse(readFileSync(
    new URL("./copilot-369-schema-contract.json", import.meta.url), "utf8",
)).migrations.map(migration => migration.id));
const retirementMigrationId = "002_retire_legacy_labeler";
const normalizationMigrationId = "015_normalize_retired_study_schema";
const knownExternalMigrationIds = new Set([retirementMigrationId, normalizationMigrationId]);
const schemaAdvisoryLockKey = "labeler:study-schema";

const assertLedgerState = (ids, {requireComplete = false} = {}) => {
    const seen = new Set();
    let position = 0;
    for (const id of ids) {
        if (!managedMigrationIds.includes(id) && !knownExternalMigrationIds.has(id)) {
            throw new Error(`Unknown migration ID in ledger: ${id}`);
        }
        if (seen.has(id)) throw new Error(`Duplicate migration ID in ledger: ${id}`);
        seen.add(id);
        if (id === retirementMigrationId) {
            if (position !== 1) throw new Error(`Migration ledger is out of order at ${id}`);
        } else if (id === normalizationMigrationId) {
            if (position !== managedMigrationIds.length || ids.at(-1) !== id) {
                throw new Error(`Migration ledger is out of order at ${id}`);
            }
        } else {
            if (id !== managedMigrationIds[position]) throw new Error(`Migration ledger is out of order at ${id}`);
            position += 1;
        }
    }
    if (requireComplete && position !== managedMigrationIds.length) {
        throw new Error("Migration ledger requires the complete managed prefix through 014");
    }
    return {managedIds: managedMigrationIds.slice(0, position), retired: seen.has(retirementMigrationId),
        applied015: seen.has(normalizationMigrationId), complete: position === managedMigrationIds.length};
};

const readNormalizationSource = async () => {
    const contract = JSON.parse(await readFile(new URL("./study-normalization-contract.json", import.meta.url), "utf8"));
    const sql = await readFile(new URL("../schema/migrations/015_normalize_retired_study_schema.sql", import.meta.url), "utf8");
    const retirementSql = await readFile(new URL("../schema/migrations/002_retire_legacy_labeler.sql", import.meta.url));
    if (contract.migration.id !== normalizationMigrationId
        || createHash("sha256").update(sql).digest("hex") !== contract.migration.sha256
        || contract.retirementSource.id !== retirementMigrationId
        || createHash("sha256").update(retirementSql).digest("hex") !== contract.retirementSource.sha256) {
        throw new Error("Normalization 015 migration source pin mismatch");
    }
    return {contract, sql};
};

const readStudyLedger = async (client, options) => {
    const {rows} = await client.query("SELECT migration_id FROM public.labeler_migration ORDER BY applied_at, migration_id");
    const ids = rows.map(row => row.migration_id);
    const state = assertLedgerState(ids, options);
    if (state.applied015) await readNormalizationSource();
    return {ids, ...state};
};

export {assertLedgerState, knownExternalMigrationIds, managedMigrationIds, normalizationMigrationId,
    readNormalizationSource, readStudyLedger, retirementMigrationId, schemaAdvisoryLockKey};
