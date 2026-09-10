import assert from "node:assert/strict";
import {once} from "node:events";
import test from "node:test";
import {createApp} from "../app.js";

const studyId = "study-1";
const csrfToken = "t".repeat(43);
const cardId = ordinal => `550e8400-e29b-41d4-a716-${ordinal.toString(16).padStart(12, "0")}`;
const cards = Array.from({length: 300}, (_value, ordinal) => ({id: cardId(ordinal), ordinal}));
const contexts = Object.freeze({
    "study-session=participant-a": Object.freeze({accountId: "account-a", studyId, participantId: 11, participantKey: "participant-a"}),
    "study-session=participant-b": Object.freeze({accountId: "account-b", studyId, participantId: 22, participantKey: "participant-b"}),
    "study-session=participant-c": Object.freeze({accountId: "account-c", studyId, participantId: 33, participantKey: "participant-c"}),
});
const categories = Object.freeze([
    {id: "550e8400-e29b-41d4-a716-000000000301", participantId: 11, rawName: "Shared label"},
    {id: "550e8400-e29b-41d4-a716-000000000302", participantId: 22, rawName: "Shared label"},
    {id: "550e8400-e29b-41d4-a716-000000000303", participantId: 33, rawName: "Shared label"},
]);

class PrivateStudyPool {
    constructor() {
        this.categories = new Map(categories.map(category => [category.id, {...category, studyId}]));
        this.classifications = new Map();
        this.discards = new Map();
        this.progressParameters = [];
        this.categoryParameters = [];
        this.transactionEvents = [];
        this.releaseCount = 0;
    }

    async connect() {
        const staged = {classifications: new Map(), discards: new Map()};
        return {
            query: (sql, parameters = []) => this.query(sql, parameters, staged),
            release: () => { this.releaseCount += 1; },
        };
    }

    decision(participantId, currentCardId, staged) {
        const key = `${participantId}:${currentCardId}`;
        return {
            classification: staged?.classifications.get(key) || this.classifications.get(key) || null,
            discard: staged?.discards.get(key) || this.discards.get(key) || null,
        };
    }

    nextPending(participantId, ordinal, staged) {
        const ordered = [...cards.filter(card => card.ordinal > ordinal), ...cards.filter(card => card.ordinal <= ordinal)];
        return ordered.find(card => {
            const decision = this.decision(participantId, card.id, staged);
            return !decision.classification && !decision.discard;
        }) || null;
    }

    progress(participantId) {
        const classifications = [...this.classifications.values()].filter(classification => classification.participantId === participantId).length;
        const discards = [...this.discards.values()].filter(discard => discard.participantId === participantId).length;
        return {total: cards.length, classified: classifications, discarded: discards, pending: cards.length - classifications - discards};
    }

    async query(sql, parameters = [], staged = null) {
        if (sql === "BEGIN") {
            this.transactionEvents.push("BEGIN");
            return {rows: []};
        }
        if (sql === "COMMIT") {
            staged.classifications.forEach((classification, key) => this.classifications.set(key, classification));
            staged.discards.forEach((discard, key) => this.discards.set(key, discard));
            this.transactionEvents.push("COMMIT");
            return {rows: []};
        }
        if (sql === "ROLLBACK") {
            this.transactionEvents.push("ROLLBACK");
            return {rows: []};
        }
        if (sql.includes("FOR UPDATE OF study_card")) {
            const [requestedStudyId, requestedCardId] = parameters;
            const card = requestedStudyId === studyId ? cards.find(candidate => candidate.id === requestedCardId) : null;
            return {rows: card ? [{pr_card_id: card.id, ordinal: card.ordinal, promotion_run_id: null}] : []};
        }
        if (sql.includes("FROM participant_category") && sql.includes("WHERE id = $1")) {
            const [categoryId, requestedStudyId, participantId] = parameters;
            this.categoryParameters.push(parameters);
            const category = this.categories.get(categoryId);
            return {rows: category?.studyId === requestedStudyId && category.participantId === participantId ? [{id: category.id}] : []};
        }
        if (sql.includes("classification.id AS classification_id")) {
            const [requestedStudyId, participantId, requestedCardId] = parameters;
            const decision = requestedStudyId === studyId ? this.decision(participantId, requestedCardId, staged) : {};
            return {rows: [{
                classification_id: decision.classification?.id || null,
                revision: decision.classification?.revision || null,
                discard_card_id: decision.discard?.cardId || null,
                discard_reason: decision.discard?.reason || null,
            }]};
        }
        if (sql.startsWith("INSERT INTO pr_classification")) {
            const [currentCardId, participantId, categoryId, _remarks, requestedStudyId] = parameters;
            staged.classifications.set(`${participantId}:${currentCardId}`, {
                id: `classification-${participantId}-${currentCardId}`,
                participantId,
                categoryId,
                studyId: requestedStudyId,
                revision: 1,
            });
            return {rows: [], rowCount: 1};
        }
        if (sql.startsWith("INSERT INTO pr_discard")) {
            const [currentCardId, participantId, reason, requestedStudyId] = parameters;
            staged.discards.set(`${participantId}:${currentCardId}`, {cardId: currentCardId, participantId, reason, studyId: requestedStudyId});
            return {rows: [], rowCount: 1};
        }
        if (sql.includes("ORDER BY CASE WHEN study_card.ordinal > $3")) {
            const [requestedStudyId, participantId, ordinal] = parameters;
            const next = requestedStudyId === studyId ? this.nextPending(participantId, ordinal, staged) : null;
            return {rows: next ? [{id: next.id}] : []};
        }
        if (sql.includes("COUNT(study_card.pr_card_id)")) {
            const [requestedStudyId, participantId] = parameters;
            this.progressParameters.push(parameters);
            return {rows: [requestedStudyId === studyId ? this.progress(participantId) : {total: 0, classified: 0, discarded: 0, pending: 0}]};
        }
        throw new Error(`Unexpected query: ${sql}`);
    }
}

const start = async pool => {
    const app = await createApp({
        pool,
        sessionMiddleware: (req, res, next) => {
            const context = contexts[req.headers.cookie] || null;
            req.sessionContext = context;
            req.csrfToken = context ? csrfToken : null;
            res.locals.sessionContext = context;
            res.locals.csrfToken = req.csrfToken;
            next();
        },
    });
    const server = app.listen(0);
    await once(server, "listening");
    return server;
};

const close = server => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
const request = (baseUrl, session, path, options = {}) => fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {cookie: session, origin: "http://127.0.0.1", "x-csrf-token": csrfToken, ...options.headers},
});
const mutation = (baseUrl, session, path, body) => request(baseUrl, session, path, {
    method: "POST",
    redirect: "manual",
    headers: {"content-type": "application/json"},
    body: JSON.stringify(body),
});

test("private study mutations keep three session participants isolated across 300 cards", async () => {
    const pool = new PrivateStudyPool();
    const server = await start(pool);
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const originalFetch = globalThis.fetch;
    const githubRequests = [];
    globalThis.fetch = async (input, init) => {
        const url = new URL(typeof input === "string" ? input : input.url);
        if (url.hostname === "api.github.com" || url.hostname.endsWith(".github.com")) {
            githubRequests.push(url.toString());
            throw new Error("Interactive classification must not call GitHub");
        }
        return originalFetch(input, init);
    };
    try {
        const classified = await mutation(baseUrl, "study-session=participant-a", `/queue/${cards[299].id}/classify`, {
            category_id: categories[0].id,
            expected_revision: 0,
            participant_id: 22,
            study_id: "other-study",
        });
        const discarded = await mutation(baseUrl, "study-session=participant-b", `/queue/${cards[0].id}/discard`, {
            reason: "not applicable",
            expected_revision: 0,
            participant_id: 11,
            study_id: "other-study",
        });
        const thirdClassification = await mutation(baseUrl, "study-session=participant-c", `/queue/${cards[0].id}/classify`, {
            category_id: categories[2].id,
            expected_revision: 0,
        });

        assert.equal(classified.status, 303);
        assert.equal(classified.headers.get("location"), `/queue/${cards[0].id}`);
        assert.equal(discarded.status, 303);
        assert.equal(discarded.headers.get("location"), `/queue/${cards[1].id}`);
        assert.equal(thirdClassification.status, 303);
        assert.equal(thirdClassification.headers.get("location"), `/queue/${cards[1].id}`);
        assert.equal(pool.classifications.size, 2);
        assert.deepEqual([...pool.classifications.values()].map(({participantId, categoryId, studyId: storedStudyId}) => ({participantId, categoryId, studyId: storedStudyId})), [
            {participantId: 11, categoryId: categories[0].id, studyId},
            {participantId: 33, categoryId: categories[2].id, studyId},
        ]);
        assert.deepEqual([...pool.discards.values()], [{cardId: cards[0].id, participantId: 22, reason: "not applicable", studyId}]);
        assert.deepEqual(pool.categoryParameters, [
            [categories[0].id, studyId, 11],
            [categories[2].id, studyId, 33],
        ]);
        assert.deepEqual(pool.transactionEvents, ["BEGIN", "COMMIT", "BEGIN", "COMMIT", "BEGIN", "COMMIT"]);
        assert.equal(pool.releaseCount, 3);

        for (const [session, participantId, expectedProgress] of [
            ["study-session=participant-a", 11, {total: 300, classified: 1, discarded: 0, pending: 299}],
            ["study-session=participant-b", 22, {total: 300, classified: 0, discarded: 1, pending: 299}],
            ["study-session=participant-c", 33, {total: 300, classified: 1, discarded: 0, pending: 299}],
        ]) {
            const response = await request(baseUrl, session, "/progress?participant_id=999&study_id=other-study");
            assert.equal(response.status, 200);
            assert.deepEqual(pool.progress(participantId), expectedProgress);
        }
        assert.deepEqual(pool.progressParameters, [[studyId, 11], [studyId, 22], [studyId, 33]]);
        assert.deepEqual(githubRequests, []);
    } finally {
        globalThis.fetch = originalFetch;
        await close(server);
    }
});

test("failed cross-participant classification rolls back without creating a private response", async () => {
    const pool = new PrivateStudyPool();
    const server = await start(pool);
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    try {
        const response = await mutation(baseUrl, "study-session=participant-a", `/queue/${cards[0].id}/classify`, {
            category_id: categories[1].id,
            expected_revision: 0,
            participant_id: 22,
            study_id: "other-study",
        });

        assert.equal(response.status, 404);
        assert.equal(pool.classifications.size, 0);
        assert.equal(pool.discards.size, 0);
        assert.deepEqual(pool.categoryParameters, [[categories[1].id, studyId, 11]]);
        assert.deepEqual(pool.transactionEvents, ["BEGIN", "ROLLBACK"]);
        assert.equal(pool.releaseCount, 1);
    } finally {
        await close(server);
    }
});
