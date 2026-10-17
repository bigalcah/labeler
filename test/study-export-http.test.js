import assert from "node:assert/strict";
import {once} from "node:events";
import {parse} from "csv-parse/sync";
import test from "node:test";
import {createApp} from "../app.js";

const csrfToken = "t".repeat(43);
const context = Object.freeze({
    accountId: "account-1",
    studyId: "study-1",
    participantId: 11,
    participantKey: "participant-a",
});

const makeExportFixture = ({completeParticipantOrdinals = [0, 1], invalidCategoryOrdinal = null} = {}) => {
    const participants = Array.from({length: 3}, (_value, ordinal) => ({
        participant_id: 11 + ordinal * 11,
        participant_key: `participant-${ordinal}`,
        participant_ordinal: ordinal,
    }));
    return {
        study: {
            id: context.studyId,
            bootstrap_state: "READY",
            expected_card_count: 30,
            config: {participants: participants.map(participant => participant.participant_key)},
        },
        participants,
        cards: Array.from({length: 30}, (_value, ordinal) => ({
            pr_card_id: `card-${ordinal}`,
            source_card_id: `PR-${ordinal}`,
            card_ordinal: ordinal,
        })),
        completeParticipantOrdinals: new Set(completeParticipantOrdinals),
        invalidCategoryOrdinal,
    };
};

const decisionFor = (fixture, participant, card) => {
    if (!fixture.completeParticipantOrdinals.has(participant.participant_ordinal)) return "PENDING";
    return card.card_ordinal % 2 === 0 ? "CLASSIFIED" : "DISCARDED";
};

const makeExportPool = (fixture, {commitError = null, connectError = null} = {}) => {
    const clients = [];
    const clientQueries = [];
    return {
        clients,
        clientQueries,
        query: async sql => { throw new Error(`Unexpected pool query: ${sql}`); },
        connect: async () => {
            if (connectError) throw connectError;
            const client = {
                releaseCount: 0,
                async query(sql, parameters = []) {
                    clientQueries.push({sql, parameters});
                    if (sql.startsWith("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY")) return {rows: []};
                    if (sql === "COMMIT") {
                        if (commitError) throw commitError;
                        return {rows: []};
                    }
                    if (sql === "ROLLBACK") return {rows: []};
                    if (sql.includes("study-export:study")) {
                        return {rows: parameters[0] === fixture.study.id ? [fixture.study] : []};
                    }
                    if (sql.includes("study-export:participants")) {
                        return {rows: parameters[0] === fixture.study.id ? fixture.participants : []};
                    }
                    if (sql.includes("study-export:cards")) {
                        return {rows: parameters[0] === fixture.study.id ? fixture.cards : []};
                    }
                    if (sql.includes("study-export:terminal-summary")) {
                        return {
                            rows: fixture.participants.flatMap(participant => fixture.cards.map(card => {
                                const decision = decisionFor(fixture, participant, card);
                                const classified = decision === "CLASSIFIED";
                                const invalidCategory = classified
                                    && participant.participant_ordinal === fixture.invalidCategoryOrdinal
                                    && card.card_ordinal === 0;
                                return {
                                    participant_id: participant.participant_id,
                                    participant_ordinal: participant.participant_ordinal,
                                    card_ordinal: card.card_ordinal,
                                    classification_count: Number(classified),
                                    discard_count: Number(decision === "DISCARDED"),
                                    category_reference_count: Number(classified),
                                    valid_category_count: Number(classified && !invalidCategory),
                                };
                            })),
                        };
                    }
                    if (sql.includes("study-export:comparison-rows")) {
                        const selectedParticipants = new Set(parameters[1]);
                        return {
                            rows: fixture.participants
                                .filter(participant => selectedParticipants.has(participant.participant_id))
                                .flatMap(participant => fixture.cards.map(card => {
                                    const decision = decisionFor(fixture, participant, card);
                                    const classified = decision === "CLASSIFIED";
                                    const categoryId = classified ? `category-${participant.participant_id}` : null;
                                    return {
                                        participant_id: participant.participant_id,
                                        participant_ordinal: participant.participant_ordinal,
                                        card_ordinal: card.card_ordinal,
                                        source_card_id: card.source_card_id,
                                        source_html_url: `https://csv.example/pr/${card.card_ordinal}`,
                                        promoted_html_url: card.card_ordinal === 0 ? "https://github.example/pr/0" : null,
                                        decision,
                                        category_id: categoryId,
                                        valid_category_id: categoryId,
                                        category_name: classified ? `Category ${participant.participant_ordinal}` : null,
                                        category_definition: classified && card.card_ordinal === 0
                                            ? `Definition ${participant.participant_ordinal}`
                                            : null,
                                        classification_remarks: classified && card.card_ordinal === 0
                                            ? `Remark ${participant.participant_ordinal}`
                                            : null,
                                    };
                                })),
                        };
                    }
                    throw new Error(`Unexpected export query: ${sql}`);
                },
                release() {
                    this.releaseCount += 1;
                },
            };
            clients.push(client);
            return client;
        },
    };
};

const sessionMiddleware = sessions => (req, res, next) => {
    const sessionId = req.headers.cookie?.split("=")[1];
    const session = sessions.get(sessionId);
    req.sessionContext = session ? context : null;
    req.csrfToken = session?.csrfToken || null;
    res.locals.sessionContext = req.sessionContext;
    res.locals.csrfToken = req.csrfToken;
    next();
};

const startServer = async ({pool, sessions = new Map([["session-a", {csrfToken}]]), csrf = {}} = {}) => {
    const app = await createApp({
        pool,
        sessionMiddleware: sessionMiddleware(sessions),
        nodeEnv: "production",
        originPolicy: {nodeEnv: "production", appOrigin: "https://study.example"},
        csrf,
    });
    const server = app.listen(0);
    await once(server, "listening");
    return server;
};

const closeServer = server => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));

const get = (baseUrl, cookie = "__Host-session=session-a") => fetch(
    `${baseUrl}/export?study_id=attacker-study&participant_id=999`,
    {
        headers: cookie === null ? {} : {cookie},
    },
);

const post = (baseUrl, {cookie = "__Host-session=session-a", origin = "https://study.example", token = csrfToken} = {}) => {
    const headers = new Headers({"content-type": "application/x-www-form-urlencoded"});
    if (cookie !== null) headers.set("cookie", cookie);
    if (origin !== null) headers.set("origin", origin);
    if (token !== null) headers.set("x-csrf-token", token);
    return fetch(`${baseUrl}/export/download?study_id=attacker-study&participant_id=999`, {
        method: "POST",
        headers,
        body: "study_id=attacker-study&participant_id=999",
    });
};

const assertPrivateHeaders = response => {
    const cacheControl = response.headers.get("cache-control") || "";
    assert.match(cacheControl, /\bprivate\b/i);
    assert.match(cacheControl, /\bno-store\b/i);
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
};

const assertPrivateError = async (response, status, prohibitedContent = []) => {
    const body = await response.text();
    assert.equal(response.status, status);
    assertPrivateHeaders(response);
    assert.equal(response.headers.get("content-disposition"), null);
    assert.doesNotMatch(response.headers.get("content-type") || "", /text\/(?:csv|html)/i);
    const prohibited = [
        ...prohibitedContent,
        "pr_id",
        "categoria_usuario",
        "DESCARTADO",
        "PR-[0-9]+",
        "\\b(?:SELECT|INSERT|UPDATE|DELETE|BEGIN|COMMIT|ROLLBACK)\\b",
    ];
    for (const content of prohibited) assert.doesNotMatch(body, new RegExp(content, "i"));
    return body;
};

test("GET /export requires a session and does not disclose state", async () => {
    const server = await startServer({pool: {query: async () => ({rows: []})}, sessions: new Map()});
    const baseUrl = `http://127.0.0.1:${server.address().port}`;

    try {
        await assertPrivateError(await get(baseUrl, null), 401);
    } finally {
        await closeServer(server);
    }
});

test("GET /export renders each availability state for a session without requiring CSRF", async t => {
    const states = [
        {name: "incomplete", fixture: makeExportFixture({completeParticipantOrdinals: [1, 2]}), copy: /Complete all of your assigned cards/},
        {name: "waiting", fixture: makeExportFixture({completeParticipantOrdinals: [0]}), copy: /at least one other participant/},
        {name: "ready", fixture: makeExportFixture({completeParticipantOrdinals: [0, 1]}), copy: /Download CSV/},
    ];

    for (const state of states) {
        await t.test(state.name, async () => {
            const pool = makeExportPool(state.fixture);
            const server = await startServer({pool});
            const baseUrl = `http://127.0.0.1:${server.address().port}`;

            try {
                const response = await get(baseUrl);
                const body = await response.text();
                assert.equal(response.status, 200);
                assert.match(response.headers.get("content-type") || "", /text\/html/i);
                assertPrivateHeaders(response);
                assert.match(body, state.copy);
                assert.doesNotMatch(body, /study-1|PR-[0-9]|participant-[0-9]/i);
                const parameters = JSON.stringify(pool.clientQueries.map(query => query.parameters));
                assert.doesNotMatch(parameters, /attacker-study|999/);
                assert.match(parameters, /study-1/);
            } finally {
                await closeServer(server);
            }
        });
    }
});

test("POST /export/download rejects invalid Origin before CSRF or export work", async () => {
    let csrfValidations = 0;
    const server = await startServer({
        pool: {query: async () => { throw new Error("export query must not run"); }},
        csrf: {validateSessionCsrfToken: () => { csrfValidations += 1; return true; }},
    });
    const baseUrl = `http://127.0.0.1:${server.address().port}`;

    try {
        await assertPrivateError(await post(baseUrl, {origin: "https://attacker.example"}), 403, ["export query must not run"]);
        assert.equal(csrfValidations, 0);
    } finally {
        await closeServer(server);
    }
});

test("POST /export/download rejects invalid CSRF after Origin validation", async () => {
    const server = await startServer({pool: {query: async () => { throw new Error("export query must not run"); }}});
    const baseUrl = `http://127.0.0.1:${server.address().port}`;

    try {
        await assertPrivateError(await post(baseUrl, {token: "x".repeat(43)}), 403, ["export query must not run"]);
    } finally {
        await closeServer(server);
    }
});

test("POST /export/download returns 401 for a missing session after valid Origin and CSRF processing", async () => {
    const server = await startServer({pool: {query: async () => { throw new Error("export query must not run"); }}, sessions: new Map()});
    const baseUrl = `http://127.0.0.1:${server.address().port}`;

    try {
        await assertPrivateError(await post(baseUrl, {cookie: null}), 401, ["export query must not run"]);
    } finally {
        await closeServer(server);
    }
});

test("POST /export/download returns 403 without an attachment when the session participant is not eligible", async () => {
    const server = await startServer({pool: makeExportPool(makeExportFixture({completeParticipantOrdinals: [0]}))});
    const baseUrl = `http://127.0.0.1:${server.address().port}`;

    try {
        const body = await assertPrivateError(await post(baseUrl), 403, ["study-1", "participant-a", "SELECT"]);
        assert.equal(body, "Export is not available.");
    } finally {
        await closeServer(server);
    }
});

test("POST /export/download returns a private 409 for invalid persisted category data", async () => {
    const pool = makeExportPool(makeExportFixture({completeParticipantOrdinals: [0, 1], invalidCategoryOrdinal: 0}));
    const server = await startServer({pool});
    const baseUrl = `http://127.0.0.1:${server.address().port}`;

    try {
        const body = await assertPrivateError(await post(baseUrl), 409, ["study-1", "participant-a", "SELECT"]);
        assert.equal(body, "We couldn't prepare the export.");
        const parameters = JSON.stringify(pool.clientQueries.map(query => query.parameters));
        assert.doesNotMatch(parameters, /attacker-study|999/);
        assert.match(parameters, /study-1/);
    } finally {
        await closeServer(server);
    }
});

test("export storage failures return private sanitized 500 responses without CSV or attachment", async () => {
    const pool = {
        query: async () => { throw new Error("private query secret"); },
        connect: async () => { throw new Error("private query secret"); },
    };
    const server = await startServer({pool});
    const baseUrl = `http://127.0.0.1:${server.address().port}`;

    try {
        await assertPrivateError(await get(baseUrl), 500, ["private query secret", "Error:", "SELECT"]);
        await assertPrivateError(await post(baseUrl), 500, ["private query secret", "Error:", "SELECT"]);
    } finally {
        await closeServer(server);
    }
});

test("export commit failures return sanitized 500 responses and roll back before publishing", async () => {
    const pool = makeExportPool(makeExportFixture(), {commitError: new Error("private commit secret")});
    const server = await startServer({pool});
    const baseUrl = `http://127.0.0.1:${server.address().port}`;

    try {
        await assertPrivateError(await post(baseUrl), 500, ["private commit secret", "Error:", "SELECT", "PR-0"]);
        assert.ok(pool.clientQueries.some(query => query.sql === "ROLLBACK"));
        assert.ok(pool.clients.every(client => client.releaseCount === 1));
    } finally {
        await closeServer(server);
    }
});

test("POST /export/download returns a private RFC-compatible CSV for session scope only", async () => {
    const pool = makeExportPool(makeExportFixture({completeParticipantOrdinals: [0, 1]}));
    const server = await startServer({pool});
    const baseUrl = `http://127.0.0.1:${server.address().port}`;

    try {
        const response = await post(baseUrl);
        assert.equal(response.status, 200);
        assert.equal(response.headers.get("content-type"), "text/csv; charset=utf-8");
        assert.equal(response.headers.get("content-disposition"), "attachment; filename=\"pr-classifications.csv\"");
        assertPrivateHeaders(response);

        const csv = Buffer.from(await response.arrayBuffer());
        const records = parse(csv, {record_delimiter: "\r\n"});
        assert.equal(records.length, 31);
        assert.deepEqual(records[0], [
            "pr_id",
            "pr_url",
            "categoria_usuario_1",
            "descripcion_categoria_usuario_1",
            "comentario_clasificacion_usuario_1",
            "categoria_usuario_2",
            "descripcion_categoria_usuario_2",
            "comentario_clasificacion_usuario_2",
        ]);
        assert.ok(records.every(record => record.length === 8));
        assert.deepEqual(records[1], [
            "PR-0",
            "https://github.example/pr/0",
            "Category 0",
            "Definition 0",
            "Remark 0",
            "Category 1",
            "Definition 1",
            "Remark 1",
        ]);
        assert.deepEqual(records[2].slice(2), ["DESCARTADO", "", "", "DESCARTADO", "", ""]);

        const parameters = JSON.stringify(pool.clientQueries.map(query => query.parameters));
        assert.doesNotMatch(parameters, /attacker-study|999/);
        assert.match(parameters, /study-1/);
        assert.doesNotMatch(csv.toString("utf8"), /participant-[0-9]|study-1/);
    } finally {
        await closeServer(server);
    }
});
