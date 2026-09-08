import {readFile} from "node:fs/promises";

const managedMigrations = Object.freeze([
    {
        id: "001_study_foundation",
        url: new URL("../schema/migrations/001_study_foundation.sql", import.meta.url),
    },
    {
        id: "003_private_pr_discard",
        url: new URL("../schema/migrations/003_private_pr_discard.sql", import.meta.url),
    },
    {
        id: "004_github_pr_api_enrichment",
        url: new URL("../schema/migrations/004_github_pr_api_enrichment.sql", import.meta.url),
    },
    {
        id: "005_github_enrichment_checkpoints",
        url: new URL("../schema/migrations/005_github_enrichment_checkpoints.sql", import.meta.url),
    },
    {
        id: "006_github_api_telemetry",
        url: new URL("../schema/migrations/006_github_api_telemetry.sql", import.meta.url),
    },
    {
        id: "007_local_accounts_sessions",
        url: new URL("../schema/migrations/007_local_accounts_sessions.sql", import.meta.url),
    },
]);
const knownExternalMigrationIds = new Set([ "002_retire_legacy_labeler" ]);
const advisoryLockKey = "labeler:study-schema";

const parseThrough = argumentsList => {
    const throughIndex = argumentsList.indexOf("--through");
    const inlineThrough = argumentsList.find(argument => argument.startsWith("--through="));
    if (throughIndex !== -1 && inlineThrough) throw new Error("Use --through only once");
    if (throughIndex !== -1) {
        const through = argumentsList[throughIndex + 1];
        if (!through || through.startsWith("--")) throw new Error("--through requires a migration ID");
        if (throughIndex + 2 !== argumentsList.length) throw new Error("Unexpected migration arguments");
        return through;
    }
    if (inlineThrough) {
        if (argumentsList.length !== 1) throw new Error("Unexpected migration arguments");
        return inlineThrough.slice("--through=".length);
    }
    if (argumentsList.length > 0) throw new Error("Unexpected migration arguments");
    return undefined;
};

const readLedger = async client => {
    try {
        const {rows} = await client.query(
            "SELECT migration_id FROM labeler_migration ORDER BY applied_at, migration_id",
        );
        return rows.map(row => row.migration_id);
    } catch (error) {
        if (error.code === "42P01") return [];
        throw error;
    }
};

const assertLedgerState = ledgerIds => {
    const knownIds = new Set(managedMigrations.map(migration => migration.id));
    for (const migrationId of ledgerIds) {
        if (!knownIds.has(migrationId) && !knownExternalMigrationIds.has(migrationId)) {
            throw new Error(`Unknown migration ID in ledger: ${migrationId}`);
        }
    }
    let missingManagedMigration = false;
    for (const migration of managedMigrations) {
        const applied = ledgerIds.includes(migration.id);
        if (!applied) missingManagedMigration = true;
        if (applied && missingManagedMigration) {
            throw new Error(`Migration ledger is out of order at ${migration.id}`);
        }
    }
    const externalIndex = ledgerIds.indexOf("002_retire_legacy_labeler");
    if (externalIndex !== -1) {
        const foundationIndex = ledgerIds.indexOf("001_study_foundation");
        const discardIndex = ledgerIds.indexOf("003_private_pr_discard");
        if (foundationIndex === -1 || externalIndex < foundationIndex || (discardIndex !== -1 && externalIndex > discardIndex)) {
            throw new Error("Migration ledger is out of order at 002_retire_legacy_labeler");
        }
    }
};

const runStudyMigrations = async (pool, through) => {
    const targetIndex = through === undefined
        ? managedMigrations.length - 1
        : managedMigrations.findIndex(migration => migration.id === through);
    if (targetIndex === -1) {
        throw new Error(`--through must name a managed migration: ${managedMigrations.map(migration => migration.id).join(", ")}`);
    }

    const client = await pool.connect();
    try {
        await client.query("SELECT pg_advisory_lock(hashtext($1))", [ advisoryLockKey ]);
        const ledgerIds = await readLedger(client);
        assertLedgerState(ledgerIds);
        for (const migration of managedMigrations.slice(0, targetIndex + 1)) {
            if (ledgerIds.includes(migration.id)) continue;
            const sql = await readFile(migration.url, "utf8");
            await client.query(sql);
            ledgerIds.push(migration.id);
        }
        return ledgerIds;
    } finally {
        await client.query("SELECT pg_advisory_unlock(hashtext($1))", [ advisoryLockKey ]);
        client.release();
    }
};

export {assertLedgerState, knownExternalMigrationIds, managedMigrations, parseThrough, runStudyMigrations};
