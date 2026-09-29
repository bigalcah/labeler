import assert from "node:assert/strict";
import {once} from "node:events";
import {readFile} from "node:fs/promises";
import test from "node:test";
import {createApp} from "../app.js";

const context = Object.freeze({
    accountId: "account-1",
    studyId: "study-1",
    participantId: 11,
    participantKey: "participant-a",
});
const secondContext = Object.freeze({
    accountId: "account-2",
    studyId: "study-1",
    participantId: 22,
    participantKey: "participant-b",
});
const thirdContext = Object.freeze({
    accountId: "account-3",
    studyId: "study-1",
    participantId: 33,
    participantKey: "participant-c",
});
const pendingCardId = "550e8400-e29b-41d4-a716-446655440000";
const firstCategoryId = "550e8400-e29b-41d4-a716-446655440001";
const secondCategoryId = "550e8400-e29b-41d4-a716-446655440002";
const thirdCategoryId = "550e8400-e29b-41d4-a716-446655440004";
const csrfToken = "t".repeat(43);
const cardSummary = ordinal => ({
    id: `550e8400-e29b-41d4-a716-${String(ordinal).padStart(12, "0")}`,
    ordinal,
    title: `Study card ${ordinal}`,
    html_url: `https://example.test/study/pr/${ordinal}`,
});
const defaultCategorySummary = Object.freeze([
    Object.freeze({id: firstCategoryId, raw_name: "Alpha", total: 2, cards: Object.freeze([cardSummary(0), cardSummary(5)])}),
    Object.freeze({id: secondCategoryId, raw_name: "Beta", total: 1, cards: Object.freeze([cardSummary(2)])}),
    Object.freeze({id: thirdCategoryId, raw_name: "Zero", total: 0, cards: Object.freeze([])}),
]);
const canonicalRouteModules = [
    "../routes/queue/index.js",
    "../routes/queue/[id]/index.js",
    "../routes/queue/[id]/classify/index.js",
    "../routes/queue/[id]/discard/index.js",
    "../routes/categories/index.js",
    "../routes/categories/[id]/index.js",
    "../routes/progress/index.js",
];

class StudyHttpPool {
    constructor({pending = pendingCardId, totalCards = 300, categorySummary = defaultCategorySummary} = {}) {
        this.pending = pending;
        this.totalCards = totalCards;
        this.categorySummary = categorySummary;
        this.queries = [];
    }

    pageRows(parameters) {
        const [studyId, participantId, limit, offset] = parameters;
        if (studyId !== context.studyId || participantId !== context.participantId) return [];
        const rows = [];
        for (let ordinal = offset; ordinal < Math.min(offset + limit, this.totalCards); ordinal += 1) {
            rows.push({...cardSummary(ordinal), status: "PENDING", own_category: null, discard_reason: null});
        }
        return rows;
    }

    async query(sql, parameters = []) {
        this.queries.push({sql, parameters});
        if (sql.includes("LIMIT $3 OFFSET $4")) {
            return {rows: this.pageRows(parameters)};
        }
        if (sql.includes("COUNT(*)::INTEGER AS total")) {
            return {rows: [ {total: parameters[0] === context.studyId ? this.totalCards : 0} ]};
        }
        if (sql.includes("FROM participant_category category")) {
            return {rows: parameters[0] === context.studyId && parameters[1] === context.participantId ? this.categorySummary : []};
        }
        if (sql.includes("SELECT study_card.pr_card_id AS id")) {
            return {rows: parameters[0] === context.studyId && parameters[1] === context.participantId && this.pending ? [ {id: this.pending} ] : []};
        }
        if (sql.includes("COUNT(study_card.pr_card_id)")) {
            return {rows: parameters[0] === context.studyId && parameters[1] === context.participantId
                ? [ {total: this.totalCards, classified: 2, discarded: 1, pending: this.totalCards - 3} ]
                : []};
        }
        if (sql.startsWith("INSERT INTO participant_category")) {
            return {rows: [ {id: "category-1", raw_name: parameters[2]} ]};
        }
        throw new Error(`Unexpected pool query: ${sql}`);
    }
}

class ClassificationIsolationPool {
    constructor() {
        this.categories = new Map([
            [firstCategoryId, {participantId: context.participantId, studyId: context.studyId}],
            [secondCategoryId, {participantId: secondContext.participantId, studyId: secondContext.studyId}],
            [thirdCategoryId, {participantId: thirdContext.participantId, studyId: thirdContext.studyId}],
            ["550e8400-e29b-41d4-a716-446655440003", {participantId: context.participantId, studyId: "study-2"}],
        ]);
        this.classifications = new Map();
    }

    async connect() {
        return {
            query: (sql, parameters = []) => this.query(sql, parameters),
            release: () => {},
        };
    }

    async query(sql, parameters = []) {
        if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) return {rows: []};
        if (sql.includes("FOR UPDATE OF study_card")) {
            return {rows: parameters[0] === context.studyId ? [{pr_card_id: parameters[1], ordinal: 0, promotion_run_id: null}] : []};
        }
        if (sql.includes("FROM participant_category")) {
            const [categoryId, studyId, participantId] = parameters;
            const category = this.categories.get(categoryId);
            return {rows: category?.studyId === studyId && category.participantId === participantId ? [{id: categoryId}] : []};
        }
        if (sql.includes("classification.id AS classification_id")) {
            const classification = this.classifications.get(`${parameters[0]}:${parameters[1]}:${parameters[2]}`);
            return {rows: [classification || {
                classification_id: null,
                revision: null,
                discard_card_id: null,
                discard_reason: null,
            }]};
        }
        if (sql.startsWith("INSERT INTO pr_classification")) {
            const [cardId, participantId, categoryId, remarks, studyId] = parameters;
            this.classifications.set(`${studyId}:${participantId}:${cardId}`, {
                classification_id: `${participantId}-classification`,
                cardId,
                participantId,
                categoryId,
                remarks,
                studyId,
                revision: 1,
                discard_card_id: null,
            });
            return {rows: [], rowCount: 1};
        }
        if (sql.includes("SELECT study_card.pr_card_id AS id")) return {rows: []};
        throw new Error(`Unexpected classification query: ${sql}`);
    }
}

const start = async ({pool, authenticated = true, sessionContext = context, onRender} = {}) => {
    const middleware = onRender
        ? [(_req, res, next) => {
            const render = res.render.bind(res);
            res.render = (view, locals, callback) => {
                onRender(view, locals);
                return render(view, locals, callback);
            };
            next();
        }]
        : [];
    const app = await createApp({
        pool,
        middleware,
        sessionMiddleware: (req, res, next) => {
            req.sessionContext = authenticated ? sessionContext : null;
            req.csrfToken = authenticated ? csrfToken : null;
            res.locals.sessionContext = req.sessionContext;
            res.locals.csrfToken = req.csrfToken;
            next();
        },
    });
    const server = app.listen(0);
    await once(server, "listening");
    return server;
};

const close = server => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));

test("canonical study routes delegate private operations to the study service", async () => {
    const sources = await Promise.all(canonicalRouteModules.map(routeModule => readFile(new URL(routeModule, import.meta.url), "utf8")));
    for (const source of sources) {
        assert.match(source, /createStudyService/);
        assert.doesNotMatch(source, /study-(?:mutation|read-repository|write-repository)|util\/category|withTransaction|\.query\(/);
    }
});

test("study routes reject unauthenticated requests and old participant routes are unregistered", async () => {
    const server = await start({pool: new StudyHttpPool(), authenticated: false});
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    try {
        assert.equal((await fetch(`${baseUrl}/queue`)).status, 401);
        assert.equal((await fetch(`${baseUrl}/progress`)).status, 401);
        assert.equal((await fetch(`${baseUrl}/participant-b/queue`)).status, 404);
        assert.equal((await fetch(`${baseUrl}/instances?participant=participant-b`)).status, 404);
    } finally {
        await close(server);
    }
});

test("canonical queue ignores supplied study and participant identifiers", async () => {
    const pool = new StudyHttpPool();
    const server = await start({pool});
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    try {
        const response = await fetch(`${baseUrl}/queue?participant=participant-b&study_id=study-2`, {redirect: "manual"});
        assert.equal(response.status, 303);
        assert.equal(response.headers.get("location"), `/queue/${pendingCardId}`);
        assert.deepEqual(pool.queries[0].parameters, [context.studyId, context.participantId]);
    } finally {
        await close(server);
    }
});

test("progress and category creation use session ownership despite supplied identifiers", async () => {
    const pool = new StudyHttpPool();
    const server = await start({pool});
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    try {
        const progress = await fetch(`${baseUrl}/progress?participant=participant-b&study_id=study-2`);
        const progressHtml = await progress.text();
        assert.equal(progress.status, 200);
        assert.match(progressHtml, /participant-a/);
        assert.doesNotMatch(progressHtml, /participant-b|study-2/);

        const category = await fetch(`${baseUrl}/categories`, {
            method: "POST",
            headers: {"content-type": "application/x-www-form-urlencoded", origin: "http://127.0.0.1", "x-csrf-token": csrfToken},
            body: "name=Private+category&participant_id=22&study_id=study-2",
        });
        assert.equal(category.status, 201);
        assert.deepEqual(pool.queries.at(-1).parameters, [context.studyId, context.participantId, "Private category", "private category"]);
    } finally {
        await close(server);
    }
});

test("progress applies default pagination and ignores client-supplied identity", async () => {
    const pool = new StudyHttpPool();
    const renders = [];
    const server = await start({pool, onRender: (_view, locals) => renders.push(locals)});
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    try {
        const response = await fetch(`${baseUrl}/progress?participant=participant-b&participant_id=22&study=study-2&study_id=study-2&reviewer_id=99`);
        const html = await response.text();
        assert.equal(response.status, 200);
        assert.equal(renders.length, 1);

        const {progressPage, categorySummary, participant} = renders[0];
        assert.equal(participant.name, "participant-a");
        assert.equal(progressPage.page, 1);
        assert.equal(progressPage.limit, 20);
        assert.equal(progressPage.total, 300);
        assert.equal(progressPage.totalPages, 15);
        assert.deepEqual(progressPage.rows.map(row => row.ordinal), Array.from({length: 20}, (_value, index) => index));
        assert.deepEqual(categorySummary.map(group => group.raw_name), ["Alpha", "Beta", "Zero"]);

        const pageQuery = pool.queries.find(({sql}) => sql.includes("LIMIT $3 OFFSET $4"));
        assert.deepEqual(pageQuery.parameters, [context.studyId, context.participantId, 20, 0]);
        for (const {parameters} of pool.queries) {
            assert.equal(parameters[0], context.studyId);
            assert.ok(!parameters.includes("study-2"), "hostile study must never reach a query");
            assert.ok(!parameters.includes(22), "hostile participant must never reach a query");
            assert.ok(!parameters.includes(99), "hostile reviewer must never reach a query");
        }

        assert.match(html, /participant-a/);
        assert.doesNotMatch(html, /participant-b|study-2/);
        assert.match(html, /\/progress\?page=2&limit=20/, "pagination links must carry the normalized default");
    } finally {
        await close(server);
    }
});

test("progress caps the limit and serves a valid out-of-range page as 200 with an empty list", async () => {
    const pool = new StudyHttpPool();
    const renders = [];
    const server = await start({pool, onRender: (_view, locals) => renders.push(locals)});
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    try {
        const capped = await fetch(`${baseUrl}/progress?page=2&limit=1000`);
        assert.equal(capped.status, 200);
        const cappedHtml = await capped.text();
        const cappedPage = renders.at(-1).progressPage;
        assert.equal(cappedPage.page, 2);
        assert.equal(cappedPage.limit, 100);
        assert.equal(cappedPage.totalPages, 3);
        assert.equal(cappedPage.rows[0].ordinal, 100);
        assert.equal(cappedPage.rows.length, 100);
        const cappedQuery = pool.queries.find(({sql}) => sql.includes("LIMIT $3 OFFSET $4"));
        assert.deepEqual(cappedQuery.parameters, [context.studyId, context.participantId, 100, 100]);
        assert.match(cappedHtml, /\/progress\?page=1&limit=100/, "previous link must use the capped limit");
        assert.match(cappedHtml, /\/progress\?page=3&limit=100/, "next link must use the capped limit");
        assert.doesNotMatch(cappedHtml, /limit=1000/, "the requested over-limit value must not leak into links");

        const beyond = await fetch(`${baseUrl}/progress?page=99&limit=20`);
        assert.equal(beyond.status, 200);
        const beyondHtml = await beyond.text();
        const beyondPage = renders.at(-1).progressPage;
        assert.equal(beyondPage.page, 99);
        assert.equal(beyondPage.limit, 20);
        assert.equal(beyondPage.total, 300);
        assert.deepEqual(beyondPage.rows, []);
        assert.match(beyondHtml, /data-progress-empty/, "an out-of-range page must render the accessible empty state");
        assert.match(beyondHtml, /\/progress\?page=98&limit=20/, "an out-of-range page must keep normalized navigation");
    } finally {
        await close(server);
    }
});

test("progress falls back to defaults for non-integer and non-positive pagination values", async () => {
    const pool = new StudyHttpPool();
    const renders = [];
    const server = await start({pool, onRender: (_view, locals) => renders.push(locals)});
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    try {
        for (const query of ["page=abc&limit=1.5", "page=0&limit=-5", "page=1e3&limit=Infinity", "page=&limit="]) {
            const response = await fetch(`${baseUrl}/progress?${query}`);
            assert.equal(response.status, 200);
            const {progressPage} = renders.at(-1);
            assert.equal(progressPage.page, 1, `page default expected for ?${query}`);
            assert.equal(progressPage.limit, 20, `limit default expected for ?${query}`);
        }
    } finally {
        await close(server);
    }
});

test("progress category summary stays complete and private across pages and out-of-range requests", async () => {
    const pool = new StudyHttpPool();
    const renders = [];
    const server = await start({pool, onRender: (_view, locals) => renders.push(locals)});
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    try {
        assert.equal((await fetch(`${baseUrl}/progress`)).status, 200);
        assert.equal((await fetch(`${baseUrl}/progress?page=2&limit=5`)).status, 200);
        assert.equal((await fetch(`${baseUrl}/progress?page=999&limit=20`)).status, 200);

        const [first, second, beyond] = renders;
        assert.deepEqual(first.categorySummary.map(group => group.raw_name), ["Alpha", "Beta", "Zero"]);
        assert.deepEqual(first.categorySummary.map(group => group.total), [2, 1, 0]);
        assert.deepEqual(first.categorySummary.find(group => group.raw_name === "Alpha").cards.map(card => card.ordinal), [0, 5]);
        assert.deepEqual(first.categorySummary.find(group => group.raw_name === "Zero").cards, []);
        assert.deepEqual(second.categorySummary, first.categorySummary);
        assert.deepEqual(beyond.categorySummary, first.categorySummary);
        assert.deepEqual(beyond.progressPage.rows, []);
        assert.ok(second.progressPage.rows.length < first.progressPage.rows.length, "the paginated list changes while the summary does not");

        const summaryQueries = pool.queries.filter(({sql}) => sql.includes("FROM participant_category category"));
        assert.equal(summaryQueries.length, 3);
        for (const {parameters} of summaryQueries) {
            assert.deepEqual(parameters, [context.studyId, context.participantId]);
        }
    } finally {
        await close(server);
    }
});

test("empty canonical queue renders completion with the authenticated participant controls", async () => {
    const pool = new StudyHttpPool({pending: null});
    const server = await start({pool});
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    try {
        const response = await fetch(`${baseUrl}/queue?participant=participant-b`);
        const html = await response.text();
        assert.equal(response.status, 200);
        assert.match(html, /Classification queue complete/);
        assert.match(html, /participant-a/);
        assert.match(html, /<form class="ms-lg-3 py-2" action=\/logout method=post>/);
        assert.match(html, /<button class="btn btn-outline-secondary" type=submit>Log out<\/button>/);
        assert.doesNotMatch(html, /participant-b/);
    } finally {
        await close(server);
    }
});

test("the same card can be classified independently by three participant sessions", async () => {
    const pool = new ClassificationIsolationPool();
    const firstServer = await start({pool, sessionContext: context});
    const secondServer = await start({pool, sessionContext: secondContext});
    const thirdServer = await start({pool, sessionContext: thirdContext});
    const classify = (server, categoryId) => fetch(
        `http://127.0.0.1:${server.address().port}/queue/${pendingCardId}/classify`,
        {
            method: "POST",
            redirect: "manual",
            headers: {
                "content-type": "application/x-www-form-urlencoded",
                origin: "http://127.0.0.1",
                "x-csrf-token": csrfToken,
            },
            body: `category_id=${categoryId}&expected_revision=0&participant_id=999&study_id=study-2`,
        },
    );
    try {
        const [firstResponse, secondResponse, thirdResponse] = await Promise.all([
            classify(firstServer, firstCategoryId),
            classify(secondServer, secondCategoryId),
            classify(thirdServer, thirdCategoryId),
        ]);

        assert.equal(firstResponse.status, 303);
        assert.equal(secondResponse.status, 303);
        assert.equal(thirdResponse.status, 303);
        assert.deepEqual(
            [...pool.classifications.values()].map(({cardId, participantId, categoryId, studyId}) => ({
                cardId,
                participantId,
                categoryId,
                studyId,
            })).sort((left, right) => left.participantId - right.participantId),
            [
                {cardId: pendingCardId, participantId: context.participantId, categoryId: firstCategoryId, studyId: context.studyId},
                {cardId: pendingCardId, participantId: secondContext.participantId, categoryId: secondCategoryId, studyId: secondContext.studyId},
                {cardId: pendingCardId, participantId: thirdContext.participantId, categoryId: thirdCategoryId, studyId: thirdContext.studyId},
            ],
        );
    } finally {
        await Promise.all([close(firstServer), close(secondServer), close(thirdServer)]);
    }
});

test("classification rejects a category from another study for the same participant", async () => {
    const pool = new ClassificationIsolationPool();
    const server = await start({pool});
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    try {
        const response = await fetch(`${baseUrl}/queue/${pendingCardId}/classify`, {
            method: "POST",
            redirect: "manual",
            headers: {
                "content-type": "application/x-www-form-urlencoded",
                origin: "http://127.0.0.1",
                "x-csrf-token": csrfToken,
            },
            body: "category_id=550e8400-e29b-41d4-a716-446655440003&expected_revision=0&participant_id=999&study_id=study-2",
        });

        assert.equal(response.status, 404);
        assert.equal(pool.classifications.size, 0);
    } finally {
        await close(server);
    }
});
