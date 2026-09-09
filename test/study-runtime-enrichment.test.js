import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {projectEnrichedCard} from "../util/study-card-projection.js";
import {lockStudyCard} from "../util/study-mutation.js";
import {renderSafeMarkdown} from "../util/safe-markdown.js";

const csvCard = {
    id: "card-id",
    title: "CSV title",
    body: "CSV body",
    author: "csv-author",
    language: "JavaScript",
    state: "open",
    merged: false,
    html_url: "https://csv.example/pr/1",
    created_at_source: "2024-01-01",
    closed_at_source: null,
    merged_at_source: null,
    summary: {commits: 2, reviews: 1, comments: 3, changes_requested: 1},
    evidence: {selected: "CSV evidence"},
    raw_payload: {source: "csv"},
    source_checksum: "csv-checksum",
};
const root = path.resolve(new URL("..", import.meta.url).pathname);

test("CSV-only projection preserves the baseline and exposes empty GitHub evidence", () => {
    const projected = projectEnrichedCard(csvCard);

    assert.deepEqual(projected, {
        ...csvCard,
        enrichment: {
            run_id: null,
            snapshot_checksum: null,
            completeness: {},
            evidence: {github: {}},
            provenance: {
                "/title": {source: "CSV", run_id: null, endpoint: null, status: "BASELINE"},
                "/body": {source: "CSV", run_id: null, endpoint: null, status: "BASELINE"},
                "/author": {source: "CSV", run_id: null, endpoint: null, status: "BASELINE"},
                "/state": {source: "CSV", run_id: null, endpoint: null, status: "BASELINE"},
                "/merged": {source: "CSV", run_id: null, endpoint: null, status: "BASELINE"},
                "/html_url": {source: "CSV", run_id: null, endpoint: null, status: "BASELINE"},
                "/dates/created_at": {source: "CSV", run_id: null, endpoint: null, status: "BASELINE"},
                "/dates/closed_at": {source: "CSV", run_id: null, endpoint: null, status: "BASELINE"},
                "/dates/merged_at": {source: "CSV", run_id: null, endpoint: null, status: "BASELINE"},
                "/summary/commits": {source: "CSV", run_id: null, endpoint: null, status: "BASELINE"},
                "/summary/reviews": {source: "CSV", run_id: null, endpoint: null, status: "BASELINE"},
                "/summary/comments": {source: "CSV", run_id: null, endpoint: null, status: "BASELINE"},
                "/summary/changes_requested": {source: "CSV", run_id: null, endpoint: null, status: "BASELINE"},
            },
        },
    });
});

test("promoted complete metadata takes precedence while language and CSV evidence stay unchanged", () => {
    const projected = projectEnrichedCard(csvCard, {
        run_id: "run-1",
        snapshot_checksum: "snapshot-1",
        pages: [
            {
                endpoint: "metadata",
                state: "COMPLETE",
                normalized_payload: {
                    title: "GitHub title",
                    body: "GitHub body",
                    user: {login: "github-author"},
                    state: "closed",
                    merged: true,
                    html_url: "https://github.example/pr/1",
                    created_at: "2025-01-01",
                    commits: 8,
                    comments: 5,
                },
            },
            {endpoint: "reviews", state: "COMPLETE", normalized_payload: [{state: "CHANGES_REQUESTED"}, {state: "APPROVED"}]},
            {endpoint: "issueComments", state: "COMPLETE_EMPTY", normalized_payload: []},
        ],
    });

    assert.equal(projected.title, "GitHub title");
    assert.equal(projected.author, "github-author");
    assert.equal(projected.language, "JavaScript");
    assert.equal(projected.summary.commits, 8);
    assert.equal(projected.summary.comments, 5);
    assert.equal(projected.summary.reviews, 2);
    assert.equal(projected.evidence.selected, "CSV evidence");
    assert.equal(projected.enrichment.evidence.github.metadata.pages.length, 1);
    assert.deepEqual(projected.enrichment.provenance["/title"], {
        source: "GITHUB", run_id: "run-1", endpoint: "metadata", status: "COMPLETE",
    });
});

test("unavailable or unpromoted endpoint data never overwrites CSV values", () => {
    const projected = projectEnrichedCard(csvCard, {
        run_id: "run-2",
        snapshot_checksum: "snapshot-2",
        pages: [
            {endpoint: "metadata", state: "UNAVAILABLE", normalized_payload: {title: "must not leak"}},
            {endpoint: "reviews", state: "FAILED", normalized_payload: [{state: "CHANGES_REQUESTED"}]},
        ],
    });

    assert.equal(projected.title, "CSV title");
    assert.equal(projected.summary.reviews, 1);
    assert.equal(projected.enrichment.completeness.metadata, "UNAVAILABLE");
    assert.equal(projected.enrichment.completeness.reviews, "FAILED");
});

test("mutation lock rejects a promoted card without a completed mapped run", async () => {
    const queries = [];
    const executor = {query: async (sql, parameters) => {
        queries.push([sql, parameters]);
        return {rows: [{pr_card_id: "card-id", ordinal: 0, promotion_run_id: "run-id", promotion_state: "FAILED", mapped_card_id: "card-id"}]};
    }};

    await assert.rejects(() => lockStudyCard(executor, "study-id", "card-id"), error => {
        assert.equal(error.name, "StudyRuntimeError");
        assert.equal(error.status, 409);
        return true;
    });
    assert.deepEqual(queries[0][1], ["study-id", "card-id"]);
    assert.match(queries[0][0], /study_enrichment_promotion/);
    assert.match(queries[0][0], /FOR UPDATE OF study_card/);
});

test("classification and discard mutations carry study and promoted run parameters", async () => {
    const root = path.resolve(new URL("..", import.meta.url).pathname);
    const [classify, discard] = await Promise.all([
        readFile(path.join(root, "routes/queue/[id]/classify/index.js"), "utf8"),
        readFile(path.join(root, "routes/queue/[id]/discard/index.js"), "utf8"),
    ]);

    assert.match(classify, /study_id, enrichment_run_id/);
    assert.match(classify, /lockedCard\.enrichment_run_id/);
    assert.match(classify, /AND study_id = \$6/);
    assert.match(discard, /reason, study_id, enrichment_run_id/);
    assert.match(discard, /lockedCard\.enrichment_run_id/);
});

test("GitHub-shaped text is sanitized before markdown reaches the view", () => {
    const rendered = renderSafeMarkdown("<script>alert(1)</script> [unsafe](javascript:alert(1)) **safe**");

    assert.doesNotMatch(rendered, /<script|href=["']javascript:/i);
    assert.match(rendered, /safe/);
});

test("runtime routes and views contain no GitHub network client or API endpoint", async () => {
    const runtimeFiles = [
        "routes/queue/[id]/classify/index.js",
        "routes/queue/[id]/discard/index.js",
        "routes/queue/[id]/index.js",
        "views/partials/instance/data.ejs",
    ];
    const sources = await Promise.all(runtimeFiles.map(file => readFile(path.join(root, file), "utf8")));

    for (const source of sources) {
        assert.doesNotMatch(source, /github-pr-client|api\.github\.com|fetch\s*\(/i);
    }
});
