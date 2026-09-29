import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import {fileURLToPath} from "node:url";
import ejs from "ejs";

const progressView = path.join(fileURLToPath(new URL("../views/", import.meta.url)), "progress.ejs");

const cardIds = Array.from({length: 12}, (_unused, index) => `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`);
const cardTitles = cardIds.map((_unused, index) => `Alice card ${index}`);

const rows = cardIds.map((id, ordinal) => {
    if (ordinal === 0 || ordinal === 5 || ordinal === 9) {
        return {id, ordinal, title: cardTitles[ordinal], status: "CLASSIFIED", own_category: "Alpha", discard_reason: null};
    }
    if (ordinal === 3) {
        return {id, ordinal, title: cardTitles[ordinal], status: "CLASSIFIED", own_category: "Beta", discard_reason: null};
    }
    if (ordinal === 2) {
        return {id, ordinal, title: cardTitles[ordinal], status: "DISCARDED", own_category: null, discard_reason: "duplicate"};
    }
    if (ordinal === 7) {
        return {id, ordinal, title: cardTitles[ordinal], status: "DISCARDED", own_category: null, discard_reason: null};
    }
    return {id, ordinal, title: cardTitles[ordinal], status: "PENDING", own_category: null, discard_reason: null};
});

const groupedCard = ordinal => ({
    id: cardIds[ordinal],
    ordinal,
    title: cardTitles[ordinal],
    html_url: `https://example.test/pr/${ordinal}`,
});

const categories = [
    {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
        raw_name: "Alpha",
        total: 3,
        cards: [groupedCard(0), groupedCard(5), groupedCard(9)],
    },
    {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2",
        raw_name: "Beta",
        total: 1,
        cards: [groupedCard(3)],
    },
    {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3",
        raw_name: "Zero",
        total: 0,
        cards: [],
    },
];

const renderProgress = ({
    pageRows = rows.slice(0, 5),
    total = rows.length,
    page = 1,
    limit = 5,
    totalPages = Math.ceil(total / limit),
    summary = categories,
    participant = {name: "participant-a"},
} = {}) => ejs.renderFile(progressView, {
    participant,
    selectedProgress: {total: 12, classified: 4, discarded: 2, pending: 6, completed: 6, percentage: 50},
    progressPage: {rows: pageRows, total, page, limit, totalPages},
    categorySummary: summary,
});

const listSection = html => html.split("<section class=\"pr-section\" aria-labelledby=\"progress-list-title\">")[1]?.split("</section>")[0] ?? "";
const summarySection = html => html.split("data-category-summary=\"true\"")[1]?.split("</section>")[0] ?? "";

const attributesOf = (tag, name) => tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1] ?? null;

const rowTags = section => section.match(/<li[^>]*data-progress-row="true"[^>]*>/g) ?? [];
const rowHrefs = section => [ ...section.matchAll(/<a class="pr-list-item" href="([^"]+)"/g) ].map(match => match[1]);
const rowTitles = section => [ ...section.matchAll(/<span class="d-block fw-semibold">([^<]*)<\/span>/g) ].map(match => match[1]);
const rowDetails = section => [ ...section.matchAll(/<span class="text-muted small">([^<]*)<\/span>/g) ].map(match => match[1]);
const rowBadges = section => [ ...section.matchAll(/<span class="badge (?:text-bg-[a-z]+)">([A-Z]+)<\/span>/g) ].map(match => match[1]);

const categoryGroups = section => section
    .split(/(?=<div class="pr-progress-card h-100"[^>]*data-category-group=)/)
    .slice(1)
    .map(segment => ({
        name: attributesOf(segment, "data-category-name"),
        count: Number(attributesOf(segment, "data-category-count")),
        badge: segment.match(/<span class="badge rounded-pill text-bg-light border">([^<]*)<\/span>/)?.[1] ?? null,
        empty: segment.match(/data-category-empty="true"[^>]*>([^<]*)</)?.[1] ?? null,
        cards: [ ...segment.matchAll(/<a[^>]*data-category-card="[^"]*"[^>]*>/g) ].map(match => match[0]).map(tag => ({
            id: attributesOf(tag, "data-card-id"),
            ordinal: Number(attributesOf(tag, "data-ordinal")),
            href: attributesOf(tag, "href"),
        })),
    }));

test("Given a page of assigned cards When progress renders Then rows keep ordinal order, private state and canonical links", async () => {
    const html = await renderProgress();
    const section = listSection(html);
    const expected = rows.slice(0, 5);
    const tags = rowTags(section);

    assert.equal(tags.length, 5, "the page must render exactly one row per returned card");
    assert.deepEqual(tags.map(tag => Number(attributesOf(tag, "data-ordinal"))), [0, 1, 2, 3, 4], "rows must keep the ordinal order from the page metadata");
    assert.deepEqual(tags.map(tag => attributesOf(tag, "data-card-id")), expected.map(row => row.id), "each row must carry the canonical card identifier");
    assert.deepEqual(tags.map(tag => attributesOf(tag, "data-status")), ["CLASSIFIED", "PENDING", "DISCARDED", "CLASSIFIED", "PENDING"], "each row must expose its private status");
    assert.deepEqual(rowHrefs(section), expected.map(row => `/queue/${row.id}`), "each row must link to the canonical queue route without identity parameters");
    assert.deepEqual(rowTitles(section), expected.map(row => row.title), "each row must render its card title");
    assert.deepEqual(
        rowDetails(section),
        [
            "Classified as Alpha",
            "Pending your private response",
            "Discarded: duplicate",
            "Classified as Beta",
            "Pending your private response",
        ],
        "classified rows show the own category, discarded rows show the own reason and pending rows show no decision",
    );
    assert.deepEqual(rowBadges(section), ["CLASSIFIED", "PENDING", "DISCARDED", "CLASSIFIED", "PENDING"], "rows must render a status badge");
    assert.match(section, /data-progress-total="true">12 assigned cards/, "the list must show the full membership total");
});

test("Given private categories When progress renders Then all groups appear with their whole-membership counts including zero", async () => {
    const html = await renderProgress();
    const groups = categoryGroups(summarySection(html));

    assert.deepEqual(groups.map(group => group.name), ["Alpha", "Beta", "Zero"], "every current category must render, including unused ones");
    assert.deepEqual(groups.map(group => group.count), [3, 1, 0], "counts must come from the whole membership, not the page");
    assert.deepEqual(groups.map(group => group.badge), ["3 classified", "1 classified", "0 classified"], "zero-count categories must render an explicit zero");
    assert.deepEqual(groups[2].cards, [], "zero-count categories must not invent grouped cards");
    assert.match(groups[2].empty, /No classified cards in this category yet/, "zero-count categories must render an accessible empty group");
    assert.deepEqual(groups[0].cards.map(card => ({id: card.id, ordinal: card.ordinal, href: card.href})), [groupedCard(0), groupedCard(5), groupedCard(9)].map(card => ({id: card.id, ordinal: card.ordinal, href: `/queue/${card.id}`})), "grouped cards must appear once in ordinal order under their category");
    assert.deepEqual(groups[1].cards.map(card => card.ordinal), [3], "each category must hold only its own classified cards");

    const groupedIds = groups.flatMap(group => group.cards.map(card => card.id));
    assert.equal(new Set(groupedIds).size, groupedIds.length, "each classified card must appear exactly once across groups");
});

test("Given normalized page metadata When progress renders Then the paginator keeps the effective page, previous, next and accessible empty state", async () => {
    const firstPage = await renderProgress();
    const firstSection = listSection(firstPage);

    assert.doesNotMatch(firstSection, /rel="prev"/, "page one must not emit a previous link");
    assert.match(firstSection, /aria-disabled="true">Previous</, "page one must expose the previous control as disabled");
    assert.match(firstSection, /<nav class="mt-3" aria-label="Progress pages">/, "the paginator must expose an accessible name");
    assert.match(firstSection, /rel="next" href="\/progress\?page=2&limit=5"/, "page one must link to the next page with normalized parameters");
    assert.match(firstSection, /aria-current="page">1</, "the active page must be marked");
    assert.match(firstSection, /data-progress-page="true" role="status">Page 1 of 3/, "the paginator must expose the effective page metadata");
    assert.match(firstSection, /up to 5 per page/, "the paginator must expose the effective limit");

    const outOfRange = await renderProgress({pageRows: [], page: 9, limit: 5});
    const emptySection = listSection(outOfRange);

    assert.equal(rowTags(emptySection).length, 0, "an out-of-range page must not render rows");
    assert.match(emptySection, /data-progress-empty="true" role="status"/, "an out-of-range page must render an accessible empty state");
    assert.match(emptySection, /No cards on this page\./, "the empty state must explain the situation");
    assert.match(emptySection, /rel="prev" href="\/progress\?page=8&limit=5"/, "the empty page must keep navigation metadata");
    assert.doesNotMatch(emptySection, /rel="next"/, "the empty page must not offer a next link past the membership");
    assert.match(emptySection, /aria-disabled="true">Next</, "the empty page must expose the next control as disabled");
    assert.match(emptySection, /aria-current="page">9</, "the requested out-of-range page must stay marked as active");
    assert.match(emptySection, /Page 9 of 3/, "the effective requested page and total pages must survive the empty state");
    assert.equal(summarySection(outOfRange), summarySection(firstPage), "the category summary must be independent from page and limit");

    const emptyStudy = await renderProgress({pageRows: [], total: 0, limit: 20});
    const emptyStudySection = listSection(emptyStudy);

    assert.match(emptyStudySection, /data-progress-empty="true" role="status"/, "an empty membership must render the accessible empty state");
    assert.match(emptyStudySection, /Page 1 of 1/, "an empty membership must still render stable page metadata");
    assert.match(emptyStudySection, /aria-disabled="true">Previous</, "an empty membership must disable the previous control");
    assert.match(emptyStudySection, /aria-disabled="true">Next</, "an empty membership must disable the next control");
    assert.doesNotMatch(emptyStudySection, /rel="(?:prev|next)"/, "an empty membership must not emit navigation links");
});

test("Given hostile titles and category names When progress renders Then user content is escaped and no identity or legacy surface is emitted", async () => {
    const riskyRows = [
        {
            id: cardIds[0],
            ordinal: 0,
            title: "Risky <script>alert(\"title\")</script> & done",
            status: "CLASSIFIED",
            own_category: "Cat <b>bold</b>",
            discard_reason: null,
        },
    ];
    const riskySummary = [
        {
            id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1",
            raw_name: "Risky <b>category</b> & more",
            total: 1,
            cards: [{id: cardIds[0], ordinal: 0, title: riskyRows[0].title, html_url: "https://example.test/risky"}],
        },
    ];
    const html = await renderProgress({pageRows: riskyRows, summary: riskySummary});

    assert.ok(!html.includes("<script>alert(\"title\")</script>"), "card titles must never inject executable markup");
    assert.ok(html.includes("&lt;script&gt;"), "card titles must be HTML escaped");
    assert.ok(!html.includes("<b>category</b>"), "category names must be HTML escaped");
    assert.ok(html.includes("&lt;b&gt;category&lt;/b&gt;"), "category names must render their escaped text");

    const hrefs = [ ...html.matchAll(/href="([^"]*)"/g) ].map(match => match[1]);
    for (const href of hrefs) {
        assert.doesNotMatch(href, /instances|participant|study|reviewer/i, `canonical links must not carry identity or legacy targets: ${href}`);
    }
    assert.doesNotMatch(html, /<select/, "the legacy participant selector must stay absent");
    assert.doesNotMatch(html, /name="(?:participant|study|reviewer|reviewer_id)/, "no form field may carry participant, study or reviewer identity");
    assert.ok(!html.includes("/instances"), "the legacy instances surface must stay absent");
});
