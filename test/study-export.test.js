import assert from "node:assert/strict";
import {parse} from "csv-parse/sync";
import test from "node:test";
import * as studyExport from "../util/study-export.js";

const {createStudyComparisonExport, getStudyExportAvailability, StudyExportError} = studyExport;

const makeFixture = ({
    expectedCardCount = 30,
    completeOrdinals = [0, 2],
    participantCount = 3,
} = {}) => {
    const study = {
        id: `study-${expectedCardCount}`,
        bootstrap_state: "READY",
        expected_card_count: expectedCardCount,
        config: {participants: Array.from({length: participantCount}, (_value, ordinal) => `participant-${ordinal}`)},
    };
    const participants = Array.from({length: participantCount}, (_value, ordinal) => ({
        reviewer_id: ordinal + 1,
        participant_key: `participant-${ordinal}`,
        participant_ordinal: ordinal,
    }));
    const cards = Array.from({length: expectedCardCount}, (_value, ordinal) => ({
        pr_card_id: `pr-card-${ordinal}`,
        card_ordinal: ordinal,
        source_card_id: `PR-${ordinal}`,
    }));
    const decisions = new Map();

    for (const participant of participants) {
        for (const card of cards) {
            const complete = completeOrdinals.includes(participant.participant_ordinal)
                || card.card_ordinal < expectedCardCount - 1;
            const classified = complete && card.card_ordinal % 2 === 0;
            decisions.set(`${participant.reviewer_id}:${card.card_ordinal}`, {
                decision: !complete ? "PENDING" : classified ? "CLASSIFIED" : "DISCARDED",
                categoryValid: true,
                categoryName: classified ? `Category ${participant.participant_ordinal}` : null,
                categoryDefinition: classified ? `Definition ${participant.participant_ordinal}` : null,
                classificationRemarks: classified ? `Remark ${card.card_ordinal}` : null,
                sourceHtmlUrl: `https://csv.example/pr/${card.card_ordinal}`,
                promotedHtmlUrl: card.card_ordinal === 0 ? `https://github.example/pr/${card.card_ordinal}` : null,
            });
        }
    }

    return {study, participants, cards, decisions};
};

const makeContext = (fixture, participantOrdinal = 0, overrides = {}) => ({
    accountId: 700 + participantOrdinal,
    studyId: fixture.study.id,
    participantId: fixture.participants[participantOrdinal]?.reviewer_id,
    participantKey: fixture.participants[participantOrdinal]?.participant_key,
    ...overrides,
});

class ExportClient {
    constructor(fixture) {
        this.fixture = fixture;
        this.queries = [];
        this.releaseCount = 0;
    }

    async query(sql, parameters = []) {
        this.queries.push({sql, parameters});
        if (sql.startsWith("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY")) return {rows: []};
        if (sql === "COMMIT" || sql === "ROLLBACK") return {rows: []};
        if (sql.includes("study-export:study")) {
            return {rows: parameters[0] === this.fixture.study.id ? [this.fixture.study] : []};
        }
        if (sql.includes("study-export:participants")) {
            return {rows: parameters[0] === this.fixture.study.id
                ? this.fixture.participants.map(participant => ({
                    participant_id: participant.reviewer_id,
                    participant_key: participant.participant_key,
                    participant_ordinal: participant.participant_ordinal,
                }))
                : []};
        }
        if (sql.includes("study-export:cards")) {
            return {rows: parameters[0] === this.fixture.study.id ? this.fixture.cards : []};
        }
        if (sql.includes("study-export:terminal-summary")) {
            const rows = [];
            for (const participant of this.fixture.participants) {
                for (const card of this.fixture.cards) {
                    const decision = this.fixture.decisions.get(`${participant.reviewer_id}:${card.card_ordinal}`);
                    const classified = decision.decision === "CLASSIFIED";
                    rows.push({
                        participant_id: participant.reviewer_id,
                        participant_ordinal: participant.participant_ordinal,
                        card_ordinal: card.card_ordinal,
                        classification_count: Number(decision.classificationCount ?? Number(classified)),
                        discard_count: Number(decision.discardCount ?? Number(decision.decision === "DISCARDED")),
                        category_reference_count: Number(decision.categoryReferenceCount ?? Number(classified)),
                        valid_category_count: Number(decision.validCategoryCount ?? Number(classified && decision.categoryValid)),
                    });
                }
            }
            return {rows};
        }
        if (sql.includes("study-export:comparison-rows")) {
            const selectedParticipantIds = new Set(parameters[1]);
            const rows = [];
            for (const participant of this.fixture.participants) {
                if (!selectedParticipantIds.has(participant.reviewer_id)) continue;
                for (const card of this.fixture.cards) {
                    const decision = this.fixture.decisions.get(`${participant.reviewer_id}:${card.card_ordinal}`);
                    rows.push({
                        participant_id: participant.reviewer_id,
                        participant_ordinal: participant.participant_ordinal,
                        participant_key: participant.participant_key,
                        card_ordinal: card.card_ordinal,
                        source_card_id: card.source_card_id,
                        source_html_url: `https://csv.example/pr/${card.card_ordinal}`,
                        promoted_html_url: card.card_ordinal === 0 ? `https://github.example/pr/${card.card_ordinal}` : null,
                        decision: decision.decision,
                        category_id: decision.decision === "CLASSIFIED" && decision.categoryValid ? `category-${participant.reviewer_id}` : null,
                        valid_category_id: decision.decision === "CLASSIFIED" && decision.categoryValid ? `category-${participant.reviewer_id}` : null,
                        category_name: decision.categoryName,
                        category_definition: decision.categoryDefinition,
                        classification_remarks: decision.classificationRemarks,
                        decision_timestamp: "not-for-export",
                    });
                }
            }
            return {rows};
        }
        throw new Error(`Unexpected export query: ${sql}`);
    }

    release() {
        this.releaseCount += 1;
    }
}

const makePool = fixture => {
    const clients = [];
    return {
        clients,
        async connect() {
            const client = new ExportClient(fixture);
            clients.push(client);
            return client;
        },
    };
};

const parseCsv = buffer => parse(buffer, {
    bom: false,
    columns: false,
    record_delimiter: "\r\n",
});

const blockHeaders = ordinals => ordinals.flatMap(ordinal => [
    `categoria_usuario_${ordinal + 1}`,
    `descripcion_categoria_usuario_${ordinal + 1}`,
    `comentario_clasificacion_usuario_${ordinal + 1}`,
]);

const assertExportError = (operation, status) => assert.rejects(operation, error => {
    assert.ok(error instanceof StudyExportError);
    assert.equal(error.status, status);
    assert.doesNotMatch(error.message, /participant-[0-9]|PR-[0-9]|category-[0-9]|study-[0-9]/i);
    return true;
});

test("comparison export covers 30/300/369 cards and two/three complete participants", async t => {
    for (const expectedCardCount of [30, 300, 369]) {
        for (const includedOrdinals of [[0, 2], [0, 1, 2]]) {
            await t.test(`${expectedCardCount} cards, ${includedOrdinals.length} included`, async () => {
                const fixture = makeFixture({expectedCardCount, completeOrdinals: includedOrdinals});
                const pool = makePool(fixture);
                const availability = await getStudyExportAvailability({pool, context: makeContext(fixture)});
                assert.deepEqual(availability, {
                    state: "ready",
                    includedParticipantCount: includedOrdinals.length,
                    expectedCardCount,
                });

                const buffer = await createStudyComparisonExport({pool, context: makeContext(fixture)});
                assert.ok(Buffer.isBuffer(buffer));
                const records = parseCsv(buffer);
                assert.equal(records.length, expectedCardCount + 1);
                assert.deepEqual(records[0], ["pr_id", "pr_url", ...blockHeaders(includedOrdinals)]);
                assert.equal(records[0].length, 2 + includedOrdinals.length * 3);
                assert.equal(records.every(record => record.length === records[0].length), true);
                assert.equal(records[1][0], "PR-0");
                assert.equal(records[1][1], "https://github.example/pr/0");
                assert.equal(records[2][1], "https://csv.example/pr/1");
                assert.equal(buffer.toString("utf8").endsWith("\r\n"), true);
                assert.doesNotMatch(buffer.toString("utf8"), /(^|[^\r])\n/);
                assert.doesNotMatch(buffer.toString("utf8"), /participant-[0-9]|not-for-export/);
                assert.equal(pool.clients.every(client => client.releaseCount === 1), true);
                assert.equal(pool.clients.every(client => client.queries.some(query => query.sql === "COMMIT")), true);
                assert.equal(pool.clients.every(client => client.queries.some(query => query.sql.startsWith(
                    "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY",
                ))), true);
                assert.equal(pool.clients.every(client => client.queries.some(query => /FROM study_card/.test(query.sql))), true);
            });
        }
    }
});

test("availability hides other participants while requester is incomplete", async () => {
    const fixture = makeFixture({completeOrdinals: [1, 2]});
    const pool = makePool(fixture);
    const availability = await getStudyExportAvailability({pool, context: makeContext(fixture)});

    assert.deepEqual(availability, {state: "incomplete"});
    assert.equal(Object.hasOwn(availability, "includedParticipantCount"), false);
    assert.equal(Object.hasOwn(availability, "expectedCardCount"), false);
    assert.equal(pool.clients[0].queries.some(query => query.sql.includes("study-export:comparison-rows")), false);
    const gateQuery = pool.clients[0].queries.find(query => query.sql.includes("study-export:terminal-summary"));
    assert.doesNotMatch(gateQuery.sql, /raw_name|definition|remarks/i);
    await assertExportError(
        () => createStudyComparisonExport({pool, context: makeContext(fixture)}),
        403,
    );
});

test("availability waits when only the requester is complete and another study cannot satisfy the gate", async t => {
    for (const expectedCardCount of [30, 369]) {
        await t.test(`${expectedCardCount} cards`, async () => {
            const fixture = makeFixture({expectedCardCount, completeOrdinals: [0]});
            fixture.otherStudyCompleteParticipantIds = [90, 91];
            const pool = makePool(fixture);

            assert.deepEqual(await getStudyExportAvailability({pool, context: makeContext(fixture)}), {state: "waiting"});
            await assertExportError(
                () => createStudyComparisonExport({pool, context: makeContext(fixture)}),
                403,
            );
        });
    }
});

test("one missing terminal decision stays incomplete even when rounded progress would be 100 percent", async t => {
    for (const expectedCardCount of [300, 369]) {
        await t.test(`${expectedCardCount} cards`, async () => {
            const fixture = makeFixture({expectedCardCount, completeOrdinals: [0, 1]});
            const lastCardOrdinal = expectedCardCount - 1;
            fixture.decisions.set(`1:${lastCardOrdinal}`, {
                decision: "PENDING",
                categoryValid: true,
                categoryName: null,
                categoryDefinition: null,
                classificationRemarks: null,
                sourceHtmlUrl: `https://csv.example/pr/${lastCardOrdinal}`,
                promotedHtmlUrl: null,
            });
            const pool = makePool(fixture);

            assert.equal(
                [...fixture.decisions.entries()].filter(([key, decision]) => key.startsWith("1:") && decision.decision !== "PENDING").length,
                expectedCardCount - 1,
            );
            assert.deepEqual(await getStudyExportAvailability({pool, context: makeContext(fixture)}), {state: "incomplete"});
            await assertExportError(() => createStudyComparisonExport({pool, context: makeContext(fixture)}), 403);
            assert.equal(pool.clients[0].queries.some(query => query.sql.includes("study-export:comparison-rows")), false);
        });
    }
});

test("a missing or non-ready study is rejected without trusting client-selected scope", async () => {
    const fixture = makeFixture({completeOrdinals: [0, 2]});
    const pool = makePool(fixture);

    await assertExportError(() => createStudyComparisonExport({
        pool,
        context: makeContext(fixture, 0, {studyId: "different-study", selectedStudyId: fixture.study.id}),
    }), 403);
    await assertExportError(() => createStudyComparisonExport({
        pool,
        context: makeContext(fixture, 0, {participantId: 99, selectedParticipantId: 1}),
    }), 403);

    fixture.study.bootstrap_state = "PENDING";
    await assertExportError(() => createStudyComparisonExport({pool, context: makeContext(fixture)}), 409);
});

test("membership, canonical card coverage, and terminal exclusivity are validated", async () => {
    const invalidMembershipFixture = makeFixture({completeOrdinals: [0, 2]});
    invalidMembershipFixture.participants.pop();
    await assertExportError(() => createStudyComparisonExport({
        pool: makePool(invalidMembershipFixture),
        context: makeContext(invalidMembershipFixture),
    }), 409);

    const missingCardFixture = makeFixture({completeOrdinals: [0, 2]});
    missingCardFixture.cards.pop();
    const missingCardPool = makePool(missingCardFixture);
    await assertExportError(
        () => createStudyComparisonExport({pool: missingCardPool, context: makeContext(missingCardFixture)}),
        409,
    );
    assert.equal(missingCardPool.clients[0].queries.some(query => query.sql.includes("study-export:comparison-rows")), false);

    const conflictFixture = makeFixture({completeOrdinals: [0, 2]});
    conflictFixture.decisions.get("1:0").discardCount = 1;
    await assertExportError(
        () => createStudyComparisonExport({pool: makePool(conflictFixture), context: makeContext(conflictFixture)}),
        409,
    );
});

test("incomplete ordinal gaps remain visible, while invalid category references reject the whole export", async () => {
    const fixture = makeFixture({completeOrdinals: [0, 2]});
    const pool = makePool(fixture);
    const buffer = await createStudyComparisonExport({pool, context: makeContext(fixture)});
    const records = parseCsv(buffer);
    assert.deepEqual(records[0], ["pr_id", "pr_url", ...blockHeaders([0, 2])]);
    assert.equal(records.flat().some(value => value.includes("participant-1")), false);

    const invalidCategoryFixture = makeFixture({completeOrdinals: [0, 2]});
    invalidCategoryFixture.decisions.get("1:0").categoryValid = false;
    const invalidCategoryPool = makePool(invalidCategoryFixture);
    await assertExportError(() => createStudyComparisonExport({
        pool: invalidCategoryPool,
        context: makeContext(invalidCategoryFixture),
    }), 409);
    assert.equal(invalidCategoryPool.clients[0].queries.some(query => query.sql.includes("study-export:comparison-rows")), false);
    assert.equal(invalidCategoryPool.clients[0].queries.at(-1).sql, "ROLLBACK");
});

test("classified, discarded, and optional cells map to separate CSV fields", async () => {
    const fixture = makeFixture({completeOrdinals: [0, 2]});
    for (const card of fixture.cards) {
        fixture.decisions.set(`1:${card.card_ordinal}`, {
            decision: "DISCARDED",
            categoryValid: true,
            categoryName: null,
            categoryDefinition: null,
            classificationRemarks: null,
            sourceHtmlUrl: `https://csv.example/pr/${card.card_ordinal}`,
            promotedHtmlUrl: null,
        });
    }
    fixture.decisions.get("3:0").categoryDefinition = null;
    fixture.decisions.get("3:0").classificationRemarks = null;
    const records = parseCsv(await createStudyComparisonExport({pool: makePool(fixture), context: makeContext(fixture)}));

    assert.deepEqual(records[1].slice(2, 5), ["DESCARTADO", "", ""]);
    assert.deepEqual(records[1].slice(5, 8), ["Category 2", "", ""]);
    assert.equal(records.length, fixture.study.expected_card_count + 1);
});

test("CSV quoting preserves Unicode, commas, quotes, multiline text, and formula protection only in output", async () => {
    const fixture = makeFixture({completeOrdinals: [0, 2]});
    const original = fixture.decisions.get("1:0");
    Object.assign(original, {
        categoryName: "=SUM(1,1)",
        categoryDefinition: "  + café, \"texte\"\r\nsecond line",
        classificationRemarks: "\t@HYPERLINK(\"https://example.test\")",
    });
    fixture.decisions.get("1:2").classificationRemarks = "'already protected";
    const pool = makePool(fixture);
    const buffer = await createStudyComparisonExport({pool, context: makeContext(fixture)});
    const records = parseCsv(buffer);

    assert.deepEqual(records[1].slice(2, 5), [
        "'=SUM(1,1)",
        "'  + café, \"texte\"\r\nsecond line",
        "'\t@HYPERLINK(\"https://example.test\")",
    ]);
    assert.equal(records[3][4], "'already protected");
    assert.equal(original.categoryName, "=SUM(1,1)");
    assert.equal(original.categoryDefinition, "  + café, \"texte\"\r\nsecond line");
    assert.match(buffer.toString("utf8"), /\r\n/);
    assert.equal(parseCsv(buffer).every(record => record.length === records[0].length), true);
});

test("empty, leading CR/LF, and leading-space formula cells are protected without merging similar categories", async () => {
    const fixture = makeFixture({completeOrdinals: [0, 2]});
    fixture.decisions.get("1:0").categoryName = " =1+1";
    fixture.decisions.get("1:0").categoryDefinition = "\rSUM(1,1)";
    fixture.decisions.get("1:0").classificationRemarks = "\n@cmd";
    fixture.decisions.get("3:0").categoryName = "Different spelling";
    fixture.decisions.get("3:2").categoryName = "@command";
    fixture.decisions.get("3:2").categoryDefinition = "-1+1";
    fixture.decisions.get("3:2").classificationRemarks = "+1+1";
    fixture.decisions.get("1:2").categoryDefinition = null;
    fixture.decisions.get("1:2").classificationRemarks = null;
    const records = parseCsv(await createStudyComparisonExport({pool: makePool(fixture), context: makeContext(fixture)}));

    assert.deepEqual(records[1].slice(2, 5), ["' =1+1", "'\rSUM(1,1)", "'\n@cmd"]);
    assert.deepEqual(records[3].slice(2, 5), ["Category 0", "", ""]);
    assert.deepEqual(records[1].slice(5, 6), ["Different spelling"]);
    assert.deepEqual(records[3].slice(5, 8), ["'@command", "'-1+1", "'+1+1"]);
    assert.equal(records[1][2], "' =1+1");
});

test("only canonical study cards and approved export columns are serialized", async () => {
    const fixture = makeFixture({completeOrdinals: [0, 2]});
    fixture.outsideSampleDecision = {
        source_card_id: "OUTSIDE-SAMPLE",
        decision: "CLASSIFIED",
        category_name: "outside",
    };
    const pool = makePool(fixture);
    const buffer = await createStudyComparisonExport({pool, context: makeContext(fixture)});
    const records = parseCsv(buffer);
    const output = buffer.toString("utf8");

    assert.equal(records.length, fixture.study.expected_card_count + 1);
    assert.equal(records[0].length, 8);
    assert.doesNotMatch(output, /OUTSIDE-SAMPLE|participant-[0-9]|not-for-export|decision_timestamp/);
    assert.equal(pool.clients[0].queries.some(query => /INSERT|UPDATE|DELETE|TRUNCATE/i.test(query.sql)), false);
});
