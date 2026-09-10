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
        assert.match(completeHtml, /Commits<\/span><strong class="pr-metric-value">2/);
        assert.match(completeHtml, /src\/card\.js/);
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
        assert.match(limitedHtml, /Changed files[\s\S]*Truncated · 1[\s\S]*Provider file cap reached/);
        assert.doesNotMatch(limitedHtml, /truncated-diff-marker/);

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
