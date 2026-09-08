import {readPullRequestCards} from "../util/csv-pr-provider.js";
import pool from "../util/pg-pool.js";
import {verifyGithubCoverage} from "../util/github-pr-coverage-verifier.js";

const [csvPath = "plans/merged_after_rework_cards_seed_20260510.csv", runId = "57e7fe7e-b503-4285-a734-dba40c9d2b42"] = process.argv.slice(2);

const loadCoverageData = async (client, id) => {
    const [{rows: [run]}, {rows: runCards}, {rows: pages}, {rows: snapshots}, {rows: events}] = await Promise.all([
        client.query("SELECT id, state, source_checksum, attempt_telemetry_version FROM github_enrichment_run WHERE id = $1", [id]),
        client.query("SELECT pr_cards.source_card_id AS pr_card_id, github_enrichment_run_card.ordinal, github_enrichment_run_card.snapshot_id, github_enrichment_run_card.snapshot_checksum FROM github_enrichment_run_card INNER JOIN pr_cards ON pr_cards.id = github_enrichment_run_card.pr_card_id WHERE github_enrichment_run_card.run_id = $1 ORDER BY github_enrichment_run_card.ordinal", [id]),
        client.query("SELECT pr_cards.source_card_id AS pr_card_id, github_run_page.endpoint, github_run_page.page_ordinal, github_run_page.state, github_run_page.item_count, github_run_page.normalized_payload FROM github_run_page INNER JOIN pr_cards ON pr_cards.id = github_run_page.pr_card_id WHERE github_run_page.run_id = $1 ORDER BY pr_cards.source_card_id, github_run_page.endpoint, github_run_page.page_ordinal", [id]),
        client.query("SELECT id, pr_card_id, snapshot_checksum, manifest FROM github_card_snapshot WHERE id IN (SELECT snapshot_id FROM github_enrichment_run_card WHERE run_id = $1)", [id]),
        client.query("SELECT event_type, classification, http_status FROM github_api_telemetry_event WHERE run_id = $1", [id]),
    ]);
    return {run, runCards, pages, snapshots, telemetry: {attempt_telemetry_version: run?.attempt_telemetry_version, events}};
};

try {
    const {cards, errors, sourceChecksum} = await readPullRequestCards(csvPath, {expectedCardCount: 300});
    if (errors.length > 0) throw new Error(`CSV validation failed: ${JSON.stringify(errors)}`);
    const data = await loadCoverageData(pool, runId);
    const report = verifyGithubCoverage({cards, ...data, sourceChecksum, run: {...data.run, source_checksum: data.run?.source_checksum || sourceChecksum}});
    process.stdout.write(`${JSON.stringify(report)}\n`);
    process.exitCode = report.card_v2_compatible ? 0 : 2;
} catch (error) {
    console.error(error.message);
    process.exitCode = 1;
} finally {
    await pool.end();
}
