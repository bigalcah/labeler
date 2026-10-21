import assert from "node:assert/strict";
import test from "node:test";
import {normalizeCopilot369Rows} from "../util/copilot-369-normalizer.js";

const jsonFields = [
    "eligible_feedback_json",
    "post_interaction_commits_json",
    "commits_json",
    "pr_comments_json",
    "inline_comments_json",
    "reviews_json",
    "feedback_pre_merge_events_json",
    "post_feedback_pre_merge_commits_json",
    "pre_merge_timeline_json",
];

const validRow = overrides => ({
    pr_id: "9007199254740993",
    agent: "Copilot",
    number: "42",
    pr_url: "https://github.com/example/project/pull/42",
    html_url: "https://github.com/example/project/pull/42",
    repo_url: "https://api.github.com/repos/example/project",
    repository_url: "https://api.github.com/repos/example/project",
    repository_full_name: "example/project",
    title: "A source title",
    body: "Body text",
    user: "Copilot",
    state: "closed",
    created_at: "2026-03-09T23:51:17Z",
    closed_at: "2026-03-10T08:50:45Z",
    merged_at: "2026-03-10T08:50:45Z",
    repository_language: "Go",
    commit_count: "0",
    ...Object.fromEntries(jsonFields.map(field => [field, "[]"])),
    ...overrides,
});

const runNormalizer = row => normalizeCopilot369Rows([row], {
    sourceChecksum: "fixture-checksum",
    provenance: {source_type: "fixture"},
});

test("normalizer preserves large decimal identities and truthful conversation authors and timestamps", () => {
    const review = {
        id: "review-1",
        user: "Review Author",
        state: "APPROVED",
        body: "Reviewed",
        submitted_at: "2026-03-10T08:00:00Z",
        event_at: "2026-03-10T08:00:00+00:00",
        event_key: "review:1",
        event_type: "review",
        source_table: "pr_reviews",
        source_url: "https://github.com/example/project/pull/42",
        user_type: "User",
    };
    const {cards, errors} = runNormalizer(validRow({reviews_json: JSON.stringify([review])}));

    assert.deepEqual(errors, []);
    assert.equal(cards[0].source_pr_id, "9007199254740993");
    assert.equal(cards[0].source_card_id, "9007199254740993");
    assert.equal(cards[0].source_checksum, "fixture-checksum");
    assert.equal(cards[0].pr_number, 42);
    assert.equal(cards[0].author, "Copilot");
    assert.equal(cards[0].dates.created_at, "2026-03-09T23:51:17Z");
    assert.equal(cards[0].dates.closed_at, "2026-03-10T08:50:45Z");
    assert.equal(cards[0].dates.merged_at, "2026-03-10T08:50:45Z");
    assert.equal(cards[0].merged, true);
    assert.equal(cards[0].evidence.reviews[0].user, "Review Author");
    assert.equal(cards[0].evidence.reviews[0].author, "Review Author");
    assert.equal(cards[0].evidence.reviews[0].submitted_at, review.submitted_at);
    assert.equal(cards[0].evidence.reviews[0].event_at, review.event_at);
    assert.equal(cards[0].raw_payload.reviews_json, JSON.stringify([review]));
});

test("normalizer distinguishes an empty JSON array from an absent optional collection", () => {
    const {cards, errors, report} = runNormalizer(validRow({pr_comments_json: ""}));

    assert.deepEqual(errors, []);
    assert.deepEqual(cards[0].evidence.reviews, []);
    assert.equal(Object.hasOwn(cards[0].evidence, "comments"), false);
    assert.equal(report.omissions.find(omission => omission.field === "pr_comments_json").count, 1);
    assert.equal(Object.hasOwn(cards[0].evidence, "selected"), false);
});

test("normalizer rejects malformed JSON and returns no partial cards", () => {
    const {cards, errors} = runNormalizer(validRow({reviews_json: "[{"}));

    assert.deepEqual(cards, []);
    assert.ok(errors.some(error => error.code === "JSON_MALFORMED" && error.field === "reviews_json"));
});

test("normalizer rejects a JSON collection with the wrong top-level schema", () => {
    const {cards, errors} = runNormalizer(validRow({inline_comments_json: "{}"}));

    assert.deepEqual(cards, []);
    assert.ok(errors.some(error => error.code === "JSON_SCHEMA_INVALID" && error.field === "inline_comments_json"));
});

test("normalizer rejects conversation items missing required source properties", () => {
    const {cards, errors} = runNormalizer(validRow({reviews_json: JSON.stringify([{user: "author"}])}));

    assert.deepEqual(cards, []);
    assert.ok(errors.some(error => error.code === "JSON_ITEM_SCHEMA_INVALID" && error.field === "reviews_json"));
});

test("normalizer rejects malformed schemas in non-conversation JSON columns", () => {
    const {cards, errors} = runNormalizer(validRow({commits_json: JSON.stringify([{}])}));

    assert.deepEqual(cards, []);
    assert.ok(errors.some(error => error.code === "JSON_ITEM_SCHEMA_INVALID" && error.field === "commits_json"));
});

test("normalizer rejects agent, repository, number, and URL identity disagreement", () => {
    const {cards, errors} = runNormalizer(validRow({
        agent: "Other agent",
        repository_full_name: "different/repository",
        html_url: "https://github.com/example/project/pull/43",
    }));

    assert.deepEqual(cards, []);
    assert.ok(errors.some(error => error.code === "AGENT_MISMATCH"));
    assert.ok(errors.some(error => error.code === "URL_IDENTITY_MISMATCH"));
    assert.ok(errors.some(error => error.code === "URL_NUMBER_MISMATCH"));
    assert.ok(errors.some(error => error.code === "REPOSITORY_URL_MISMATCH"));
});

test("normalizer rejects duplicate PR identities without returning partial cards", () => {
    const {cards, errors} = normalizeCopilot369Rows([validRow(), validRow({title: "Duplicate identity"})]);

    assert.deepEqual(cards, []);
    assert.ok(errors.some(error => error.code === "PR_ID_DUPLICATE" && error.pr_id === "9007199254740993"));
});

test("normalizer does not infer merged false from closed state without merge timestamp", () => {
    const {cards, errors, report} = runNormalizer(validRow({merged_at: ""}));

    assert.deepEqual(errors, []);
    assert.equal(Object.hasOwn(cards[0], "merged"), false);
    assert.equal(report.omissions.find(omission => omission.field === "merged").reason, "closed_state_without_merged_at");
});

test("normalizer derives merged false only from open state and rejects inconsistent timestamps", () => {
    const open = runNormalizer(validRow({state: "open", closed_at: "", merged_at: ""}));
    const inconsistent = runNormalizer(validRow({state: "open"}));

    assert.deepEqual(open.errors, []);
    assert.equal(open.cards[0].merged, false);
    assert.deepEqual(inconsistent.cards, []);
    assert.ok(inconsistent.errors.some(error => error.code === "STATE_TIMESTAMP_MISMATCH"));
});

test("normalizer rejects malformed source timestamps before returning cards", () => {
    const {cards, errors} = runNormalizer(validRow({created_at: "not-a-timestamp"}));

    assert.deepEqual(cards, []);
    assert.ok(errors.some(error => error.code === "TIMESTAMP_INVALID" && error.field === "created_at"));
});

test("normalizer rejects impossible calendar dates instead of accepting JavaScript date rollover", () => {
    const {cards, errors} = runNormalizer(validRow({created_at: "2026-02-30T10:00:00Z"}));

    assert.deepEqual(cards, []);
    assert.ok(errors.some(error => error.code === "TIMESTAMP_INVALID" && error.field === "created_at"));
});
