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
    assert.match(rendered, /pr-status-open[^>]*>OPEN<\/span>/);
});

test("CardV2 template-render regression: Timeline and supplementary_activity evidence sections must not appear; Commits metric and review-event count must remain", async () => {
    const template = await readFile(path.join(root, "views/partials/instance/data.ejs"), "utf8");
    const projected = projectCardV2(card, {run_id: "run", snapshot_checksum: "checksum", pages: [
        {endpoint: "metadata", state: "COMPLETE", normalized_payload: {title: "GitHub title", user: {login: "github-author"}, commits: 5, additions: 10, deletions: 3}},
        {endpoint: "files", state: "COMPLETE", normalized_payload: [{filename: "a.go", additions: 10, deletions: 3}]},
        {endpoint: "reviews", state: "COMPLETE", normalized_payload: [
            {id: 1, state: "CHANGES_REQUESTED", body: "This is a textual review explanation.", path: "a.go", user: {login: "reviewer1"}},
            {id: 2, state: "APPROVED", body: null, path: "a.go", user: {login: "reviewer2"}},
            {id: 3, state: "APPROVED", body: "", path: "a.go", user: {login: "reviewer3"}},
            {id: 4, state: "APPROVED", body: "   ", path: "a.go", user: {login: "reviewer4"}},
        ]},
        {endpoint: "reviewComments", state: "COMPLETE", normalized_payload: [{id: 3, path: "a.go", body: "inline"}]},
        {endpoint: "issueComments", state: "COMPLETE_EMPTY", normalized_payload: []},
        {endpoint: "timeline", state: "COMPLETE", normalized_payload: [{id: "t1", author: "github-author", body: "Initial commit", path: "", created_at: "2024-01-01"}]},
        {endpoint: "commits", state: "COMPLETE", normalized_payload: [{id: "c1", author: "github-author", body: "Add feature X", path: "a.go", created_at: "2024-01-01"}]},
    ]});
    const rendered = ejs.render(template, {
        data: {...card, card_v2: projected},
        renderSafeMarkdown: value => String(value).replaceAll("<", "<").replaceAll(">", ">"),
    });

    // Timeline evidence section must be absent from participant HTML (data-local-section attribute)
    assert.doesNotMatch(rendered, /data-local-section="timeline"/, "Timeline evidence section should not appear in participant HTML");

    // supplementary_activity (Commits) evidence section must be absent from participant HTML
    assert.doesNotMatch(rendered, /data-local-section="supplementary_activity"/, "Commits evidence section should not appear in participant HTML");

    // Commits metric must remain visible in the metrics grid with normal literal label
    assert.match(rendered, /<span class="pr-metric-label">Commits<\/span>/, "Commits metric label should be visible");
    assert.match(rendered, /<strong class="pr-metric-value">5<\/strong>/, "Commits metric value should be 5");

    // No "No written explanation was captured." placeholder should appear
    assert.doesNotMatch(rendered, /No written explanation was captured/, "Bodyless review placeholder should not appear");

    // Textual CHANGES_REQUESTED review author and content must be present
    assert.match(rendered, /reviewer1/, "Textual review author reviewer1 should be present");
    assert.match(rendered, /This is a textual review explanation/, "Textual review content should be present");

    // Null-body review author must be absent from rendered HTML
    assert.doesNotMatch(rendered, /reviewer2/, "Null-body review author reviewer2 should be absent");

    // Empty-string body review author must be absent from rendered HTML
    assert.doesNotMatch(rendered, /reviewer3/, "Empty-string body review author reviewer3 should be absent");

    // Whitespace-only body review author must be absent from rendered HTML (per OpenSpec trim() filter)
    assert.doesNotMatch(rendered, /reviewer4/, "Whitespace-only body review author reviewer4 should be absent");

    // Textual CHANGES_REQUESTED review must still be visible
    assert.match(rendered, /CHANGES_REQUESTED/, "CHANGES_REQUESTED review should still be visible");

    // review-event metric must still equal all captured review events
    assert.equal(projected.metrics.review_event_count.value, 4, "review-event metric should equal total review events captured");
});

test("CardV2 evidence summaries use stable title, badge, and expansion columns", async () => {
    const stylesheet = await readFile(path.join(root, "public/css/main.css"), "utf8");
    const summaryRule = stylesheet.match(/\.pr-evidence-item summary \{([\s\S]*?)\n\}/)?.[1] || "";
    assert.match(summaryRule, /display:\s*grid/);
    assert.match(summaryRule, /grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto\s+1\.25rem/);
    assert.match(stylesheet, /\.pr-evidence-item summary > span:first-child \{[\s\S]*?min-width:\s*0;[\s\S]*?overflow-wrap:\s*anywhere;/);
    assert.match(stylesheet, /\.pr-evidence-item summary > span:nth-child\(2\) \{[\s\S]*?justify-self:\s*end;/);
    assert.match(stylesheet, /\.pr-evidence-item summary::after \{[\s\S]*?justify-self:\s*end;/);
});
