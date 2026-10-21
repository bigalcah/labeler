import {createHash} from "node:crypto";
import {isDeepStrictEqual} from "node:util";
import {inspectStudyReadinessClient, probeStudyNormalization, StudyReadinessError} from "./study-readiness.js";
import {normalizationMigrationId, readNormalizationSource, schemaAdvisoryLockKey} from "./study-ledger.js";

const observationKeys = ["schema", "dataBundle", "fingerprint", "schemaFingerprint", "observedAt", "databaseIdentity", "readOnly"].sort();
const assertObservation = observation => {
    if (!observation || !isDeepStrictEqual(Object.keys(observation).sort(), observationKeys)
        || !["empty", "legacy300-v1", "copilot369-v1"].includes(observation.dataBundle)
        || !/^[a-f0-9]{64}$/.test(observation.fingerprint) || !/^[a-f0-9]{64}$/.test(observation.schemaFingerprint)) {
        throw new StudyReadinessError("Normalization requires an exact observed baseline and immutable operation origin.");
    }
};
const assertBaseline = (baseline, actual) => {
    assertObservation(baseline);
    for (const key of ["schema", "dataBundle", "fingerprint", "schemaFingerprint", "databaseIdentity"]) {
        if (!isDeepStrictEqual(baseline[key], actual[key])) {
            throw new StudyReadinessError(`Normalization baseline changed: ${key}`);
        }
    }
};
const freeze = value => {
    if (value && typeof value === "object") {
        Object.values(value).forEach(freeze);
        Object.freeze(value);
    }
    return value;
};

const readPreservationProof = async client => {
    const {rows: relations} = await client.query(`SELECT c.relname, c.relkind FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public'
        AND c.relkind IN ('r','p','S') ORDER BY c.relname`);
    const proof = {};
    for (const relation of relations) {
        const name = `public."${relation.relname.replaceAll("\"", "\"\"")}"`;
        const query = relation.relkind === "S" ? `SELECT last_value, is_called FROM ${name}`
            : `SELECT to_jsonb(record) AS row FROM ${name} record${relation.relname === "labeler_migration"
                ? " WHERE migration_id <> '015_normalize_retired_study_schema'" : ""} ORDER BY to_jsonb(record)::text`;
        proof[relation.relname] = createHash("sha256").update(JSON.stringify((await client.query(query)).rows)).digest("hex");
    }
    return proof;
};

const normalizeStudySchema = async ({pool, profiles, baseline, operationOrigin, legacyCsvPath}) => {
    assertObservation(operationOrigin);
    const origin = freeze(structuredClone(operationOrigin));
    const options = {pool, profiles, legacyCsvPath};
    const initial = await probeStudyNormalization(options);
    assertBaseline(baseline, initial.observation);
    if (initial.eligibility === "ineligible") throw new StudyReadinessError("Normalization requires the complete schema through 014.");
    if (initial.applied015) return {origin, observation: initial.observation, applied015: true, changed: false};

    const client = await pool.connect();
    try {
        await client.query("BEGIN ISOLATION LEVEL READ COMMITTED");
        await client.query("SET LOCAL search_path TO public, pg_catalog, pg_temp");
        await client.query("SET LOCAL TIME ZONE 'UTC'");
        await client.query("SET LOCAL lock_timeout = '2s'");
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [schemaAdvisoryLockKey]);
        const {rows: tables} = await client.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename");
        for (const {tablename} of tables) {
            await client.query(`LOCK TABLE public."${tablename.replaceAll("\"", "\"\"")}" IN ACCESS EXCLUSIVE MODE NOWAIT`);
        }
        const {sql} = await readNormalizationSource();
        const locked = await inspectStudyReadinessClient(client, {...options, allowRetired: true});
        assertBaseline(baseline, locked.observation);
        if (!locked.catalog.ledger.complete || locked.catalog.ledger.applied015) {
            throw new StudyReadinessError("Normalization lineage changed during preflight.");
        }
        const proof = await readPreservationProof(client);
        const {rows: priorLedger} = await client.query("SELECT * FROM public.labeler_migration ORDER BY applied_at, migration_id");
        await client.query(sql);
        const normalized = await inspectStudyReadinessClient(client, options);
        if (normalized.observation.schema !== "study-schema-3"
            || normalized.observation.dataBundle !== baseline.dataBundle
            || !isDeepStrictEqual(proof, await readPreservationProof(client))) {
            throw new StudyReadinessError("Normalization changed protected data or failed the canonical 014 contract.");
        }
        await client.query("INSERT INTO public.labeler_migration (migration_id, applied_at) VALUES ($1, clock_timestamp())",
            [normalizationMigrationId]);
        const final = await inspectStudyReadinessClient(client, options);
        const {rows: finalLedger} = await client.query("SELECT * FROM public.labeler_migration ORDER BY applied_at, migration_id");
        if (!final.catalog.ledger.applied015 || finalLedger.length !== priorLedger.length + 1
            || !isDeepStrictEqual(finalLedger.slice(0, -1), priorLedger)
            || finalLedger.at(-1).migration_id !== normalizationMigrationId
            || !isDeepStrictEqual(proof, await readPreservationProof(client))) {
            throw new StudyReadinessError("Normalization must append only the 015 ledger row and preserve all prior rows.");
        }
        await client.query("COMMIT");
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
    const fresh = await probeStudyNormalization(options);
    if (!fresh.applied015) throw new StudyReadinessError("Normalization commit could not be observed.");
    return {origin, observation: fresh.observation, applied015: true, changed: true};
};

export {normalizeStudySchema};
