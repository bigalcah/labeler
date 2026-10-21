import {StudyPreparationError, prepareStudyProfiles} from "../util/study-preparation.js";
import {StudyExistingValidationError} from "../util/study-existing-validation.js";
import {readStudyProfilesInput} from "../util/study-profiles-input.js";

let pool;
try {
    const profiles = await readStudyProfilesInput(process.env.STUDY_PROFILES_INPUT);
    ({default: pool} = await import("../util/pg-pool.js"));
    const studies = await prepareStudyProfiles({pool, profiles});
    for (const [index, study] of studies.entries()) {
        const profile = profiles[index];
        process.stdout.write(`Study ${profile.bootstrapInput.config.studyKey} is ${study.bootstrap_state}\n`);
    }
} catch (error) {
    const message = error instanceof StudyPreparationError || error instanceof StudyExistingValidationError
        ? error.message
        : "STUDY_PROFILES_PREPARATION_FAILED";
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
} finally {
    if (pool) await pool.end();
}
