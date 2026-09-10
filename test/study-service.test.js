import assert from "node:assert/strict";
import test from "node:test";
import {createStudyService} from "../util/study-service.js";

const studyId = "study-1";
const cardId = ordinal => `550e8400-e29b-41d4-a716-${ordinal.toString(16).padStart(12, "0")}`;
const cards = Array.from({length: 300}, (_value, ordinal) => ({
    id: cardId(ordinal),
    ordinal,
    title: `Card ${ordinal}`,
    body: null,
    author: null,
    language: null,
    state: "OPEN",
    merged: false,
    html_url: null,
    created_at_source: null,
    closed_at_source: null,
    merged_at_source: null,
    summary: {},
    evidence: {},
    raw_payload: {},
}));
const contexts = Object.freeze([
    Object.freeze({accountId: "account-a", studyId, participantId: 11, participantKey: "participant-a"}),
    Object.freeze({accountId: "account-b", studyId, participantId: 22, participantKey: "participant-b"}),
    Object.freeze({accountId: "account-c", studyId, participantId: 33, participantKey: "participant-c"}),
]);
const categoryIds = Object.freeze({
    first: "550e8400-e29b-41d4-a716-000000000301",
    replacement: "550e8400-e29b-41d4-a716-000000000302",
    second: "550e8400-e29b-41d4-a716-000000000303",
    third: "550e8400-e29b-41d4-a716-000000000304",
});

class StudyServicePool {
    constructor() {
        this.categories = new Map([
            [categoryIds.first, {id: categoryIds.first, studyId, participantId: 11, raw_name: "Shared label", normalized_name: "shared label", updated_at: "2026-01-01T00:00:00.000Z"}],
            [categoryIds.replacement, {id: categoryIds.replacement, studyId, participantId: 11, raw_name: "Replacement", normalized_name: "replacement", updated_at: "2026-01-01T00:00:00.000Z"}],
            [categoryIds.second, {id: categoryIds.second, studyId, participantId: 22, raw_name: "Shared label", normalized_name: "shared label", updated_at: "2026-01-01T00:00:00.000Z"}],
            [categoryIds.third, {id: categoryIds.third, studyId, participantId: 33, raw_name: "Shared label", normalized_name: "shared label", updated_at: "2026-01-01T00:00:00.000Z"}],
        ]);
        this.classifications = new Map();
        this.discards = new Map();
        this.transactionEvents = [];
        this.categoryParameters = [];
    }

    async connect() {
        const staged = {classifications: new Map(), discards: new Map()};
        return {
            query: (sql, parameters = []) => this.query(sql, parameters, staged),
            release: () => {},
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
        const classified = [...this.classifications.values()].filter(value => value.participantId === participantId).length;
        const discarded = [...this.discards.values()].filter(value => value.participantId === participantId).length;
        return {total: cards.length, classified, discarded, pending: cards.length - classified - discarded};
    }

    async query(sql, parameters = [], staged = null) {
        if (sql === "BEGIN") {
            this.transactionEvents.push("BEGIN");
            return {rows: []};
        }
        if (sql === "COMMIT") {
            staged.classifications.forEach((value, key) => this.classifications.set(key, value));
            staged.discards.forEach((value, key) => this.discards.set(key, value));
            this.transactionEvents.push("COMMIT");
            return {rows: []};
        }
        if (sql === "ROLLBACK") {
            this.transactionEvents.push("ROLLBACK");
            return {rows: []};
        }
        if (sql.includes("FOR UPDATE OF study_card")) {
            const [requestedStudyId, requestedCardId] = parameters;
            const card = requestedStudyId === studyId ? cards.find(value => value.id === requestedCardId) : null;
            return {rows: card ? [{pr_card_id: card.id, ordinal: card.ordinal, promotion_run_id: null}] : []};
        }
        if (sql.includes("SELECT id, updated_at") && sql.includes("FOR UPDATE")) {
            const [categoryId, requestedStudyId, participantId] = parameters;
            const category = this.categories.get(categoryId);
            return {rows: category?.studyId === requestedStudyId && category.participantId === participantId
                ? [{id: category.id, updated_at: category.updated_at}] : []};
        }
        if (sql.includes("FROM participant_category") && sql.includes("WHERE id = $1")) {
            const [categoryId, requestedStudyId, participantId] = parameters;
            this.categoryParameters.push(parameters);
            const category = this.categories.get(categoryId);
            return {rows: category?.studyId === requestedStudyId && category.participantId === participantId ? [{id: category.id}] : []};
        }
        if (sql.startsWith("UPDATE participant_category")) {
            const [categoryId, requestedStudyId, participantId, rawName, normalizedName, expectedUpdatedAt] = parameters;
            const category = this.categories.get(categoryId);
            if (!category || category.studyId !== requestedStudyId || category.participantId !== participantId
                || (expectedUpdatedAt !== null && category.updated_at !== expectedUpdatedAt)) return {rows: []};
            category.raw_name = rawName;
            category.normalized_name = normalizedName;
            category.updated_at = "2026-01-01T00:00:01.000Z";
            return {rows: [{id: category.id, raw_name: category.raw_name, updated_at: category.updated_at}]};
        }
        if (sql.startsWith("INSERT INTO participant_category")) {
            const [requestedStudyId, participantId, rawName, normalizedName] = parameters;
            const id = "550e8400-e29b-41d4-a716-000000000399";
            const category = {id, studyId: requestedStudyId, participantId, raw_name: rawName, normalized_name: normalizedName, updated_at: "2026-01-01T00:00:00.000Z"};
            this.categories.set(id, category);
            return {rows: [{id, raw_name: rawName, updated_at: category.updated_at}]};
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
        if (sql.startsWith("UPDATE pr_classification")) {
            const [currentCardId, participantId, categoryId, _remarks, expectedRevision, requestedStudyId] = parameters;
            const current = this.decision(participantId, currentCardId, staged).classification;
            if (!current || current.revision !== expectedRevision || requestedStudyId !== studyId) return {rows: [], rowCount: 0};
            staged.classifications.set(`${participantId}:${currentCardId}`, {...current, categoryId, revision: current.revision + 1});
            return {rows: [], rowCount: 1};
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
        if (sql.includes("ORDER BY study_card.ordinal")) {
            const [requestedStudyId, participantId] = parameters;
            const next = requestedStudyId === studyId ? this.nextPending(participantId, -1, staged) : null;
            return {rows: next ? [{id: next.id}] : []};
        }
        if (sql.includes("COUNT(study_card.pr_card_id")) {
            const [requestedStudyId, participantId] = parameters;
            return {rows: [requestedStudyId === studyId ? this.progress(participantId) : {total: 0, classified: 0, discarded: 0, pending: 0}]};
        }
        throw new Error(`Unexpected query: ${sql}`);
    }
}

test("study service keeps three 300-card participant queues private and terminal states exclusive", async () => {
    const pool = new StudyServicePool();
    const service = createStudyService({pool});

    await assert.rejects(() => service.resolveQueue({}), error => error.status === 401);
    assert.equal(await service.resolveQueue(contexts[0]), cards[0].id);
    assert.equal(await service.classifyCard(contexts[0], cards[299].id, {
        categoryId: categoryIds.first,
        expectedRevision: 0,
        remarks: "  note  ",
        participantId: 22,
        studyId: "other-study",
    }), cards[0].id);
    assert.equal(await service.discardCard(contexts[1], cards[0].id, {
        expectedRevision: 0,
        reason: "  not applicable  ",
    }), cards[1].id);
    assert.equal(await service.classifyCard(contexts[2], cards[0].id, {
        categoryId: categoryIds.third,
        expectedRevision: 0,
    }), cards[1].id);

    assert.equal(await service.classifyCard(contexts[0], cards[299].id, {
        categoryId: categoryIds.replacement,
        expectedRevision: 1,
    }), cards[0].id);
    assert.equal(pool.classifications.size, 2);
    assert.deepEqual(pool.classifications.get(`11:${cards[299].id}`), {
        id: `classification-11-${cards[299].id}`,
        participantId: 11,
        categoryId: categoryIds.replacement,
        studyId,
        revision: 2,
    });

    assert.equal(await service.discardCard(contexts[1], cards[0].id, {
        expectedRevision: 0,
        reason: "not applicable",
    }), cards[1].id);
    await assert.rejects(() => service.classifyCard(contexts[1], cards[0].id, {
        categoryId: categoryIds.second,
        expectedRevision: 0,
    }), error => error.status === 409);
    assert.equal(pool.classifications.has(`22:${cards[0].id}`), false);

    for (const [context, expected] of [
        [contexts[0], {total: 300, classified: 1, discarded: 0, pending: 299, completed: 1}],
        [contexts[1], {total: 300, classified: 0, discarded: 1, pending: 299, completed: 1}],
        [contexts[2], {total: 300, classified: 1, discarded: 0, pending: 299, completed: 1}],
    ]) {
        assert.deepEqual(await service.loadProgress(context), expected);
    }
    assert.deepEqual(pool.transactionEvents, ["BEGIN", "COMMIT", "BEGIN", "COMMIT", "BEGIN", "COMMIT", "BEGIN", "COMMIT", "BEGIN", "COMMIT", "BEGIN", "ROLLBACK"]);
});

test("study service owns session-scoped category writes and rolls back private conflicts", async () => {
    const pool = new StudyServicePool();
    const service = createStudyService({pool});

    assert.deepEqual(await service.createCategory(contexts[0], {name: "  Needs   tests  "}), {
        id: "550e8400-e29b-41d4-a716-000000000399",
        raw_name: "Needs   tests",
        updated_at: "2026-01-01T00:00:00.000Z",
    });
    assert.deepEqual(await service.renameCategory(contexts[0], categoryIds.first, {
        name: "  Needs   review  ",
        expectedUpdatedAt: "2026-01-01T00:00:00.000Z",
    }), {
        id: categoryIds.first,
        raw_name: "Needs   review",
        updated_at: "2026-01-01T00:00:01.000Z",
    });
    await assert.rejects(() => service.renameCategory(contexts[0], categoryIds.second, {
        name: "Private conflict",
    }), error => error.status === 404);
    assert.deepEqual(pool.transactionEvents, ["BEGIN", "COMMIT", "BEGIN", "ROLLBACK"]);
});
