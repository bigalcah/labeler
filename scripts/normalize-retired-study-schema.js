import pg from "pg";
import {readSecretFile} from "../util/secret-file.js";
import {readStudyProfilesInput} from "../util/study-profiles-input.js";
import {probeStudyNormalization, StudyReadinessError} from "../util/study-readiness.js";
import {verifyReleaseHandoff} from "../util/release-handoff.js";
import {normalizeStudySchema} from "../util/study-normalization.js";

let pool;
try {
    const args = process.argv.slice(2);
    if (args.length === 1 && args[0] === "--help") {
        process.stdout.write("Usage: node scripts/normalize-retired-study-schema.js\n"
            + "Requires the local root host's locked maintenance-normalize pending context and explicit database files.\n"
            + "Normalizes only schema 015; never prepares, cuts over, starts runtime or publishes. HOLD remains.\n");
    } else {
        if (args.length || !["DATABASE_HOST", "DATABASE_NAME", "DATABASE_USER", "DATABASE_PASS_FILE"]
            .every(key => process.env[key])) {
            throw new StudyReadinessError("Normalization requires explicit database identity and an external password file.");
        }
        const profiles = process.env.STUDY_PROFILES_INPUT ? await readStudyProfilesInput(process.env.STUDY_PROFILES_INPUT) : [];
        pool = new pg.Pool({host: process.env.DATABASE_HOST, port: Number(process.env.DATABASE_PORT || 5432),
            database: process.env.DATABASE_NAME, user: process.env.DATABASE_USER,
            password: readSecretFile(process.env.DATABASE_PASS_FILE, "DATABASE_PASS_FILE"),
            max: 1, connectionTimeoutMillis: 5000, idleTimeoutMillis: 3000, statement_timeout: 30000});
        const options = {pool, profiles};
        const {observation} = await probeStudyNormalization(options);
        const context = await verifyReleaseHandoff(observation, "maintenance-normalize");
        const operationOrigin = structuredClone(context.receipt.origin);
        operationOrigin.databaseIdentity = Object.fromEntries(["systemIdentifier", "databaseOid", "databaseName", "serverVersion"]
            .map(key => [key, context.receipt.origin.databaseIdentity[key]]));
        const result = await normalizeStudySchema({...options, baseline: observation, operationOrigin});
        process.stdout.write(`${JSON.stringify({applied015: result.applied015, changed: result.changed})}\n`);
    }
} catch (error) {
    process.stderr.write(`${error instanceof StudyReadinessError ? error.message : "STUDY_NORMALIZATION_FAILED"}\n`);
    process.exitCode = 1;
} finally {
    if (pool) await pool.end();
}
