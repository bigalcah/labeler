import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import ejs from "ejs";
import {normalizeResponse} from "../util/github-pr-normalizer.js";
import {AVAILABILITY, projectCardV2} from "../util/study-card-projection.js";
import {renderSafeMarkdown} from "../util/safe-markdown.js";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const fixturePath = path.join(root, "test-data/github-card-fixture.json");
const viewPath = path.join(root, "views/partials/instance/data.ejs");

const normalizePages = pages => pages.map(({payload, ...page}) => ({
    ...page,
    normalized_payload: page.state === "UNAVAILABLE" ? null : normalizeResponse(page.endpoint, payload),
}));

test("sanitized provider fixtures feed the existing CardV2 view offline", async () => {
    const [fixtureSource, template] = await Promise.all([
        readFile(fixturePath, "utf8"),
        readFile(viewPath, "utf8"),
    ]);
    assert.doesNotMatch(fixtureSource, /authorization|token|password|raw_payload|[\w.+-]+@[\w.-]+/i);

    const fixture = JSON.parse(fixtureSource);
    let networkCalls = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
        networkCalls += 1;
        throw new Error("Provider fixture attempted a network call");
    };

    try {
        const completePages = normalizePages(fixture.scenarios.complete.pages);
        const complete = projectCardV2(fixture.card, {
            ...fixture.scenarios.complete.snapshot,
            pages: completePages,
        });
        const completeHtml = ejs.render(template, {
            data: {...fixture.card, card_v2: complete},
            renderSafeMarkdown,
        });

        assert.equal(complete.fields.title.value, "Offline provider title");
        assert.equal(complete.metrics.commit_count.value, 2);
        assert.equal(complete.github_evidence.files.items[0].path, "src/card.js");
        assert.equal(complete.github_evidence.supplementary_activity.items[0].body, "Add offline card projection");
        assert.equal(complete.github_evidence.timeline.items[0].state, "review_requested");
        assert.equal(completePages.find(page => page.endpoint === "diff").normalized_payload, fixture.scenarios.complete.pages.find(page => page.endpoint === "diff").payload);
        assert.match(completeHtml, /Offline provider title/);
        assert.doesNotMatch(completeHtml, /pr-metric-label|pr-metric-value|pr-metrics-grid/, "participant HTML must not contain the metrics block");
        assert.doesNotMatch(completeHtml, /data-local-section="files"|All CSV evidence|src\/card\.js/, "participant HTML must not contain changed files or the full CSV dump");
        assert.doesNotMatch(completeHtml, /data-page-size="10"/, "participant HTML must not fall back to the legacy 10-item batch");
        assert.match(completeHtml, /View full diff and deeper GitHub details/);
        assert.doesNotMatch(completeHtml, /provider-only-marker|offline-diff-marker|offline-patch-marker/);
        assert.doesNotMatch(completeHtml, /data-local-section="timeline"|data-local-section="supplementary_activity"/);

        const limited = projectCardV2(fixture.card, {
            ...fixture.scenarios.emptyAndTruncated.snapshot,
            pages: normalizePages(fixture.scenarios.emptyAndTruncated.pages),
        });
        const limitedHtml = ejs.render(template, {
            data: {...fixture.card, card_v2: limited},
            renderSafeMarkdown,
        });

        assert.equal(limited.github_evidence.supplementary_activity.availability, AVAILABILITY.EMPTY);
        assert.equal(limited.github_evidence.files.availability, AVAILABILITY.TRUNCATED);
        assert.equal(limited.github_evidence.files.reason, "Provider file cap reached");
        assert.equal(limited.github_evidence.timeline.availability, AVAILABILITY.EMPTY);
        assert.equal(limited.metrics.changed_file_count.value, null);
        assert.equal(limited.metrics.changed_file_count.availability, AVAILABILITY.TRUNCATED);
        assert.doesNotMatch(limitedHtml, /Changed files|Provider file cap reached|data-local-section="files"/, "a truncated files section must not render as participant evidence");
        assert.doesNotMatch(limitedHtml, /truncated-diff-marker/);

        const blankReviews = projectCardV2(fixture.card, {
            ...fixture.scenarios.reviewsWithoutText.snapshot,
            pages: normalizePages(fixture.scenarios.reviewsWithoutText.pages),
        });
        const blankReviewsHtml = ejs.render(template, {
            data: {...fixture.card, card_v2: blankReviews},
            renderSafeMarkdown,
        });

        assert.equal(blankReviews.github_evidence.reviews.availability, AVAILABILITY.PRESENT);
        assert.equal(blankReviews.github_evidence.reviews.captured_count, 2);
        assert.equal(blankReviews.github_evidence.reviews.items.length, 2, "bodyless reviews remain captured in the projection");
        assert.match(blankReviewsHtml, /<strong>No written review explanations\.<\/strong> The local snapshot captured 2 review events without written text\./, "the provider fixture must render the explicit captured-but-empty state");
        assert.doesNotMatch(blankReviewsHtml, /blank-reviewer|whitespace-reviewer/, "bodyless provider reviews must not render entries");
        assert.doesNotMatch(blankReviewsHtml, /pr-event-list|data-local-item/, "captured-but-empty provider reviews must not render a batch list");
        assert.match(blankReviewsHtml, /data-local-section="reviews"[\s\S]*?Available · 2/, "the provider badge must keep the captured count");

        const unavailablePages = normalizePages(fixture.scenarios.unavailable.pages);
        const unavailable = projectCardV2(fixture.card, {
            ...fixture.scenarios.unavailable.snapshot,
            pages: unavailablePages,
        });

        assert.ok(unavailablePages.every(page => page.normalized_payload === null));
        assert.equal(unavailable.fields.title.value, fixture.card.title);
        assert.equal(unavailable.availability.commits, AVAILABILITY.UNAVAILABLE);
        assert.equal(unavailable.github_evidence.files.availability, AVAILABILITY.UNAVAILABLE);
        assert.equal(unavailable.github_evidence.timeline.availability, AVAILABILITY.UNAVAILABLE);
        assert.equal(networkCalls, 0);
    } finally {
        globalThis.fetch = originalFetch;
    }
});
