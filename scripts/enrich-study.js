import pool from "../util/pg-pool.js";
import {readPullRequestCards} from "../util/csv-pr-provider.js";
import {readGithubConfig} from "../util/github-pr-config.js";
import {createGithubClient} from "../util/github-pr-client.js";
import {enrichStudyWithGithub} from "../util/study-github-enrichment.js";
import {prepareStudyGithubEnrichment} from "../util/study-github-enrichment-input.js";
import {readStudyConfig} from "../util/study-config.js";

const [ csvPath, configInput = process.env.STUDY_CONFIG ] = process.argv.slice(2);

if (!csvPath) {
    console.error("Usage: node scripts/enrich-study.js <input.csv> [config-json-or-path]");
    process.exitCode = 1;
} else {
    try {
        const githubConfig = readGithubConfig();
        const requestedStudy = await readStudyConfig(configInput);
        const result = await prepareStudyGithubEnrichment({
            pool,
            csvPath,
            requestedStudy,
            githubConfig,
            readCards: readPullRequestCards,
            createClient: createGithubClient,
            enrich: enrichStudyWithGithub,
        });
        if (result.status === "DISABLED") {
            console.log("GitHub enrichment is disabled; CSV bootstrap remains authoritative");
        } else {
            if (result.status === "PAUSED") {
                console.error(`Study ${requestedStudy.studyKey} GitHub enrichment is paused; rerun after ${result.retryAt || "the announced reset"}`);
                process.exitCode = 2;
            } else {
                console.log(`Study ${requestedStudy.studyKey} GitHub enrichment is ${result.status}`);
            }
        }
    } catch (_error) {
        console.error("STUDY_GITHUB_ENRICHMENT_FAILED");
        process.exitCode = 1;
    } finally {
        await pool.end();
    }
}
