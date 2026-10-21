import assert from "node:assert/strict";
import {once} from "node:events";
import {after, before, test} from "node:test";
import {createApp} from "../app.js";
import {authenticateLogin} from "../util/login-authentication.js";
import {createCopilot369QaCasesMiddleware} from "../scripts/serve-copilot-369-qa.js";
import {closeCopilot369Database} from "./support/copilot-369-fixture.js";
import {
    Copilot369HttpClient,
    createCopilot369Runtime,
    createCopilot369QaSessionPolicy,
    encodeCopilot369Form,
    fingerprintProtectedCopilot369Validation,
    readCopilot369AuthState,
    readCopilot369PrivateState,
} from "./support/copilot-369-runtime.js";

const sessionPolicy = createCopilot369QaSessionPolicy();
const closeServer = server => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));

let runtime;
let server;
let baseUrl;
let clients;
let primaryCards;
let validationCardIds;
let validationCategoryId;
let authBaseline;
let validationFingerprint;
let initialPrivateState;

before(async () => {
    runtime = await createCopilot369Runtime();
    const {rows} = await runtime.pool.query("SELECT source_card_id, pr_card_id FROM study_card WHERE study_id = $1 ORDER BY ordinal", [runtime.primaryStudyId]);
    primaryCards = rows;
    const {rows: validationRows} = await runtime.pool.query("SELECT source_card_id, pr_card_id FROM study_card WHERE study_id = $1 ORDER BY ordinal", [runtime.validationStudyId]);
    validationCardIds = validationRows;
    const {rows: [category]} = await runtime.pool.query("SELECT id FROM participant_category WHERE study_id = $1 ORDER BY participant_id LIMIT 1", [runtime.validationStudyId]);
    validationCategoryId = category.id;
    authBaseline = runtime.authenticationBaseline;
    validationFingerprint = runtime.protectedValidationBaseline;
    initialPrivateState = await readCopilot369PrivateState(runtime.pool, [runtime.primaryStudyId, runtime.validationStudyId]);
    const app = await createApp({
        pool: runtime.pool,
        sessionPolicy,
        nodeEnv: "development",
        originPolicy: {appOrigin: null, developmentOrigins: ["http://127.0.0.1", "http://localhost"]},
        middleware: [createCopilot369QaCasesMiddleware({pool: runtime.pool, primaryStudyId: runtime.primaryStudyId, cardId: primaryCards[0].pr_card_id})],
    });
    server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    baseUrl = `http://127.0.0.1:${server.address().port}`;
    clients = new Map(["javier", "diego", "pablo"].map(participant => [participant,
        new Copilot369HttpClient(baseUrl, participant, runtime.passwords[participant])]));
});

after(async () => {
    if (server) await closeServer(server);
    if (runtime) await closeCopilot369Database(runtime);
});

test("Copilot 369 real-PostgreSQL private flow, synthetic auth preservation, and HTTP QA cases", async t => {
    await t.test("Given canonical sources When the fixture seeds both studies Then primary order and protected 30 states are exact", async () => {
        assert.deepEqual(await readCopilot369AuthState(runtime.pool), authBaseline);
        assert.equal(await fingerprintProtectedCopilot369Validation(runtime.pool, runtime.validationStudyId), validationFingerprint);
        const {rows: studies} = await runtime.pool.query(
            "SELECT study_key, expected_card_count, bootstrap_state FROM study ORDER BY expected_card_count DESC",
        );
        assert.deepEqual(studies, [
            {study_key: "pr-card-sorting-local", expected_card_count: 369, bootstrap_state: "READY"},
            {study_key: "pr-card-sorting-validation-30", expected_card_count: 30, bootstrap_state: "READY"},
        ]);
        assert.equal(validationCardIds.length, 30);
        const {rows: primaryOrder} = await runtime.pool.query(
            `SELECT participant.participant_key, card.ordinal, card.source_card_id
             FROM study_participant participant JOIN study_card card ON card.study_id = participant.study_id
             WHERE participant.study_id = $1 ORDER BY participant.ordinal, card.ordinal`,
            [runtime.primaryStudyId],
        );
        assert.equal(primaryOrder.length, 369 * 3);
        for (const participant of ["javier", "diego", "pablo"]) {
            assert.deepEqual(primaryOrder.filter(row => row.participant_key === participant).map(row => [row.ordinal, row.source_card_id]),
                primaryCards.map((card, ordinal) => [ordinal, card.source_card_id]));
        }
        const {rows: validationStates} = await runtime.pool.query(
            `SELECT participant.participant_key, card.ordinal, card.source_card_id,
                    CASE WHEN classification.id IS NOT NULL THEN 'CLASSIFIED'
                         WHEN discard.pr_card_id IS NOT NULL THEN 'DISCARDED' ELSE 'PENDING' END AS status
             FROM study_participant participant JOIN study_card card ON card.study_id = participant.study_id
             LEFT JOIN pr_classification classification ON classification.study_id = card.study_id
                AND classification.participant_id = participant.reviewer_id AND classification.pr_card_id = card.pr_card_id
             LEFT JOIN pr_discard discard ON discard.study_id = card.study_id
                AND discard.participant_id = participant.reviewer_id AND discard.pr_card_id = card.pr_card_id
             WHERE participant.study_id = $1 ORDER BY participant.ordinal, card.ordinal`,
            [runtime.validationStudyId],
        );
        for (const participant of ["javier", "diego", "pablo"]) {
            const actual = validationStates.filter(row => row.participant_key === participant);
            assert.equal(actual.length, 30);
            assert.deepEqual(actual.map(row => row.source_card_id), runtime.validationCards.map(card => card.source_card_id));
            assert.deepEqual(actual.map(row => row.status), actual.map((_row, ordinal) => participant === "javier" && ordinal === 0
                ? "CLASSIFIED" : participant === "diego" && ordinal === 1 ? "DISCARDED" : "PENDING"));
        }
        assert.equal((await runtime.pool.query("SELECT COUNT(*)::integer AS count FROM study_card WHERE study_id = $1", [runtime.primaryStudyId])).rows[0].count, 369);
    });

    await t.test("Given cloned synthetic Argon2id accounts When authenticateLogin and real HTTP login run Then immutable auth fields and cookies are preserved", async () => {
        assert.equal(authBaseline.length, 6);
        for (const participant of ["javier", "diego", "pablo"]) {
            const primary = authBaseline.find(account => account.study_key === "pr-card-sorting-local" && account.participant_key === participant);
            const validation = authBaseline.find(account => account.study_key === "pr-card-sorting-validation-30" && account.participant_key === participant);
            assert.equal(primary.password_hash, validation.password_hash);
            assert.equal(primary.enabled, true);
            assert.equal(primary.credential_version, validation.credential_version);
            assert.equal(primary.normalized_username, participant);
            assert.equal(validation.normalized_username, `${participant}-30`);
        }
        const direct = await authenticateLogin({pool: runtime.pool, username: "javier", password: runtime.passwords.javier,
            clientIp: "127.0.0.1", sessionPolicy});
        assert.equal(direct.kind, "authenticated");
        await Promise.all([...clients.values()].map(client => client.login()));
        const sessionCookies = [...clients.values()].map(client => client.cookieHeader());
        assert.equal(new Set(sessionCookies).size, 3);
        assert.deepEqual(await readCopilot369AuthState(runtime.pool), authBaseline);
    });

    await t.test("Given three authenticated contexts When hostile IDs, forged sessions, and bad Origin/CSRF are sent Then requests reject without private mutation", async () => {
        const firstCards = await Promise.all([...clients.values()].map(client => client.queueCard()));
        assert.deepEqual(firstCards, [primaryCards[0].pr_card_id, primaryCards[0].pr_card_id, primaryCards[0].pr_card_id]);
        const javier = clients.get("javier");
        const diego = clients.get("diego");
        const forged = await javier.request("/queue", {headers: {cookie: "copilot-369-qa-session=invalid.signature"}});
        assert.equal(forged.status, 401);
        const foreign = await javier.request(`/queue/${validationCardIds[0].pr_card_id}`);
        assert.equal(foreign.status, 404);
        const suppliedIdentity = await javier.request(`/queue?study_id=${runtime.validationStudyId}&participant_id=999`);
        assert.equal(suppliedIdentity.status, 303);
        assert.equal(suppliedIdentity.headers.get("location"), `/queue/${primaryCards[0].pr_card_id}`);
        const hostileOrigin = await javier.request("/categories", {
            method: "POST", headers: {...javier.mutationHeaders(), origin: "https://attacker.invalid"}, body: encodeCopilot369Form({name: "hostile-origin"}),
        });
        assert.equal(hostileOrigin.status, 403);
        const missingToken = await javier.request("/categories", {
            method: "POST", headers: {...javier.mutationHeaders(null)}, body: encodeCopilot369Form({name: "missing-token"}),
        });
        assert.equal(missingToken.status, 403);
        const crossSessionToken = await javier.request("/categories", {
            method: "POST", headers: {...javier.mutationHeaders(), cookie: diego.cookieHeader()}, body: encodeCopilot369Form({name: "cross-session-token"}),
        });
        assert.equal(crossSessionToken.status, 403);
        const foreignStudyCard = await javier.request(`/queue/${validationCardIds[0].pr_card_id}/classify`, {
            method: "POST",
            headers: javier.mutationHeaders(),
            body: encodeCopilot369Form({category_id: validationCategoryId, expected_revision: "0"}),
        });
        assert.equal(foreignStudyCard.status, 404);
        const foreignCategory = await javier.request(`/queue/${primaryCards[0].pr_card_id}/classify`, {
            method: "POST", headers: javier.mutationHeaders(), body: encodeCopilot369Form({category_id: validationCategoryId, expected_revision: "0", study_id: runtime.validationStudyId, participant_id: 999}),
        });
        assert.equal(foreignCategory.status, 404);
        assert.equal(await readCopilot369PrivateState(runtime.pool, [runtime.primaryStudyId, runtime.validationStudyId]), initialPrivateState);
    });

    await t.test("Given primary participants When categories, classification edits, notes, discard, and progress run Then all 369 responses remain private and 30 stays byte-stable", async () => {
        const categories = new Map();
        for (const [participant, client] of clients) {
            const payload = {name: "Shared cause"};
            if (participant !== "diego") payload.definition = `Private definition ${participant}`;
            const response = await client.request("/categories", {
                method: "POST", headers: client.mutationHeaders(), body: encodeCopilot369Form(payload),
            });
            assert.equal(response.status, 201);
            categories.set(participant, await response.json());
        }
        for (const [participant, client] of clients) {
            const card = await client.request(`/queue/${primaryCards[0].pr_card_id}`);
            const html = await card.text();
            assert.equal(card.status, 200);
            if (participant === "diego") {
                assert.doesNotMatch(html, /Private definition/);
            } else {
                assert.match(html, new RegExp(`Private definition ${participant}`));
                for (const other of ["javier", "diego", "pablo"].filter(key => key !== participant)) {
                    assert.doesNotMatch(html, new RegExp(`Private definition ${other}`));
                }
            }
        }
        const javier = clients.get("javier");
        const renamed = await javier.request(`/categories/${categories.get("javier").id}`, {
            method: "PATCH",
            headers: {origin: javier.origin, "content-type": "application/json", "x-csrf-token": javier.csrfToken},
            body: JSON.stringify({name: "Renamed cause", definition: "Renamed private definition"}),
        });
        assert.equal(renamed.status, 200);
        const first = primaryCards[0].pr_card_id;
        const second = primaryCards[1].pr_card_id;
        const third = primaryCards[2].pr_card_id;
        const classify = async (cardId, expectedRevision, remarks) => javier.request(`/queue/${cardId}/classify`, {
            method: "POST", headers: javier.mutationHeaders(),
            body: encodeCopilot369Form({category_id: categories.get("javier").id, expected_revision: `${expectedRevision}`, ...(remarks === undefined ? {} : {remarks})}),
        });
        const classified = await classify(first, 0, "Initial private note");
        assert.equal(classified.status, 303);
        assert.equal(classified.headers.get("location"), `/queue/${second}`);
        const edited = await classify(first, 1, "Edited private note");
        assert.equal(edited.status, 303);
        assert.equal(edited.headers.get("location"), `/queue/${second}`);
        const withoutNote = await classify(second, 0);
        assert.equal(withoutNote.status, 303);
        assert.equal(withoutNote.headers.get("location"), `/queue/${third}`);
        const discarded = await javier.request(`/queue/${third}/discard`, {
            method: "POST", headers: javier.mutationHeaders(), body: encodeCopilot369Form({expected_revision: "0", reason: "outside scope"}),
        });
        assert.equal(discarded.status, 303);
        assert.equal(discarded.headers.get("location"), `/queue/${primaryCards[3].pr_card_id}`);
        const {rows: decisions} = await runtime.pool.query(
            `SELECT card.source_card_id, classification.remarks, classification.revision
             FROM pr_classification classification JOIN pr_cards card ON card.id = classification.pr_card_id
             WHERE classification.study_id = $1 AND classification.participant_id = (
                SELECT reviewer_id FROM study_participant WHERE study_id = $1 AND participant_key = 'javier')
             ORDER BY card.source_card_id`,
            [runtime.primaryStudyId],
        );
        assert.deepEqual(decisions, [
            {source_card_id: runtime.primaryCards[1].source_card_id, remarks: null, revision: 1},
            {source_card_id: runtime.primaryCards[0].source_card_id, remarks: "Edited private note", revision: 2},
        ].sort((left, right) => left.source_card_id.localeCompare(right.source_card_id)));
        const {rows: [discardState]} = await runtime.pool.query(
            "SELECT reason FROM pr_discard WHERE study_id = $1 AND pr_card_id = $2",
            [runtime.primaryStudyId, third],
        );
        assert.deepEqual(discardState, {reason: "outside scope"});
        for (const [participant, client] of clients) {
            const progress = await client.request("/progress?study_id=wrong&participant_id=999");
            const html = await progress.text();
            assert.equal(progress.status, 200);
            assert.match(html, /369 assigned cards/);
            assert.match(html, new RegExp(participant === "javier" ? "3 of 369 cards completed" : "0 of 369 cards completed"));
            if (participant !== "javier") assert.doesNotMatch(html, /Renamed private definition|Edited private note|outside scope/);
        }
        assert.equal(await fingerprintProtectedCopilot369Validation(runtime.pool, runtime.validationStudyId), validationFingerprint);
        assert.deepEqual(await readCopilot369AuthState(runtime.pool), authBaseline);
    });

    await t.test("Given an authenticated primary session When test-only card cases render Then the real template omits missing language and sanitizes synthetic Markdown", async () => {
        const javier = clients.get("javier");
        const missing = await javier.request("/__qa/copilot-369/cases/missing-language");
        const missingHtml = await missing.text();
        assert.equal(missing.status, 200);
        assert.match(missingHtml, /Card 1 of 369/);
        assert.doesNotMatch(missingHtml, /Dataset language:/);
        const unsafe = await javier.request("/__qa/copilot-369/cases/unsafe-markdown");
        const unsafeHtml = await unsafe.text();
        assert.equal(unsafe.status, 200);
        assert.match(unsafeHtml, /Synthetic safe Markdown/);
        assert.doesNotMatch(unsafeHtml, /onerror=|javascript:|<img\b/i);
        assert.equal(await fingerprintProtectedCopilot369Validation(runtime.pool, runtime.validationStudyId), validationFingerprint);
    });
});
