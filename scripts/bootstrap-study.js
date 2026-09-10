import pool from "../util/pg-pool.js";
import {bootstrapStudy} from "../util/study-bootstrap.js";
import {readStudyBootstrapInput} from "../util/study-bootstrap-input.js";

const [ csvPath, configInput = process.env.STUDY_CONFIG ] = process.argv.slice(2);

if (!csvPath) {
    console.error("Usage: node scripts/bootstrap-study.js <input.csv> [config-json-or-path]");
    process.exitCode = 1;
} else {
    try {
        const input = await readStudyBootstrapInput({
            csvPath,
            configInput,
            manifestFile: process.env.STUDY_ACCOUNT_MANIFEST_FILE,
            manifestFd: process.env.STUDY_ACCOUNT_MANIFEST_FD === undefined
                ? undefined
                : Number(process.env.STUDY_ACCOUNT_MANIFEST_FD),
        });
        const study = await bootstrapStudy({pool, ...input});
        console.log(`Study ${input.config.studyKey} is ${study.bootstrap_state}`);
    } finally {
        await pool.end();
    }
}
