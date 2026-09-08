import pool from "../util/pg-pool.js";
import {readPullRequestCards} from "../util/csv-pr-provider.js";
import {readGithubConfig} from "../util/github-pr-config.js";
import {createGithubClient} from "../util/github-pr-client.js";
import {enrichStudyWithGithub} from "../util/study-github-enrichment.js";
import {readStudyConfig} from "../util/study-config.js";

const [ csvPath, configInput = process.env.STUDY_CONFIG ] = process.argv.slice(2);

if (!csvPath) {
    console.error("Usage: node scripts/enrich-study.js <input.csv> [config-json-or-path]");
    process.exitCode = 1;
} else {
    try {
        const githubConfig = readGithubConfig();
        if (!githubConfig.enabled) {
            console.log("GitHub enrichment is disabled; CSV bootstrap remains authoritative");
        } else if (githubConfig.enabled) {
            const config = await readStudyConfig(configInput);
            const {errors, sourceChecksum} = await readPullRequestCards(csvPath, {
                expectedCardCount: config.expectedCardCount,
            });
            if (errors.length > 0) {
                throw new Error(`CSV validation failed:\n${JSON.stringify(errors, null, 2)}`);
            }
            const {rows: [study]} = await pool.query(
                `SELECT id, study_key, source_checksum, expected_card_count, bootstrap_state
                 FROM study
                 WHERE study_key = $1`,
                [config.studyKey],
            );
            if (!study || study.bootstrap_state !== "READY") {
                throw new Error(`Study ${config.studyKey} is not ready for GitHub enrichment`);
            }
            if (study.source_checksum !== sourceChecksum) {
                throw new Error(`Source checksum drift for studyKey ${config.studyKey}`);
            }
            const result = await enrichStudyWithGithub({
                pool,
                study,
                config: githubConfig,
                githubClient: createGithubClient({config: githubConfig}),
            });
            if (result.status === "PAUSED") {
                console.error(`Study ${config.studyKey} GitHub enrichment is paused; rerun after ${result.retryAt || "the announced reset"}`);
                process.exitCode = 2;
            } else {
                console.log(`Study ${config.studyKey} GitHub enrichment is ${result.status}`);
            }
        }
    } finally {
        await pool.end();
    }
}
