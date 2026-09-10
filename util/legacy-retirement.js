class LegacyRetirementError extends Error {
    constructor(message) {
        super(message);
        this.name = "LegacyRetirementError";
    }
}

const expectedObjectRows = inventory => [
    ...inventory.inventory.database.tables.map(name => ({kind: "table", name})),
    ...inventory.inventory.database.views.map(name => ({kind: "view", name})),
    ...inventory.inventory.database.functions.map(name => ({kind: "function", name})),
    ...inventory.inventory.database.procedures.map(name => ({kind: "procedure", name})),
    ...inventory.inventory.database.types.map(name => ({kind: "type", name})),
    ...inventory.inventory.protected.tables.map(name => ({kind: "protected-table", name})),
];

const assessRetirementState = (rows, migrationApplied, inventory) => {
    const expectedCount = expectedObjectRows(inventory).length;
    if (rows.length !== expectedCount) {
        throw new LegacyRetirementError("Database object inventory result is incomplete");
    }

    const missingProtected = rows
        .filter(row => row.kind === "protected-table" && !row.present)
        .map(row => row.name);
    if (missingProtected.length > 0) {
        throw new LegacyRetirementError(`Retirement protected objects missing: ${missingProtected.join(", ")}`);
    }

    const legacyRows = rows.filter(row => row.kind !== "protected-table");
    const presentLegacy = legacyRows.filter(row => row.present);
    if (presentLegacy.length === 0) {
        if (!migrationApplied) {
            throw new LegacyRetirementError("Legacy-clean schema has no migration ledger entry");
        }
        return "already-retired";
    }
    if (presentLegacy.length !== legacyRows.length) {
        const missing = legacyRows.filter(row => !row.present).map(row => `${row.kind}:${row.name}`);
        throw new LegacyRetirementError(`Refusing partial legacy schema: missing ${missing.join(", ")}`);
    }
    if (migrationApplied) {
        throw new LegacyRetirementError("Migration ledger marks retirement applied but legacy objects remain");
    }

    return "ready";
};

const inspectObjects = async (client, inventory) => {
    const expected = expectedObjectRows(inventory);
    const {rows} = await client.query(
        `/* retirement object inventory */
         WITH expected AS (
             SELECT kind, name
             FROM jsonb_to_recordset($1::jsonb) AS item(kind TEXT, name TEXT)
         )
         SELECT kind, name,
             CASE kind
                 WHEN 'table' THEN EXISTS (
                     SELECT 1 FROM pg_class relation
                     JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
                     WHERE namespace.nspname = 'public' AND relation.relname = expected.name
                       AND relation.relkind IN ('r', 'p')
                 )
                 WHEN 'protected-table' THEN EXISTS (
                     SELECT 1 FROM pg_class relation
                     JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
                     WHERE namespace.nspname = 'public' AND relation.relname = expected.name
                       AND relation.relkind IN ('r', 'p')
                 )
                 WHEN 'view' THEN EXISTS (
                     SELECT 1 FROM pg_class relation
                     JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
                     WHERE namespace.nspname = 'public' AND relation.relname = expected.name
                       AND relation.relkind IN ('v', 'm')
                 )
                 WHEN 'function' THEN EXISTS (
                     SELECT 1 FROM pg_proc routine
                     JOIN pg_namespace namespace ON namespace.oid = routine.pronamespace
                     WHERE namespace.nspname = 'public' AND routine.proname = expected.name
                       AND routine.prokind = 'f'
                 )
                 WHEN 'procedure' THEN EXISTS (
                     SELECT 1 FROM pg_proc routine
                     JOIN pg_namespace namespace ON namespace.oid = routine.pronamespace
                     WHERE namespace.nspname = 'public' AND routine.proname = expected.name
                       AND routine.prokind = 'p'
                 )
                 WHEN 'type' THEN EXISTS (
                     SELECT 1 FROM pg_type type
                     JOIN pg_namespace namespace ON namespace.oid = type.typnamespace
                     WHERE namespace.nspname = 'public' AND type.typname = expected.name
                 )
                 ELSE FALSE
             END AS present
         FROM expected
         ORDER BY kind, name`,
        [ JSON.stringify(expected) ],
    );
    return rows;
};

const readMigrationState = async (client, inventory) => {
    const {ledgerTable, id} = inventory.inventory.migration;
    if (!/^[a-z_][a-z0-9_]*$/.test(ledgerTable)) {
        throw new LegacyRetirementError("Invalid migration ledger identifier in inventory");
    }
    const {rows: [ ledger ]} = await client.query(
        "SELECT to_regclass('public.' || quote_ident($1)) IS NOT NULL AS ledger_exists",
        [ ledgerTable ],
    );
    if (!ledger.ledger_exists) {
        throw new LegacyRetirementError(`Required migration ledger table is missing: ${ledgerTable}`);
    }
    const {rows: [ migration ]} = await client.query(
        `SELECT EXISTS (
             SELECT 1 FROM "${ledgerTable}" WHERE migration_id = $1
         ) AS applied`,
        [ id ],
    );
    return migration.applied;
};

const guardRetirementDatabase = async (client, inventory) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        inventory.inventory.migration.advisoryLockKey,
    ]);
    const rows = await inspectObjects(client, inventory);
    const migrationApplied = await readMigrationState(client, inventory);
    return assessRetirementState(rows, migrationApplied, inventory);
};

const checkRetirementReadiness = async options => {
    const {pool, archivePath, manifestPath, inventory, expectedDatabase, runCommand} = options;
    await verifyLegacyBackup({
        archivePath,
        manifestPath,
        inventory,
        expectedDatabase,
        runCommand,
    });
    return withTransaction(pool, client => guardRetirementDatabase(client, inventory));
};

export {
    LegacyRetirementError,
    assessRetirementState,
    checkRetirementReadiness,
    guardRetirementDatabase,
};
import {verifyLegacyBackup} from "./legacy-backup.js";
import {withTransaction} from "./transaction.js";
