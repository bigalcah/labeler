import pg from "pg";
import {readSecretFile} from "../util/secret-file.js";
import {readStudyProfilesInput} from "../util/study-profiles-input.js";
import {probeStudyHistory, StudyReadinessError} from "../util/study-readiness.js";
import {verifyReleaseHandoff} from "../util/release-handoff.js";
import {preserveStudyCardHistory} from "../util/study-history.js";

let pool;
try {
    const args = process.argv.slice(2);
    if (args.length === 1 && args[0] === "--help") {
        process.stdout.write("Usage: node scripts/preserve-study-card-history.js\n"
            + "Requires the locked root maintenance-history handoff and verified backup. No cutover or publication.\n");
    } else {
        if (args.length || !["DATABASE_HOST", "DATABASE_NAME", "DATABASE_USER", "DATABASE_PASS_FILE"]
            .every(key => process.env[key])) throw new StudyReadinessError("History maintenance requires explicit database files.");
        const profiles = process.env.STUDY_PROFILES_INPUT ? await readStudyProfilesInput(process.env.STUDY_PROFILES_INPUT) : [];
        pool = new pg.Pool({host: process.env.DATABASE_HOST, port: Number(process.env.DATABASE_PORT || 5432),
            database: process.env.DATABASE_NAME, user: process.env.DATABASE_USER,
            password: readSecretFile(process.env.DATABASE_PASS_FILE, "DATABASE_PASS_FILE"),
            max: 1, connectionTimeoutMillis: 5000, idleTimeoutMillis: 3000, statement_timeout: 30000});
        const options = {pool, profiles};
        const {observation} = await probeStudyHistory(options);
        await verifyReleaseHandoff(observation, "maintenance-history");
        const result = await preserveStudyCardHistory({...options, baseline: observation});
        process.stdout.write(`${JSON.stringify({applied016: result.applied016, changed: result.changed})}\n`);
    }
} catch (error) {
    process.stderr.write(`${error instanceof StudyReadinessError ? error.message : "STUDY_HISTORY_FAILED"}\n`);
    process.exitCode = 1;
} finally {
    if (pool) await pool.end();
}
