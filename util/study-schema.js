import {readFile} from "node:fs/promises";
import {assertLedgerState, knownExternalMigrationIds, readStudyLedger, schemaAdvisoryLockKey} from "./study-ledger.js";

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
    {
        id: "008_login_rate_limits",
        url: new URL("../schema/migrations/008_login_rate_limits.sql", import.meta.url),
    },
    {
        id: "009_csrf_contexts",
        url: new URL("../schema/migrations/009_csrf_contexts.sql", import.meta.url),
    },
    {
        id: "010_study_scoped_participant_categories",
        url: new URL("../schema/migrations/010_study_scoped_participant_categories.sql", import.meta.url),
    },
    {
        id: "011_multi_study_cardinality",
        url: new URL("../schema/migrations/011_multi_study_cardinality.sql", import.meta.url),
    },
    {
        id: "012_global_normalized_username",
        url: new URL("../schema/migrations/012_global_normalized_username.sql", import.meta.url),
    },
    {
        id: "013_category_definition_color",
        url: new URL("../schema/migrations/013_category_definition_color.sql", import.meta.url),
    },
    {
        id: "014_copilot_369_cardinality",
        url: new URL("../schema/migrations/014_copilot_369_cardinality.sql", import.meta.url),
    },
]);
const advisoryLockKey = schemaAdvisoryLockKey;

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
        return (await readStudyLedger(client)).ids;
    } catch (error) {
        if (error.code === "42P01") return [];
        throw error;
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
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        await client.query("SELECT pg_advisory_unlock(hashtext($1))", [ advisoryLockKey ]);
        client.release();
    }
};

export {assertLedgerState, knownExternalMigrationIds, managedMigrations, parseThrough, runStudyMigrations};
