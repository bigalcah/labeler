import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFile} from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import ejs from "ejs";
import {readPullRequestCards} from "../util/csv-pr-provider.js";
import {readCopilot369Cards} from "../util/copilot-369-source.js";
import {AVAILABILITY, projectCardV2} from "../util/study-card-projection.js";
import {renderSafeMarkdown} from "../util/safe-markdown.js";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const fixtureDirectory = path.join(root, "test-data/copilot-369/presentation");
const [copilotCard, historicalBaseline, template, historicalSource, copilot369Source] = await Promise.all([
    readFile(path.join(fixtureDirectory, "copilot-369-card.json"), "utf8").then(JSON.parse),
    readFile(path.join(fixtureDirectory, "historical30-baseline.json"), "utf8").then(JSON.parse),
    readFile(path.join(root, "views/partials/instance/data.ejs"), "utf8"),
    readPullRequestCards(path.join(root, "plans/validation-30-cards.csv"), {expectedCardCount: 30}),
    readCopilot369Cards(path.join(root, "plans/copilot-369-cards.csv")),
]);
const historicalCard = {...historicalSource.cards[0], source_checksum: historicalSource.sourceChecksum};

const renderCard = card => {
    const projected = projectCardV2(card);
    return {
        projected,
        rendered: ejs.render(template, {data: {...card, card_v2: projected}, renderSafeMarkdown}),
    };
};
const sha256 = value => createHash("sha256").update(value).digest("hex");

test("Copilot369 metadata keeps normalized values and CSV provenance", () => {
    const {projected} = renderCard(copilotCard);

    assert.equal(projected.identity.source_card_id, copilotCard.source_card_id);
    assert.equal(projected.identity.repository, copilotCard.repository);
    assert.equal(projected.identity.pr_number, copilotCard.pr_number);
    assert.equal(projected.fields.author.value, copilotCard.author);
    assert.equal(projected.fields.state.value, copilotCard.state);
    assert.equal(projected.fields.html_url.value, copilotCard.html_url);
    assert.equal(projected.dataset_language.value, copilotCard.language);
    assert.deepEqual(Object.fromEntries(Object.entries(projected.dates).map(([name, value]) => [name, value.value])), copilotCard.dates);
    assert.equal(projected.fields.author.provenance.source, "CSV");
    assert.equal(projected.dates.created_at.provenance.source, "CSV");
    assert.equal(projected.snapshot.run_id, null);
    assert.equal(projected.snapshot.snapshot_checksum, null);
});

test("Copilot369 conversation arrays map to current sections without GitHub provenance", () => {
    const {projected} = renderCard(copilotCard);
    const reviews = projected.github_evidence.reviews;
    const comments = projected.github_evidence.issue_comments;
    const inlineComments = projected.github_evidence.review_comments;

    assert.deepEqual(reviews.items[0], {
        id: "review-1",
        author: "reviewer-source",
        state: "CHANGES_REQUESTED",
        body: "Review **detail**.",
        path: null,
        diff_hunk: null,
        line: null,
        created_at: "2026-01-02T10:00:00Z",
        updated_at: null,
        url: "https://github.com/fixture-owner/copilot-project/pull/369#review-1",
    });
    assert.equal(comments.items[0].author, "commenter-source");
    assert.equal(comments.items[0].created_at, "2026-01-02T11:00:00Z");
    assert.equal(comments.items[0].state, "issue_comment");
    assert.equal(comments.items[0].url, "https://github.com/fixture-owner/copilot-project/pull/369#comment-1");
    assert.equal(inlineComments.items[0].author, "inline-reviewer-source");
    assert.equal(inlineComments.items[0].created_at, "2026-01-02T12:00:00Z");
    assert.equal(inlineComments.items[0].path, "src/example.ts");
    for (const section of [reviews, comments, inlineComments]) {
        assert.equal(section.provenance.source, "CSV");
        assert.equal(section.provenance.run_id, null);
        assert.equal(section.provenance.snapshot_checksum, null);
    }
});

test("canonical Copilot369 cards preserve raw metadata and conversation availability", () => {
    const conversations = [
        ["reviews_json", "reviews", "reviews", "reviews", "submitted_at"],
        ["pr_comments_json", "comments", "issueComments", "issue_comments", "created_at"],
        ["inline_comments_json", "review_comments", "reviewComments", "review_comments", "created_at"],
    ];

    assert.equal(copilot369Source.cards.length, 369);
    for (const card of copilot369Source.cards) {
        const raw = card.raw_payload;
        const projected = projectCardV2(card);

        assert.equal(projected.identity.source_card_id, raw.pr_id);
        assert.equal(projected.identity.repository, raw.repository_full_name);
        assert.equal(projected.identity.pr_number, Number(raw.number));
        assert.equal(projected.fields.title.value, raw.title);
        assert.equal(projected.fields.body.value, raw.body === "" ? undefined : raw.body);
        assert.equal(projected.fields.author.value, raw.user || null);
        assert.equal(projected.fields.state.value, raw.state);
        assert.equal(projected.fields.merged.value, raw.merged_at ? true : raw.state === "open" ? false : undefined);
        assert.equal(projected.fields.html_url.value, raw.html_url);
        assert.equal(projected.dates.created_at.value, raw.created_at);
        assert.equal(projected.dates.closed_at.value, raw.closed_at || null);
        assert.equal(projected.dates.merged_at.value, raw.merged_at || null);
        assert.equal(projected.dataset_language.value, raw.repository_language || null);
        assert.equal(projected.dataset_language.availability, raw.repository_language ? AVAILABILITY.PRESENT : AVAILABILITY.EMPTY);
        assert.equal(projected.snapshot.run_id, null);
        assert.equal(projected.snapshot.snapshot_checksum, null);

        for (const [rawField, evidenceField, endpoint, sectionName, timestampField] of conversations) {
            const sourceItems = JSON.parse(raw[rawField]);
            const availability = sourceItems.length === 0 ? AVAILABILITY.EMPTY : AVAILABILITY.PRESENT;
            const section = projected.github_evidence[sectionName];

            assert.equal(projected.availability[endpoint], availability, `${raw.pr_id} ${rawField} availability`);
            assert.equal(section.availability, availability, `${raw.pr_id} ${rawField} section`);
            assert.deepEqual(section.items, sourceItems.map(item => ({
                id: item.id,
                author: item.user,
                state: item.state ?? item.event_type,
                body: item.body,
                path: item.path ?? null,
                diff_hunk: item.diff_hunk ?? null,
                line: item.line ?? item.original_line ?? null,
                created_at: item[timestampField],
                updated_at: item.updated_at ?? null,
                url: new URL(item.source_url).toString(),
            })), `${raw.pr_id} ${rawField} mapping`);
            assert.deepEqual(section.provenance, {
                source: "CSV",
                run_id: null,
                snapshot_checksum: null,
                endpoint: null,
                status: "BASELINE",
                captured_at: null,
                pointer: `/${rawField}`,
            }, `${raw.pr_id} ${rawField} provenance`);
            assert.equal(card.evidence[evidenceField].length, sourceItems.length);
        }
    }
});

test("Copilot369 conversation collections distinguish valid empty arrays from missing fields", () => {
    const emptyProjection = renderCard({...copilotCard, evidence: {...copilotCard.evidence, reviews: []}}).projected;
    const absentProjection = renderCard({...copilotCard, evidence: {source: "CSV"}}).projected;
    const empty = emptyProjection.github_evidence.reviews;
    const absent = absentProjection.github_evidence;

    assert.equal(empty.availability, AVAILABILITY.EMPTY);
    assert.equal(emptyProjection.availability.reviews, AVAILABILITY.EMPTY);
    assert.deepEqual(empty.items, []);
    assert.equal(empty.captured_count, 0);
    assert.equal(empty.provenance.source, "CSV");
    assert.equal(Object.hasOwn(absent, "reviews"), false);
    assert.equal(Object.hasOwn(absent, "issue_comments"), false);
    assert.equal(Object.hasOwn(absent, "review_comments"), false);
    assert.equal(absentProjection.availability.reviews, AVAILABILITY.UNAVAILABLE);
    assert.equal(absentProjection.availability.issueComments, AVAILABILITY.UNAVAILABLE);
    assert.equal(absentProjection.availability.reviewComments, AVAILABILITY.UNAVAILABLE);
});

test("Copilot369 card renders local conversations safely without raw fields or network dependencies", () => {
    const {rendered} = renderCard(copilotCard);

    assert.match(rendered, /Canonical Copilot source card/);
    assert.match(rendered, /Dataset language: TypeScript/);
    assert.match(rendered, /source-pr-author/);
    assert.match(rendered, /reviewer-source/);
    assert.match(rendered, /CHANGES_REQUESTED/);
    assert.match(rendered, /2026-01-02T10:00:00Z/);
    assert.match(rendered, /Review <strong>detail<\/strong>/);
    assert.match(rendered, /commenter-source/);
    assert.match(rendered, /PR comment text/);
    assert.match(rendered, /inline-reviewer-source/);
    assert.match(rendered, /Inline comment text/);
    assert.doesNotMatch(rendered, /<script|href=["']javascript:|MUST_NOT_RENDER|reviews_json|raw_payload/i);
    assert.doesNotMatch(rendered, /pr-metric-label|pr-metric-value|pr-metrics-grid|Timeline|data-local-section="files"/);
    assert.doesNotMatch(template, /github-pr-client|api\.github\.com|fetch\s*\(/i);
});

test("Copilot369 card omits optional absent metadata, evidence, language, and links", () => {
    const sparseCard = {
        ...copilotCard,
        evidence: {source: "CSV"},
        dates: {},
    };
    for (const field of ["body", "author", "language", "html_url"]) delete sparseCard[field];
    const {rendered} = renderCard(sparseCard);

    assert.doesNotMatch(rendered, /Not available|Author unavailable|Dataset language:/);
    assert.doesNotMatch(rendered, /pr-meta-grid|Intention and baseline evidence|No CSV evidence is available/);
    assert.doesNotMatch(rendered, /Pull request conversations|data-local-section="reviews"/);
    assert.doesNotMatch(rendered, /Open on GitHub|View full diff and deeper GitHub details|href=/);
});

test("Copilot369 card rejects unsafe links and escapes untrusted authors", () => {
    const unsafeCard = structuredClone(copilotCard);
    unsafeCard.html_url = "javascript:alert(1)";
    unsafeCard.author = "<img src=x onerror=alert(1)>";
    unsafeCard.evidence.reviews[0].author = "<img src=x onerror=alert(2)>";
    unsafeCard.evidence.reviews[0].source_url = "javascript:alert(3)";
    unsafeCard.evidence.reviews[0].body = "[unsafe](javascript:alert(4)) <script>alert(5)</script>";
    const {projected, rendered} = renderCard(unsafeCard);

    assert.equal(projected.fields.html_url.value, null);
    assert.equal(projected.github_evidence.reviews.items[0].url, null);
    assert.doesNotMatch(rendered, /<img[^>]*onerror|<script|href=["']javascript:/i);
    assert.doesNotMatch(rendered, /Open on GitHub|View full diff and deeper GitHub details/);
});

test("Copilot369 review events without body stay hidden while their projected source fields remain truthful", () => {
    const bodylessReviewCard = structuredClone(copilotCard);
    bodylessReviewCard.evidence.reviews[0].body = null;
    const {projected, rendered} = renderCard(bodylessReviewCard);
    const [review] = projected.github_evidence.reviews.items;

    assert.equal(review.author, "reviewer-source");
    assert.equal(review.state, "CHANGES_REQUESTED");
    assert.equal(review.created_at, "2026-01-02T10:00:00Z");
    assert.match(rendered, /The CSV source contains 1 review event without written text/);
    assert.doesNotMatch(rendered, /<strong>reviewer-source<\/strong>|CHANGES_REQUESTED|2026-01-02T10:00:00Z/);
});

test("historical30 projection and rendering remain byte-identical to the captured baseline", () => {
    assert.equal(historicalSource.sourceChecksum, historicalBaseline.source_checksum);
    assert.equal(historicalCard.source_card_id, historicalBaseline.source_card_id);
    const {projected, rendered} = renderCard(historicalCard);

    assert.equal(sha256(JSON.stringify(projected)), historicalBaseline.baseline.projection_sha256);
    assert.equal(sha256(rendered), historicalBaseline.baseline.render_sha256);
    assert.equal(Buffer.byteLength(rendered), historicalBaseline.baseline.render_bytes);
});
