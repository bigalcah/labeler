import {spawn} from "node:child_process";
import {bootstrapStudy} from "../util/study-bootstrap.js";
import {readStudyProfilesInput} from "../util/study-profiles-input.js";

let pool;
try {
    const profiles = await readStudyProfilesInput(process.env.STUDY_PROFILES_INPUT);
    ({default: pool} = await import("../util/pg-pool.js"));
    for (const profile of profiles) {
        const study = await bootstrapStudy({pool, ...profile.bootstrapInput});
        process.stdout.write(`Study ${profile.bootstrapInput.config.studyKey} is ${study.bootstrap_state}\n`);
        await new Promise((resolve, reject) => {
            const child = spawn(process.execPath, [ "scripts/enrich-study.js", profile.csvPath, profile.configInput ], {
                env: {...process.env, GITHUB_ENRICHMENT_ENABLED: String(profile.enrichmentEnabled)},
                stdio: "inherit",
            });
            child.once("error", reject);
            child.once("close", status => {
                if (status === 0) resolve();
                else reject(new Error("Study profile enrichment failed"));
            });
        });
    }
} catch (_error) {
    process.stderr.write("STUDY_PROFILES_PREPARATION_FAILED\n");
    process.exitCode = 1;
} finally {
    if (pool) await pool.end();
}
