import pool from "../util/pg-pool.js";
import {verifyGithubCoverage} from "../util/github-pr-coverage-verifier.js";

const [studyKey, runId] = process.argv.slice(2);

const loadCoverageData = async (client, selectedStudyKey, selectedRunId) => {
    const {rows: [study]} = await client.query(
        `SELECT id, study_key, source_checksum, expected_card_count, bootstrap_state
         FROM study
         WHERE study_key = $1`,
        [selectedStudyKey],
    );
    if (!study || study.bootstrap_state !== "READY") throw new Error("Selected study is not READY");
    const [{rows: cards}, {rows: [run]}, {rows: runCards}, {rows: pages}, {rows: snapshots}, {rows: events}] = await Promise.all([
        client.query(
            `SELECT pr_cards.source_card_id, study_card.ordinal, pr_cards.repository, pr_cards.pr_number, pr_cards.language
             FROM study_card
             INNER JOIN pr_cards ON pr_cards.id = study_card.pr_card_id
             WHERE study_card.study_id = $1
             ORDER BY study_card.ordinal`,
            [study.id],
        ),
        client.query(
            `SELECT id, study_id, state, source_checksum, attempt_telemetry_version
             FROM github_enrichment_run
             WHERE id = $1 AND study_id = $2`,
            [selectedRunId, study.id],
        ),
        client.query(
            `SELECT github_enrichment_run_card.study_id, pr_cards.source_card_id AS pr_card_id,
                    github_enrichment_run_card.ordinal, github_enrichment_run_card.snapshot_id,
                    github_enrichment_run_card.snapshot_checksum
             FROM github_enrichment_run_card
             INNER JOIN pr_cards ON pr_cards.id = github_enrichment_run_card.pr_card_id
             WHERE github_enrichment_run_card.run_id = $1 AND github_enrichment_run_card.study_id = $2
             ORDER BY github_enrichment_run_card.ordinal`,
            [selectedRunId, study.id],
        ),
        client.query(
            `SELECT github_run_page.study_id, pr_cards.source_card_id AS pr_card_id, github_run_page.endpoint,
                    github_run_page.page_ordinal, github_run_page.state, github_run_page.item_count,
                    github_run_page.normalized_payload
             FROM github_run_page
             INNER JOIN pr_cards ON pr_cards.id = github_run_page.pr_card_id
             WHERE github_run_page.run_id = $1 AND github_run_page.study_id = $2
             ORDER BY pr_cards.source_card_id, github_run_page.endpoint, github_run_page.page_ordinal`,
            [selectedRunId, study.id],
        ),
        client.query(
            `SELECT pr_cards.source_card_id AS pr_card_id, snapshot.id, snapshot.snapshot_checksum, snapshot.manifest
             FROM github_card_snapshot snapshot
             INNER JOIN github_enrichment_run_card run_card ON run_card.snapshot_id = snapshot.id
             INNER JOIN pr_cards ON pr_cards.id = snapshot.pr_card_id
             WHERE run_card.run_id = $1 AND run_card.study_id = $2`,
            [selectedRunId, study.id],
        ),
        client.query(
            "SELECT event_type, classification, http_status FROM github_api_telemetry_event WHERE run_id = $1 AND study_id = $2",
            [selectedRunId, study.id],
        ),
    ]);
    if (!run) throw new Error("Selected run does not belong to the selected study");
    return {study, cards, run, runCards, pages, snapshots, telemetry: {attempt_telemetry_version: run.attempt_telemetry_version, events}};
};

try {
    if (!studyKey || !runId || process.argv.slice(2).length !== 2) {
        throw new Error("Usage: node scripts/verify-github-coverage.js <study-key> <run-id>");
    }
    const report = verifyGithubCoverage(await loadCoverageData(pool, studyKey, runId));
    process.stdout.write(`${JSON.stringify(report)}\n`);
    process.exitCode = report.card_v2_compatible ? 0 : 2;
} catch (error) {
    console.error(error.message);
    process.exitCode = 1;
} finally {
    await pool.end();
}
