import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";
import {REQUIRED_ENDPOINTS} from "../util/github-pr-persistence.js";
import {verifyGithubCoverage} from "../util/github-pr-coverage-verifier.js";

const cards = Array.from({length: 300}, (_value, ordinal) => ({
    source_card_id: `card-${ordinal}`, ordinal, repository: "owner/repo", pr_number: ordinal + 1, language: ordinal % 2 ? "Go" : null,
}));
const run = {id: "57e7fe7e-b503-4285-a734-dba40c9d2b42", state: "COMPLETED", source_checksum: "csv-checksum"};
const completePages = (card, endpoint) => ({
    pr_card_id: card.source_card_id, endpoint, page_ordinal: 0, state: endpoint === "metadata" ? "COMPLETE" : "COMPLETE_EMPTY",
    item_count: endpoint === "metadata" ? 1 : 0,
    normalized_payload: endpoint === "metadata" ? {title: "title", body: "body", user: {login: "author"}, state: "closed", merged: true, html_url: "https://github.com/owner/repo/pull/1", created_at: "2020-01-01", closed_at: "2020-01-02", merged_at: "2020-01-02"} : [],
});
const completeInput = () => ({
    cards, run, runCards: cards.map(card => ({pr_card_id: card.source_card_id})),
    pages: cards.flatMap(card => REQUIRED_ENDPOINTS.map(endpoint => completePages(card, endpoint))),
    snapshots: cards.map(card => ({pr_card_id: card.source_card_id})),
    sourceChecksum: "csv-checksum",
    telemetry: {attempt_telemetry_version: null, events: []},
});

test("coverage CLI aliases persisted source IDs for run-card and page rows", async () => {
    const script = await readFile(new URL("../scripts/verify-github-coverage.js", import.meta.url), "utf8");
    assert.equal([...script.matchAll(/SELECT pr_cards\.source_card_id AS pr_card_id/g)].length, 2);
});

test("reports complete 300-card coverage and CSV baseline coverage", () => {
    const report = verifyGithubCoverage(completeInput());
    assert.equal(report.card_v2_compatible, true);
    assert.equal(report.denominator, 300);
    assert.equal(report.endpoints.metadata.status_counts.PRESENT, 300);
    assert.equal(report.endpoints.commits.status_counts.EMPTY, 300);
    assert.equal(report.fields.language.status_counts.PRESENT, 150);
    assert.equal(report.fields.language.status_counts.EMPTY, 150);
});

test("reports missing run cards and pages without treating them as empty", () => {
    const input = completeInput();
    input.runCards = input.runCards.slice(0, 299);
    input.pages = input.pages.filter(page => page.pr_card_id !== "card-299");
    input.snapshots = input.snapshots.slice(0, 299);
    const report = verifyGithubCoverage(input);
    assert.equal(report.card_v2_compatible, false);
    assert.equal(report.omitted_cards.length, 1);
    assert.equal(report.omitted_cards[0].source_card_id, "card-299");
    assert.equal(report.endpoints.metadata.status_counts.MISSING, 1);
    assert.equal(report.fields.title.status_counts.MISSING, 1);
});

test("reports omitted, unavailable, and truncated endpoint states separately", () => {
    const input = completeInput();
    input.pages = input.pages.map(page => page.pr_card_id === "card-0" ? {...page, state: "UNAVAILABLE", normalized_payload: null, item_count: null} : page);
    input.pages = input.pages.map(page => page.pr_card_id === "card-1" && page.endpoint === "reviews" ? {...page, state: "UNAVAILABLE", normalized_payload: null, item_count: null} : page);
    input.pages = input.pages.map(page => page.pr_card_id === "card-2" && page.endpoint === "files" ? {...page, state: "TRUNCATED", normalized_payload: [{filename: "a"}], item_count: 1} : page);
    const report = verifyGithubCoverage(input);
    assert.equal(report.omitted_cards[0].reason, "GITHUB_PR_OMITTED");
    assert.equal(report.endpoints.metadata.status_counts.UNAVAILABLE, 1);
    assert.equal(report.endpoints.reviews.status_counts.UNAVAILABLE, 2);
    assert.equal(report.endpoints.files.status_counts.TRUNCATED, 1);
    assert.equal(report.fields.review_event_count.status_counts.UNAVAILABLE, 2);
    assert.equal(report.fields.changed_file_count.status_counts.TRUNCATED, 1);
});

test("marks historical telemetry as not instrumented without inventing rate limits", () => {
    const report = verifyGithubCoverage(completeInput());
    assert.deepEqual(report.telemetry, {
        telemetry_status: "NOT_INSTRUMENTED", event_count: 0, rate_limit_403_count: null, rate_limit_429_count: null,
    });
});
