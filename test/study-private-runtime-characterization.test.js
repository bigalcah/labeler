import assert from "node:assert/strict";
import {once} from "node:events";
import test from "node:test";
import {createApp} from "../app.js";

const studyId = "study-1";
const csrfToken = "t".repeat(43);
const cardId = ordinal => `550e8400-e29b-41d4-a716-${ordinal.toString(16).padStart(12, "0")}`;
const makeCards = cardCount => Array.from({length: cardCount}, (_value, ordinal) => ({id: cardId(ordinal), ordinal}));
const cards = makeCards(300);
const contexts = Object.freeze({
    "study-session=participant-a": Object.freeze({accountId: "account-a", studyId, participantId: 11, participantKey: "participant-a"}),
    "study-session=participant-b": Object.freeze({accountId: "account-b", studyId, participantId: 22, participantKey: "participant-b"}),
    "study-session=participant-c": Object.freeze({accountId: "account-c", studyId, participantId: 33, participantKey: "participant-c"}),
});
const categories = Object.freeze([
    {id: "550e8400-e29b-41d4-a716-000000000301", participantId: 11, rawName: "Shared label", definition: "Participant A definition", colorSlot: 0},
    {id: "550e8400-e29b-41d4-a716-000000000302", participantId: 22, rawName: "Shared label", definition: null, colorSlot: 1},
    {id: "550e8400-e29b-41d4-a716-000000000303", participantId: 33, rawName: "Shared label", definition: "Participant C definition", colorSlot: 2},
]);

class PrivateStudyPool {
    constructor(cardCount = 300) {
        this.cards = makeCards(cardCount);
        this.categories = new Map(categories.map(category => [category.id, {...category, studyId}]));
        this.classifications = new Map();
        this.discards = new Map();
        this.progressParameters = [];
        this.pageParameters = [];
        this.categorySummaryParameters = [];
        this.categoryParameters = [];
        this.transactionEvents = [];
        this.releaseCount = 0;
    }

    async connect() {
        const staged = {categories: new Map(), classifications: new Map(), discards: new Map()};
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
        const ordered = [...this.cards.filter(card => card.ordinal > ordinal), ...this.cards.filter(card => card.ordinal <= ordinal)];
        return ordered.find(card => {
            const decision = this.decision(participantId, card.id, staged);
            return !decision.classification && !decision.discard;
        }) || null;
    }

    progress(participantId) {
        const classifications = [...this.classifications.values()].filter(classification => classification.participantId === participantId).length;
        const discards = [...this.discards.values()].filter(discard => discard.participantId === participantId).length;
        return {total: this.cards.length, classified: classifications, discarded: discards, pending: this.cards.length - classifications - discards};
    }

    cardRows(participantId, requestedStudyId, {limit, offset}, staged) {
        if (requestedStudyId !== studyId) return [];
        return this.cards
            .filter(card => card.ordinal >= offset && card.ordinal < offset + limit)
            .map(card => {
                const decision = this.decision(participantId, card.id, staged);
                return {
                    id: card.id,
                    ordinal: card.ordinal,
                    title: `Card ${card.ordinal}`,
                    html_url: `https://example.test/pr/${card.ordinal}`,
                    status: decision.classification ? "CLASSIFIED" : decision.discard ? "DISCARDED" : "PENDING",
                    own_category: decision.classification
                        ? this.categories.get(decision.classification.categoryId)?.rawName ?? null
                        : null,
                    own_category_definition: decision.classification
                        ? this.categories.get(decision.classification.categoryId)?.definition ?? null
                        : null,
                    own_category_color_slot: decision.classification
                        ? this.categories.get(decision.classification.categoryId)?.colorSlot ?? null
                        : null,
                    discard_reason: decision.discard?.reason ?? null,
                };
            });
    }

    categoryGroups(participantId, requestedStudyId) {
        if (requestedStudyId !== studyId) return [];
        const classifiedByCategory = new Map();
        for (const card of this.cards) {
            const classification = this.classifications.get(`${participantId}:${card.id}`);
            if (!classification) continue;
            const grouped = classifiedByCategory.get(classification.categoryId) || [];
            grouped.push({id: card.id, ordinal: card.ordinal, title: `Card ${card.ordinal}`, html_url: `https://example.test/pr/${card.ordinal}`});
            classifiedByCategory.set(classification.categoryId, grouped);
        }
        return [...this.categories.values()]
            .filter(category => category.participantId === participantId)
            .sort((left, right) => left.rawName.localeCompare(right.rawName))
            .map(category => {
                const grouped = classifiedByCategory.get(category.id) || [];
                return {
                    id: category.id,
                    raw_name: category.rawName,
                    definition: category.definition,
                    color_slot: category.colorSlot,
                    total: grouped.length,
                    cards: grouped,
                };
            });
    }

    async query(sql, parameters = [], staged = null) {
        if (sql === "BEGIN") {
            this.transactionEvents.push("BEGIN");
            return {rows: []};
        }
        if (sql === "COMMIT") {
            staged.categories.forEach((category, id) => this.categories.set(id, category));
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
            const card = requestedStudyId === studyId ? this.cards.find(candidate => candidate.id === requestedCardId) : null;
            return {rows: card ? [{pr_card_id: card.id, ordinal: card.ordinal, promotion_run_id: null}] : []};
        }
        if (sql.includes("FROM participant_category") && sql.includes("WHERE id = $1")) {
            const [categoryId, requestedStudyId, participantId] = parameters;
            if (sql.startsWith("SELECT id FROM participant_category")) this.categoryParameters.push(parameters);
            const category = staged?.categories.get(categoryId) || this.categories.get(categoryId);
            const ownsCategory = category?.studyId === requestedStudyId && category.participantId === participantId;
            if (!ownsCategory) return {rows: []};
            return {rows: [sql.includes("FOR UPDATE")
                ? {id: category.id, definition: category.definition, updated_at: category.updatedAt}
                : {id: category.id}]};
        }
        if (sql.startsWith("UPDATE participant_category")) {
            const [categoryId, requestedStudyId, participantId, rawName, normalizedName, _expectedUpdatedAt, definition] = parameters;
            const category = staged?.categories.get(categoryId) || this.categories.get(categoryId);
            if (category?.studyId !== requestedStudyId || category.participantId !== participantId) return {rows: []};
            const updated = {
                ...category,
                rawName,
                normalizedName,
                definition,
                updatedAt: "2026-01-02T00:00:00.000Z",
            };
            staged.categories.set(categoryId, updated);
            return {rows: [{
                id: updated.id,
                raw_name: updated.rawName,
                definition: updated.definition,
                color_slot: updated.colorSlot,
                updated_at: updated.updatedAt,
            }]};
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
            const [currentCardId, participantId, categoryId, remarks, requestedStudyId] = parameters;
            staged.classifications.set(`${participantId}:${currentCardId}`, {
                id: `classification-${participantId}-${currentCardId}`,
                cardId: currentCardId,
                participantId,
                categoryId,
                remarks,
                studyId: requestedStudyId,
                revision: 1,
            });
            return {rows: [], rowCount: 1};
        }
        if (sql.startsWith("UPDATE pr_classification")) {
            const [currentCardId, participantId, categoryId, remarks, expectedRevision, requestedStudyId] = parameters;
            const key = `${participantId}:${currentCardId}`;
            const classification = staged.classifications.get(key) || this.classifications.get(key);
            if (!classification || classification.studyId !== requestedStudyId || classification.revision !== expectedRevision) {
                return {rows: [], rowCount: 0};
            }
            staged.classifications.set(key, {
                ...classification,
                categoryId,
                remarks,
                revision: classification.revision + 1,
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
        if (sql.includes("COUNT(*)::INTEGER AS total")) {
            const [requestedStudyId] = parameters;
            return {rows: [{total: requestedStudyId === studyId ? this.cards.length : 0}]};
        }
        if (sql.includes("LIMIT $3 OFFSET $4")) {
            const [requestedStudyId, participantId, limit, offset] = parameters;
            this.pageParameters.push(parameters);
            return {rows: this.cardRows(participantId, requestedStudyId, {limit, offset}, staged)};
        }
        if (sql.includes("jsonb_agg")) {
            const [requestedStudyId, participantId] = parameters;
            this.categorySummaryParameters.push(parameters);
            return {rows: this.categoryGroups(participantId, requestedStudyId)};
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

test("private study mutations keep three session participants isolated across 30/300/369 cards", async t => {
    for (const cardCount of [30, 300, 369]) {
        await t.test(`${cardCount} assigned cards without reserves`, async () => {
            const pool = new PrivateStudyPool(cardCount);
            const studyCards = pool.cards;
            const firstCard = studyCards[0];
            const lastCard = studyCards.at(-1);
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
                const classified = await mutation(baseUrl, "study-session=participant-a", `/queue/${lastCard.id}/classify`, {
                    category_id: categories[0].id,
                    expected_revision: 0,
                    participant_id: 22,
                    study_id: "other-study",
                });
                const discarded = await mutation(baseUrl, "study-session=participant-b", `/queue/${firstCard.id}/discard`, {
                    reason: "not applicable",
                    expected_revision: 0,
                    participant_id: 11,
                    study_id: "other-study",
                });
                const thirdClassification = await mutation(baseUrl, "study-session=participant-c", `/queue/${firstCard.id}/classify`, {
                    category_id: categories[2].id,
                    expected_revision: 0,
                });
                const editedClassification = await mutation(baseUrl, "study-session=participant-a", `/queue/${lastCard.id}/classify`, {
                    category_id: categories[0].id,
                    expected_revision: 1,
                    remarks: "updated private note",
                });

                assert.equal(studyCards.length, cardCount);
                assert.equal(lastCard.ordinal, cardCount - 1);
                assert.equal(classified.status, 303);
                assert.equal(classified.headers.get("location"), `/queue/${firstCard.id}`);
                assert.equal(discarded.status, 303);
                assert.equal(discarded.headers.get("location"), `/queue/${studyCards[1].id}`);
                assert.equal(thirdClassification.status, 303);
                assert.equal(thirdClassification.headers.get("location"), `/queue/${studyCards[1].id}`);
                assert.equal(editedClassification.status, 303);
                assert.equal(editedClassification.headers.get("location"), `/queue/${firstCard.id}`);
                assert.equal(pool.classifications.size, 2);
                assert.deepEqual([...pool.classifications.values()].map(({participantId, categoryId, remarks, revision, studyId: storedStudyId}) => ({
                    participantId,
                    categoryId,
                    remarks,
                    revision,
                    studyId: storedStudyId,
                })), [
                    {participantId: 11, categoryId: categories[0].id, remarks: "updated private note", revision: 2, studyId},
                    {participantId: 33, categoryId: categories[2].id, remarks: null, revision: 1, studyId},
                ]);
                assert.deepEqual([...pool.discards.values()], [{cardId: firstCard.id, participantId: 22, reason: "not applicable", studyId}]);
                assert.deepEqual(pool.categoryParameters, [
                    [categories[0].id, studyId, 11],
                    [categories[2].id, studyId, 33],
                    [categories[0].id, studyId, 11],
                ]);

                const editedCategoryResponse = await request(baseUrl, "study-session=participant-a", `/categories/${categories[0].id}`, {
                    method: "PATCH",
                    headers: {"content-type": "application/json"},
                    body: JSON.stringify({name: "Renamed A category", definition: "Private A definition edited"}),
                });
                assert.equal(editedCategoryResponse.status, 200);
                assert.deepEqual(
                    (({raw_name, definition}) => ({raw_name, definition}))(await editedCategoryResponse.json()),
                    {raw_name: "Renamed A category", definition: "Private A definition edited"},
                );
                const crossParticipantEdit = await request(baseUrl, "study-session=participant-b", `/categories/${categories[0].id}`, {
                    method: "PATCH",
                    headers: {"content-type": "application/json"},
                    body: JSON.stringify({name: "B cannot rename A", definition: "B cannot change A's definition"}),
                });
                assert.equal(crossParticipantEdit.status, 404);
                assert.equal(await crossParticipantEdit.text(), "");

                for (const [session, participantId, expectedProgress, expectedCategoryId, ownDefinition, otherDefinitions] of [
                    ["study-session=participant-a", 11, {total: cardCount, classified: 1, discarded: 0, pending: cardCount - 1}, categories[0].id, "Private A definition edited", ["Participant B definition", "Participant C definition"]],
                    ["study-session=participant-b", 22, {total: cardCount, classified: 0, discarded: 1, pending: cardCount - 1}, categories[1].id, null, ["Private A definition edited", "Participant C definition"]],
                    ["study-session=participant-c", 33, {total: cardCount, classified: 1, discarded: 0, pending: cardCount - 1}, categories[2].id, "Participant C definition", ["Private A definition edited", "Participant B definition"]],
                ]) {
                    const response = await request(baseUrl, session, "/progress?participant_id=999&study_id=other-study");
                    assert.equal(response.status, 200);
                    assert.deepEqual(pool.progress(participantId), expectedProgress);
                    const body = await response.text();
                    assert.match(body, new RegExp(contexts[session].participantKey));
                    assert.match(body, new RegExp(expectedCategoryId));
                    assert.match(body, new RegExp(`${expectedProgress.classified + expectedProgress.discarded} of ${cardCount} cards completed`));
                    if (ownDefinition) assert.match(body, new RegExp(ownDefinition));
                    for (const otherDefinition of otherDefinitions) assert.doesNotMatch(body, new RegExp(otherDefinition));
                    assert.equal(body.includes("Discarded: not applicable"), participantId === 22);

                    const lastPage = Math.ceil(cardCount / 20);
                    const lastPageResponse = await request(baseUrl, session, `/progress?page=${lastPage}&limit=20`);
                    const lastPageBody = await lastPageResponse.text();
                    for (const card of studyCards.slice(Math.floor((cardCount - 1) / 20) * 20)) {
                        assert.match(lastPageBody, new RegExp(`data-card-id=${card.id}`));
                    }
                    assert.match(lastPageBody, new RegExp(`data-progress-total=true>${cardCount} assigned cards`));
                }

                assert.deepEqual(pool.progressParameters, [
                    [studyId, 11], [studyId, 11], [studyId, 22], [studyId, 22], [studyId, 33], [studyId, 33],
                ]);
                assert.equal(pool.pageParameters.length, 6);
                assert.deepEqual(pool.pageParameters.map(parameters => parameters.slice(0, 2)), [
                    [studyId, 11], [studyId, 11], [studyId, 22], [studyId, 22], [studyId, 33], [studyId, 33],
                ]);
                assert.deepEqual(pool.categorySummaryParameters, [
                    [studyId, 11], [studyId, 11], [studyId, 22], [studyId, 22], [studyId, 33], [studyId, 33],
                ]);
                assert.equal(pool.classifications.size, 2);
                assert.equal(pool.discards.size, 1);
                assert.deepEqual(pool.transactionEvents, [
                    "BEGIN", "COMMIT", "BEGIN", "COMMIT", "BEGIN", "COMMIT", "BEGIN", "COMMIT",
                    "BEGIN", "COMMIT", "BEGIN", "ROLLBACK",
                ]);
                assert.equal(pool.releaseCount, 6);
                assert.deepEqual(githubRequests, []);
            } finally {
                globalThis.fetch = originalFetch;
                await close(server);
            }
        });
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
