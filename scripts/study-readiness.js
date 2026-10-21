import {classifyStudyReadiness, probeStudyHistory, probeStudyNormalization, StudyReadinessError} from "../util/study-readiness.js";
import {readStudyProfilesInput} from "../util/study-profiles-input.js";
import {verifyReleaseHandoff} from "../util/release-handoff.js";
import pg from "pg";
import {readSecretFile} from "../util/secret-file.js";

let pool;
try {
    const args = process.argv.slice(2);
    if (args.includes("--help")) {
        process.stdout.write("Usage: node scripts/study-readiness.js [--prepare | --normalization-probe | --history-probe]\n"
            + "--normalization-probe: readonly JSON {observation,applied015,eligibility}; never writes or authorizes maintenance.\n"
            + "Requires explicit DATABASE_HOST/NAME/USER/PASS_FILE; STUDY_PROFILES_INPUT for existing pairs.\n"
            + "LABELER_READINESS_STRICT=true requires grant-verified non-writing inspection credentials.\n");
    } else {
        if (args.length > 1 || args.some(argument => !["--prepare", "--normalization-probe", "--history-probe"].includes(argument))) {
            throw new StudyReadinessError("Use only --prepare, --normalization-probe or --history-probe.");
        }
        const profiles = process.env.STUDY_PROFILES_INPUT
            ? await readStudyProfilesInput(process.env.STUDY_PROFILES_INPUT) : [];
        if (!["DATABASE_HOST", "DATABASE_NAME", "DATABASE_USER", "DATABASE_PASS_FILE"].every(key => process.env[key])) {
            throw new StudyReadinessError("Readiness requires explicit database identity and an external password file.");
        }
        pool = new pg.Pool({host: process.env.DATABASE_HOST, database: process.env.DATABASE_NAME,
            user: process.env.DATABASE_USER, port: Number(process.env.DATABASE_PORT || 5432),
            password: readSecretFile(process.env.DATABASE_PASS_FILE, "DATABASE_PASS_FILE"),
            max: 1, connectionTimeoutMillis: 5000, idleTimeoutMillis: 3000, statement_timeout: 30000});
        const options = {pool, profiles, requireRestrictedRole: process.env.LABELER_READINESS_STRICT === "true"};
        const result = args.includes("--history-probe") ? await probeStudyHistory(options)
            : args.includes("--normalization-probe") ? await probeStudyNormalization(options)
                : await classifyStudyReadiness(options);
        const observation = args.some(argument => argument.endsWith("-probe")) ? result.observation : result;
        if (args.includes("--prepare")) {
            if (process.env.LABELER_RELEASE_CONTEXT) await verifyReleaseHandoff(observation);
            else if (observation.dataBundle === "empty") {
                throw new StudyReadinessError("Initialization requires the locked host's root-owned pending handoff; standalone preparation is read-only.");
            }
            if (observation.dataBundle === "legacy300-v1") {
                throw new StudyReadinessError("Historical 300 requires the dedicated manual maintenance cutover; see docs/COPILOT-369-RUNBOOK.md.");
            }
            if (observation.dataBundle === "copilot369-v1" && observation.schema !== "study-schema-4") {
                throw new StudyReadinessError("Existing pair requires the explicit history schema-4 checkpoint before preparation.");
            }
            process.stdout.write(`${observation.dataBundle === "empty" ? "EMPTY" : "EXACT"}\n`);
        } else {
            process.stdout.write(`${JSON.stringify(result)}\n`);
        }
    }
} catch (error) {
    process.stderr.write(`${error instanceof StudyReadinessError ? error.message : "STUDY_READINESS_FAILED"}\n`);
    process.exitCode = 1;
} finally {
    if (pool) await pool.end();
}
