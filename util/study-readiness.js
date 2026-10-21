import {createHash} from "node:crypto";
import {readFile} from "node:fs/promises";
import {isDeepStrictEqual} from "node:util";
import {readReadinessSchemaContract} from "./study-readiness-schema.js";
import {verifyExistingStudyClient, withReadOnlyTransaction} from "./study-existing-validation.js";
import {managedMigrations} from "./study-schema.js";
import {verifyLegacyReadinessClient} from "./study-readiness-legacy.js";
import {assertReadinessDataIntegrity} from "./study-readiness-data.js";
import {assertLedgerState, readHistorySource, readNormalizationSource, readStudyLedger} from "./study-ledger.js";
import {assertStudySourceHistory} from "./study-source-history.js";

class StudyReadinessError extends Error {
    constructor(message) {
        super(message);
        this.name = "StudyReadinessError";
    }
}

const digest = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const transient = new Set(["app_session", "login_ip_attempt", "login_csrf_context", "github_api_telemetry_event"]);
const identifier = name => `"${name.replaceAll("\"", "\"\"")}"`;

const assertInspectionGrants = async client => {
    const {rows: [role]} = await client.query(`SELECT current_user AS name,
        current_setting('transaction_read_only') = 'on' AS readonly,
        EXISTS (SELECT 1 FROM pg_roles WHERE pg_has_role(current_user, oid, 'MEMBER')
            AND (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)) AS elevated,
        has_database_privilege(current_database(), 'CREATE,TEMP') AS database_create,
        pg_has_role(current_user, 'pg_read_all_stats', 'USAGE') AS stats,
        EXISTS (SELECT 1 FROM pg_namespace WHERE nspname !~ '^pg_' AND nspname <> 'information_schema'
            AND has_schema_privilege(oid, 'CREATE')) AS schema_create,
        EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema' AND
            ((c.relkind IN ('r','p','v','m','f') AND
                (has_table_privilege(c.oid, 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
                 OR has_any_column_privilege(c.oid, 'INSERT,UPDATE,REFERENCES')))
             OR (c.relkind = 'S' AND has_sequence_privilege(c.oid, 'USAGE,UPDATE')))) AS writes,
        NOT EXISTS (SELECT 1 FROM pg_stat_activity WHERE datname = current_database()
            AND backend_type = 'client backend' AND pid <> pg_backend_pid()
            AND usename <> current_user) AS writers_stopped`);
    if (!role.readonly || !role.stats || role.elevated || role.database_create || role.schema_create || role.writes) {
        throw new StudyReadinessError("Inspection requires a grant-verified non-writing role and READ ONLY transaction.");
    }
    return {role: role.name, transaction: "read-only", grantsVerified: true, writersStopped: role.writers_stopped};
};

const inspectCatalog = async (client, requireRestrictedRole, allowRetired) => {
    await client.query("SET LOCAL search_path TO pg_catalog, public, pg_temp");
    await client.query("SET LOCAL TIME ZONE 'UTC'");
    const readOnly = requireRestrictedRole ? await assertInspectionGrants(client)
        : {role: (await client.query("SELECT current_user AS name")).rows[0].name,
            transaction: (await client.query("SHOW transaction_read_only")).rows[0].transaction_read_only === "on" ? "read-only" : "read-write",
            grantsVerified: false, writersStopped: false};
    const {rows: [identity]} = await client.query(`SELECT
        (SELECT system_identifier::text FROM pg_control_system()) AS "systemIdentifier",
        (SELECT oid::text FROM pg_database WHERE datname = current_database()) AS "databaseOid",
        current_database() AS "databaseName",
        current_setting('server_version_num') AS "serverVersion"`);
    const {rows: relations} = await client.query(`SELECT c.relname FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public'
        AND c.relkind IN ('r','p','v','m','f') ORDER BY c.relname`);
    const tables = relations.map(row => row.relname);
    const ledger = tables.includes("labeler_migration")
        ? await readStudyLedger(client) : assertLedgerState([]);
    const managed = ledger.managedIds;
    const prefixes = JSON.parse(await readFile(new URL("./study-readiness-prefixes.json", import.meta.url), "utf8"));
    const pinned = JSON.parse(await readFile(new URL("./copilot-369-schema-contract.json", import.meta.url), "utf8"));
    const schemaContract = await readReadinessSchemaContract(client);
    const {rows: temporary} = await client.query("SELECT 1 FROM pg_class WHERE relpersistence = 't' LIMIT 1");
    const {rows: [replication]} = await client.query("SHOW session_replication_role");
    if (temporary.length || replication.session_replication_role !== "origin") {
        throw new StudyReadinessError("Unknown schema execution context: temporary objects or bypassed triggers.");
    }
    if (Math.floor(Number(identity.serverVersion) / 10000) !== pinned.postgresMajor
        || !isDeepStrictEqual(schemaContract.migrations, pinned.migrations)) {
        throw new StudyReadinessError("Unknown server or migration source contract.");
    }
    let schema = "empty";
    if (ledger.applied016) {
        const {contract} = await readHistorySource();
        if (!isDeepStrictEqual(schemaContract.migrations, contract.schema.migrations)
            || digest(schemaContract.signatures) !== contract.schema.fingerprint) {
            throw new StudyReadinessError("Unknown physical study-schema-4 contract.");
        }
        schema = "study-schema-4";
    } else if (managed.length === managedMigrations.length) {
        if (digest(schemaContract.signatures) !== prefixes[managed.at(-1)]) {
            if (allowRetired && ledger.retired && !ledger.applied015) {
                const {contract} = await readNormalizationSource();
                const retirementSql = await readFile(new URL("../schema/migrations/002_retire_legacy_labeler.sql", import.meta.url));
                if (isDeepStrictEqual(schemaContract.signatures, contract.retiredSchema.signatures)
                    && digest(schemaContract.signatures) === contract.retiredSchema.fingerprint
                    && createHash("sha256").update(retirementSql).digest("hex") === contract.retirementSource.sha256) {
                    schema = contract.retiredSchema.observation;
                }
            }
            if (schema === "empty") {
                const changed = Object.keys(schemaContract.signatures).filter(key => !isDeepStrictEqual(schemaContract.signatures[key], pinned.signatures[key]));
                throw new StudyReadinessError(`Unknown physical study-schema-3 contract: ${changed.join(", ")}.`);
            }
        } else {
            schema = "study-schema-3";
        }
    } else if (managed.length > 0) {
        schema = managed.at(-1);
        if (digest(schemaContract.signatures) !== prefixes[schema]) {
            throw new StudyReadinessError("Unknown physical migration prefix.");
        }
    } else if (tables.length || (await client.query(`SELECT 1 FROM pg_namespace
        WHERE nspname !~ '^pg_' AND nspname NOT IN ('public','information_schema')`)).rows.length) {
        throw new StudyReadinessError("Unexpected legacy or unknown database objects.");
    }
    if (schema === "empty" && Object.entries(schemaContract.signatures).some(([key, signature]) =>
        signature.count !== (key === "namespaces" || key === "extensions" ? 1 : 0))) {
        throw new StudyReadinessError("Unknown objects in an apparently empty database.");
    }
    const fingerprints = {};
    let hasData = false;
    for (const table of tables) {
        if (transient.has(table)) {
            const {rows: [state]} = await client.query(`SELECT EXISTS (SELECT 1 FROM public.${identifier(table)}) AS has_rows`);
            if (state.has_rows) hasData = true;
            continue;
        }
        const {rows} = await client.query(`SELECT to_jsonb(record) AS row FROM public.${identifier(table)} record
            ORDER BY to_jsonb(record)::text`);
        if (rows.length && table !== "labeler_migration") hasData = true;
        fingerprints[table] = digest(rows);
    }
    const studies = tables.includes("study")
        ? (await client.query("SELECT study_key, expected_card_count FROM public.study ORDER BY study_key")).rows : [];
    return {schema, studies, hasData, fingerprint: digest(fingerprints), schemaFingerprint: digest(schemaContract.signatures),
        identity, readOnly, ledger, tables, fingerprints};
};

const inspectStudyReadinessClient = async (client, {profiles, requireRestrictedRole = false, legacyCsvPath, allowRetired = false}) => {
    const catalog = await inspectCatalog(client, requireRestrictedRole, allowRetired);
    const {schema, studies, hasData} = catalog;
    let dataBundle;
    if (!hasData && studies.length === 0) {
        dataBundle = "empty";
    } else if ((["study-schema-3", "study-schema-4"].includes(schema) || (allowRetired && schema === "014_copilot_369_cardinality")) && studies.length === 2
        && studies[0].study_key === "pr-card-sorting-local" && studies[0].expected_card_count === 369
        && studies[1].study_key === "pr-card-sorting-validation-30" && studies[1].expected_card_count === 30) {
        if (profiles.length !== 2) throw new StudyReadinessError("Existing pair requires both approved input profiles.");
        for (const profile of profiles) {
            if (!await verifyExistingStudyClient(client, profile.bootstrapInput)) throw new StudyReadinessError("Missing approved profile.");
        }
        dataBundle = "copilot369-v1";
    } else if (studies.length === 2 && studies[0].study_key === "pr-card-sorting-local"
        && studies[0].expected_card_count === 300 && studies[1].study_key === "pr-card-sorting-validation-30"
        && studies[1].expected_card_count === 30) {
        if (profiles.length !== 2) throw new StudyReadinessError("Historical 300 requires dedicated manual maintenance; see docs/COPILOT-369-RUNBOOK.md.");
        await verifyLegacyReadinessClient(client, profiles, legacyCsvPath);
        dataBundle = "legacy300-v1";
    } else {
        throw new StudyReadinessError("Partial, drifted or unknown study database; manual recovery is required.");
    }
    if (catalog.ledger.complete) await assertReadinessDataIntegrity(client, legacyCsvPath);
    if (catalog.ledger.applied016) await assertStudySourceHistory(client);
    const observation = {schema, dataBundle, fingerprint: catalog.fingerprint, schemaFingerprint: catalog.schemaFingerprint,
        observedAt: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
        databaseIdentity: catalog.identity, readOnly: catalog.readOnly};
    return {observation, catalog};
};

const classifyStudyReadiness = options => withReadOnlyTransaction(options.pool,
    async client => (await inspectStudyReadinessClient(client, {...options, allowRetired: false})).observation);

const probeStudyHistory = options => withReadOnlyTransaction(options.pool, async client => {
    await readHistorySource();
    const {observation, catalog} = await inspectStudyReadinessClient(client, options);
    const applied016 = catalog.ledger.applied016 === true && observation.schema === "study-schema-4";
    let sourceEligible = ["013_category_definition_color", "study-schema-3"].includes(observation.schema);
    if (sourceEligible) {
        const {rows: [state]} = await client.query(`SELECT NOT EXISTS (
            SELECT 1 FROM public.github_enrichment_run run JOIN public.study ON study.id=run.study_id
            WHERE run.state='RUNNING' OR run.source_checksum<>study.source_checksum
        ) AS eligible`);
        sourceEligible = state.eligible;
    }
    return {observation, applied016,
        eligibility: applied016 ? "already-applied" : sourceEligible ? "eligible" : "ineligible"};
});

const probeStudyNormalization = options => withReadOnlyTransaction(options.pool, async client => {
    await readNormalizationSource();
    const {observation, catalog} = await inspectStudyReadinessClient(client, {...options, allowRetired: true});
    const applied015 = catalog.ledger.applied015 === true && ["study-schema-3", "study-schema-4"].includes(observation.schema);
    return {observation, applied015,
        eligibility: applied015 ? "already-applied" : catalog.ledger.complete && !catalog.ledger.applied016 ? "eligible" : "ineligible"};
});

export {StudyReadinessError, assertInspectionGrants, classifyStudyReadiness, inspectStudyReadinessClient, probeStudyNormalization, probeStudyHistory};
