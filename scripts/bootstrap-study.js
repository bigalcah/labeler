import {readStudyBootstrapInput} from "../util/study-bootstrap-input.js";
import {StudyPreparationError, prepareStudyProfile} from "../util/study-preparation.js";
import {StudyExistingValidationError} from "../util/study-existing-validation.js";

const [ csvPath, configInput = process.env.STUDY_CONFIG ] = process.argv.slice(2);

if (!csvPath) {
    console.error("Usage: node scripts/bootstrap-study.js <input.csv> [config-json-or-path]");
    process.exitCode = 1;
} else {
    let pool;
    try {
        const input = await readStudyBootstrapInput({
            csvPath,
            configInput,
            manifestFile: process.env.STUDY_ACCOUNT_MANIFEST_FILE,
            manifestFd: process.env.STUDY_ACCOUNT_MANIFEST_FD === undefined
                ? undefined
                : Number(process.env.STUDY_ACCOUNT_MANIFEST_FD),
        });
        ({default: pool} = await import("../util/pg-pool.js"));
        const study = await prepareStudyProfile({pool, bootstrapInput: input});
        console.log(`Study ${input.config.studyKey} is ${study.bootstrap_state}`);
    } catch (error) {
        const message = error instanceof StudyPreparationError || error instanceof StudyExistingValidationError
            ? error.message
            : "STUDY_BOOTSTRAP_FAILED";
        console.error(message);
        process.exitCode = 1;
    } finally {
        if (pool) await pool.end();
    }
}
