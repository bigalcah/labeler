import pg from "pg";
import {readSecretFile} from "../util/secret-file.js";
import {classifyStudyReadiness, StudyReadinessError} from "../util/study-readiness.js";
import {verifyReleaseHandoff} from "../util/release-handoff.js";
import {runStudyMigrations} from "../util/study-schema.js";
import {preserveStudyCardHistory} from "../util/study-history.js";

let pool;
try {
    if (process.argv.length !== 2 || !["DATABASE_HOST", "DATABASE_NAME", "DATABASE_USER", "DATABASE_PASS_FILE"]
        .every(key => process.env[key])) throw new StudyReadinessError("Initialization requires explicit database files.");
    pool = new pg.Pool({host: process.env.DATABASE_HOST, port: Number(process.env.DATABASE_PORT || 5432),
        database: process.env.DATABASE_NAME, user: process.env.DATABASE_USER,
        password: readSecretFile(process.env.DATABASE_PASS_FILE, "DATABASE_PASS_FILE"), max: 1});
    const options = {pool, profiles: []};
    const origin = await classifyStudyReadiness(options);
    await verifyReleaseHandoff(origin);
    if (origin.dataBundle !== "empty") throw new StudyReadinessError("Initializer only accepts an empty observed origin.");
    await runStudyMigrations(pool);
    await preserveStudyCardHistory({...options, baseline: await classifyStudyReadiness(options)});
    process.stdout.write("Study schema migration complete (verified study-schema-4).\n");
} catch (error) {
    process.stderr.write(`${error instanceof StudyReadinessError ? error.message : "STUDY_INITIALIZATION_FAILED"}\n`);
    process.exitCode = 1;
} finally {
    if (pool) await pool.end();
}
