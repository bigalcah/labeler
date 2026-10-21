import {createHash} from "node:crypto";
import {isDeepStrictEqual} from "node:util";
import {inspectStudyReadinessClient, StudyReadinessError} from "./study-readiness.js";
import {withReadOnlyTransaction} from "./study-existing-validation.js";
import {readHistorySource, schemaAdvisoryLockKey} from "./study-ledger.js";
import {readFile} from "node:fs/promises";

const sameBaseline = (expected, actual) => {
    for (const key of ["schema", "dataBundle", "fingerprint", "schemaFingerprint", "databaseIdentity"]) {
        if (!isDeepStrictEqual(expected[key], actual[key])) throw new StudyReadinessError(`History baseline changed: ${key}`);
    }
};

const preservationProof = async (client, tables, upgrading014) => {
    const proof = {};
    for (const {relname, relkind} of tables) {
        const name = `public."${relname.replaceAll("\"", "\"\"")}"`;
        const sql = relkind === "S" ? `SELECT last_value,is_called FROM ${name}`
            : `SELECT to_jsonb(record) AS row,record.xmin::text AS xmin FROM ${name} record
               ${relname === "labeler_migration" ? `WHERE migration_id NOT IN ('016_preserve_study_card_history'${upgrading014 ? ",'014_copilot_369_cardinality'" : ""})` : ""}
               ORDER BY to_jsonb(record)::text`;
        proof[relname] = createHash("sha256").update(JSON.stringify((await client.query(sql)).rows)).digest("hex");
    }
    return proof;
};

const preserveStudyCardHistory = async ({pool, profiles, baseline, legacyCsvPath}) => {
    const options = {profiles, legacyCsvPath};
    const initial = await withReadOnlyTransaction(pool, async client => (await inspectStudyReadinessClient(client, options)).observation);
    sameBaseline(baseline, initial);
    if (initial.schema === "study-schema-4") return {observation: initial, applied016: true, changed: false};
    const upgrading014 = initial.schema === "013_category_definition_color";
    if (initial.schema !== "study-schema-3" && !upgrading014) throw new StudyReadinessError("History maintenance requires the exact canonical 013 or 014 schema.");
    const {body} = await readHistorySource();
    const client = await pool.connect();
    try {
        await client.query("BEGIN ISOLATION LEVEL READ COMMITTED");
        await client.query("SET LOCAL search_path TO public, pg_catalog, pg_temp");
        await client.query("SET LOCAL lock_timeout = '2s'");
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [schemaAdvisoryLockKey]);
        const {rows: tables} = await client.query(`SELECT c.relname,c.relkind FROM pg_class c
            JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p','S') ORDER BY c.relname`);
        for (const {relname, relkind} of tables) {
            if (relkind !== "S") await client.query(`LOCK TABLE public."${relname.replaceAll("\"", "\"\"")}" IN ACCESS EXCLUSIVE MODE NOWAIT`);
        }
        sameBaseline(baseline, (await inspectStudyReadinessClient(client, options)).observation);
        const before = await preservationProof(client, tables, upgrading014);
        if (upgrading014) {
            const cardinality = await readFile(new URL("../schema/migrations/014_copilot_369_cardinality.sql", import.meta.url), "utf8");
            await client.query(cardinality.replace(/^BEGIN;\n/, "").replace(/COMMIT;\n$/, ""));
            if ((await inspectStudyReadinessClient(client, options)).observation.schema !== "study-schema-3") {
                throw new StudyReadinessError("014 did not produce the canonical history prerequisite.");
            }
        }
        await client.query(body);
        const final = await inspectStudyReadinessClient(client, options);
        if (final.observation.schema !== "study-schema-4" || final.observation.dataBundle !== baseline.dataBundle
            || !isDeepStrictEqual(before, await preservationProof(client, tables, upgrading014))) {
            throw new StudyReadinessError("History maintenance changed protected rows or failed the physical schema-4 contract.");
        }
        await client.query("COMMIT");
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
    const observation = await withReadOnlyTransaction(pool, async connection => (await inspectStudyReadinessClient(connection, options)).observation);
    if (observation.schema !== "study-schema-4") throw new StudyReadinessError("History commit could not be observed.");
    return {observation, applied016: true, changed: true};
};

export {preserveStudyCardHistory};
