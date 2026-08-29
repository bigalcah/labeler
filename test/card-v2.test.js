import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import ejs from "ejs";
import {normalizeResponse} from "../util/github-pr-normalizer.js";
import {AVAILABILITY, projectCardV2} from "../util/study-card-projection.js";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const card = {
    id: "internal-id", source_card_id: "csv-id", repository: "owner/repo", pr_number: 7, ordinal: 2,
    title: "CSV title", body: "CSV body\nsecond line", author: "csv-author", language: "Go", state: "open", merged: false,
    html_url: "https://github.com/owner/repo/pull/7", created_at_source: "2024-01-01", closed_at_source: null, merged_at_source: null,
    summary: {commits: null, reviews: 1, comments: 2, changes_requested: 0}, evidence: {selected: "CSV evidence"},
    raw_payload: {token: "must not reach card_v2"},
};

test("normalizer strips email-bearing GitHub identities and keeps null review bodies", () => {
    const reviews = normalizeResponse("reviews", [{id: 2, user: {login: "reviewer", email: "private@example.test"}, state: "CHANGES_REQUESTED", body: null}]);
    assert.deepEqual(reviews, [{id: 2, user: {login: "reviewer", name: null}, state: "CHANGES_REQUESTED", body: null}]);
});

test("CardV2 separates review events from inline comments and derives complete changes", () => {
    const projected = projectCardV2(card, {run_id: "run", snapshot_checksum: "checksum", pages: [
        {endpoint: "metadata", state: "COMPLETE", normalized_payload: {title: "GitHub title", user: {login: "github-author"}, commits: 4, additions: 6, deletions: 2}},
        {endpoint: "files", state: "COMPLETE", normalized_payload: [{filename: "a.go", additions: 6, deletions: 2}]},
        {endpoint: "reviews", state: "COMPLETE", normalized_payload: [{id: 1, state: "CHANGES_REQUESTED", body: null}, {id: 2, state: "APPROVED"}]},
        {endpoint: "reviewComments", state: "COMPLETE", normalized_payload: [{id: 3, path: "a.go", body: "inline"}]},
        {endpoint: "issueComments", state: "COMPLETE_EMPTY", normalized_payload: []},
    ]});
    assert.equal(projected.fields.title.value, "GitHub title");
    assert.equal(projected.dataset_language.value, "Go");
    assert.equal(projected.metrics.review_event_count.value, 2);
    assert.equal(projected.metrics.review_comment_count.value, 1);
    assert.equal(projected.metrics.total_changes.value, 8);
    assert.equal(projected.github_evidence.reviews.items[0].body, null);
    assert.equal(projected.github_evidence.issue_comments.availability, AVAILABILITY.EMPTY);
    assert.equal(Object.hasOwn(projected, "raw_payload"), false);
});

test("CardV2 marks unavailable and truncated sections without inventing values", () => {
    const projected = projectCardV2(card, {run_id: "run", snapshot_checksum: "checksum", pages: [
        {endpoint: "files", state: "TRUNCATED", reason: "file limit", itemCount: 1, normalized_payload: [{filename: "a.go"}]},
        {endpoint: "reviews", state: "UNAVAILABLE", normalized_payload: null},
    ]});
    assert.equal(projected.github_evidence.files.availability, AVAILABILITY.TRUNCATED);
    assert.equal(projected.github_evidence.files.reason, "file limit");
    assert.equal(projected.github_evidence.reviews.availability, AVAILABILITY.UNAVAILABLE);
    assert.equal(projected.metrics.review_comment_count.value, null);
});

test("participant card renders safe local evidence without raw payload or unsafe links", async () => {
    const template = await readFile(path.join(root, "views/partials/instance/data.ejs"), "utf8");
    const rendered = ejs.render(template, {
        data: {...card, card_v2: projectCardV2({...card, html_url: "javascript:alert(1)"}, {run_id: "run", pages: [
            {endpoint: "reviews", state: "COMPLETE", normalized_payload: [{id: 1, state: "CHANGES_REQUESTED", body: "<script>alert(1)</script>\nline two"}]},
        ]})},
        renderSafeMarkdown: value => String(value).replaceAll("<", "&lt;").replaceAll(">", "&gt;"),
    });
    assert.doesNotMatch(rendered, /javascript:alert|must not reach card_v2|<script>alert/);
    assert.match(rendered, /CHANGES_REQUESTED/);
    assert.match(rendered, /line two/);
});
