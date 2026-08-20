import pool from "../util/pg-pool.js";
import {readPullRequestCards} from "../util/csv-pr-provider.js";
import {bootstrapStudy} from "../util/study-bootstrap.js";
import {readStudyConfig} from "../util/study-config.js";
import {applyStudySchema} from "../util/study-schema.js";

const [ csvPath, configInput = process.env.STUDY_CONFIG ] = process.argv.slice(2);

if (!csvPath) {
    console.error("Usage: node scripts/bootstrap-study.js <input.csv> [config-json-or-path]");
    process.exitCode = 1;
} else {
    try {
        const config = await readStudyConfig(configInput);
        const {cards, errors, sourceChecksum} = await readPullRequestCards(csvPath, {
            expectedCardCount: config.expectedCardCount,
        });
        if (errors.length > 0) {
            throw new Error(`CSV validation failed:\n${JSON.stringify(errors, null, 2)}`);
        }
        await applyStudySchema(pool);
        const study = await bootstrapStudy({pool, config, cards, sourceChecksum});
        console.log(`Study ${config.studyKey} is ${study.bootstrap_state}`);
    } finally {
        await pool.end();
    }
}
