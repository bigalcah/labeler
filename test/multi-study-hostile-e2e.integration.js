import assert from "node:assert/strict";
import {existsSync, readFileSync, statSync} from "node:fs";
import https from "node:https";
import path from "node:path";
import test from "node:test";
import {parse} from "csv-parse/sync";
import pg from "pg";
import {createStudyComparisonExport} from "../util/study-export.js";
import {fingerprintPersistentStudy} from "./support/study-state-fingerprint.js";
import {categoryName} from "./support/private-category-name.js";

const {Pool} = pg;
const root = path.resolve(new URL("..", import.meta.url).pathname);
const currentStudyKey = "pr-card-sorting-local";
const validationStudyKey = "pr-card-sorting-validation-30";
const usernames = Object.freeze(["javier", "diego", "pablo", "javier-30", "diego-30", "pablo-30"]);
const participantKeys = Object.freeze(["javier", "diego", "pablo"]);
const canonicalSourceIds = new Map([
    [currentStudyKey, JSON.parse(readFileSync(path.join(root, "plans/copilot-369-cards.manifest.json"), "utf8")).ordered_pr_ids],
    [validationStudyKey, JSON.parse(readFileSync(path.join(root, "plans/validation-30-cards.manifest.json"), "utf8")).orderedCardIds],
]);
const sourceArtifacts = new Map([
    [currentStudyKey, ["plans/copilot-369-cards.csv", "plans/copilot-369-cards.manifest.json"]],
    [validationStudyKey, ["plans/validation-30-cards.csv", "plans/validation-30-cards.manifest.json"]],
]);

const prerequisite = message => {
    throw new Error(`MULTI_STUDY_HOSTILE_E2E_PREREQUISITE: ${message}`);
};

const required = name => {
    const value = process.env[name];
    if (!value) prerequisite(`${name} is required for the isolated multi-study runtime`);
    return value;
};

const externalFile = name => {
    const file = required(name);
    if (!path.isAbsolute(file) || !existsSync(file) || !statSync(file).isFile() || path.relative(root, file).startsWith("..") === false) {
        prerequisite(`${name} must name a readable file outside the repository`);
    }
    return file;
};

const runtime = () => {
    if (required("STUDY_MULTI_STUDY_E2E_ISOLATED_RUNTIME") !== "true") {
        prerequisite("STUDY_MULTI_STUDY_E2E_ISOLATED_RUNTIME must equal true");
    }
    const baseUrl = new URL(required("STUDY_MULTI_STUDY_E2E_BASE_URL"));
    if (baseUrl.protocol !== "https:") prerequisite("STUDY_MULTI_STUDY_E2E_BASE_URL must use HTTPS");
    let credentials;
    try {
        credentials = JSON.parse(readFileSync(externalFile("STUDY_MULTI_STUDY_E2E_CREDENTIALS_FILE"), "utf8"));
    } catch (_error) {
        prerequisite("STUDY_MULTI_STUDY_E2E_CREDENTIALS_FILE must contain JSON credentials");
    }
    if (!credentials || typeof credentials !== "object" || usernames.some(username => typeof credentials[username] !== "string" || !credentials[username])) {
        prerequisite("STUDY_MULTI_STUDY_E2E_CREDENTIALS_FILE must provide non-empty passwords for all six usernames");
    }
    return Object.freeze({
        baseUrl,
        virtualHost: required("STUDY_MULTI_STUDY_E2E_VIRTUAL_HOST"),
        credentials,
        database: Object.freeze({
            host: required("STUDY_MULTI_STUDY_E2E_DATABASE_HOST"),
            port: Number(required("STUDY_MULTI_STUDY_E2E_DATABASE_PORT")),
            user: required("STUDY_MULTI_STUDY_E2E_DATABASE_USER"),
            database: required("STUDY_MULTI_STUDY_E2E_DATABASE_NAME"),
            password: readFileSync(externalFile("STUDY_MULTI_STUDY_E2E_DATABASE_PASS_FILE"), "utf8").trim(),
        }),
    });
};

const config = runtime();

class CookieClient {
    constructor(username, password) {
        this.username = username;
        this.password = password;
        this.cookies = new Map();
        this.csrfToken = null;
    }

    cookieHeader() {
        return [...this.cookies.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
    }

    async request(requestPath, {method = "GET", headers = {}, body = ""} = {}) {
        const response = await new Promise((resolve, reject) => {
            const request = https.request({
                protocol: config.baseUrl.protocol,
                hostname: config.baseUrl.hostname,
                port: config.baseUrl.port,
                path: requestPath,
                method,
                servername: config.virtualHost,
                rejectUnauthorized: false,
                headers: {host: config.virtualHost, cookie: this.cookieHeader(), ...headers},
            }, result => {
                const chunks = [];
                result.on("data", chunk => chunks.push(chunk));
                result.on("end", () => resolve({status: result.statusCode, headers: result.headers, body: Buffer.concat(chunks).toString("utf8")}));
            });
            request.on("error", reject);
            request.end(body);
        });
        for (const value of response.headers["set-cookie"] || []) {
            const [pair] = value.split(";", 1);
            const separator = pair.indexOf("=");
            this.cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
        }
        return response;
    }
}

const form = values => new URLSearchParams(values).toString();
const escaped = value => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const origin = `https://${config.virtualHost}${config.baseUrl.port ? `:${config.baseUrl.port}` : ""}`;
const csrf = html => {
    const match = html.match(/<input\b[^>]*\bname=(?:["']csrf_token["']|csrf_token)\b[^>]*\bvalue=(?:["']([^"']+)["']|([^\s>]+))/i);
    assert.ok(match, "expected a synchronizer token in the rendered form");
    return match[1] || match[2];
};
const cardId = location => {
    const match = location?.match(/^\/queue\/([0-9a-f-]{36})$/i);
    assert.ok(match, `expected a canonical queue location, received ${location}`);
    return match[1];
};
const mutation = (client, requestPath, values, headers = {}) => client.request(requestPath, {
    method: "POST",
    headers: {origin, "content-type": "application/x-www-form-urlencoded", "x-csrf-token": client.csrfToken, ...headers},
    body: form(values),
});

const queueCard = async client => {
    const queue = await client.request("/queue");
    assert.equal(queue.status, 303, `${client.username} should have a pending card`);
    const id = cardId(queue.headers.location);
    const detail = await client.request(queue.headers.location);
    assert.equal(detail.status, 200);
    client.csrfToken = csrf(detail.body);
    return {id, html: detail.body};
};

const login = async client => {
    const page = await client.request("/login");
    assert.equal(page.status, 200);
    const response = await client.request("/login", {
        method: "POST",
        headers: {origin, "content-type": "application/x-www-form-urlencoded"},
        body: form({username: client.username, password: client.password, csrf_token: csrf(page.body)}),
    });
    assert.equal(response.status, 302, `${client.username} did not authenticate`);
    assert.equal(response.headers.location, "/queue");
    const sessionCookie = response.headers["set-cookie"]?.find(value => value.startsWith("__Host-session="));
    assert.ok(sessionCookie, `${client.username} did not receive a session cookie`);
    assert.match(sessionCookie, /;\s*Secure\b/i);
    assert.match(sessionCookie, /;\s*HttpOnly\b/i);
    assert.match(sessionCookie, /;\s*SameSite=Lax\b/i);
    assert.match(client.cookieHeader(), /__Host-session=/, `${client.username} did not receive a session cookie`);
};

const privateState = async pool => (await pool.query(
    `SELECT jsonb_build_object(
        'categories', (SELECT jsonb_agg(jsonb_build_object('study', study_key, 'participant', participant_key, 'name', raw_name) ORDER BY study_key, participant_key, raw_name)
                       FROM participant_category category JOIN study study ON study.id = category.study_id JOIN study_participant participant ON participant.study_id = category.study_id AND participant.reviewer_id = category.participant_id),
        'classifications', (SELECT jsonb_agg(jsonb_build_object('study', study_key, 'participant', participant_key, 'card', source_card_id, 'category', category_id, 'remarks', remarks, 'revision', revision) ORDER BY study_key, participant_key, source_card_id)
                            FROM pr_classification classification JOIN study study ON study.id = classification.study_id JOIN study_participant participant ON participant.study_id = classification.study_id AND participant.reviewer_id = classification.participant_id JOIN study_card card ON card.study_id = classification.study_id AND card.pr_card_id = classification.pr_card_id),
        'discards', (SELECT jsonb_agg(jsonb_build_object('study', study_key, 'participant', participant_key, 'card', source_card_id, 'reason', reason) ORDER BY study_key, participant_key, source_card_id)
                     FROM pr_discard discard JOIN study study ON study.id = discard.study_id JOIN study_participant participant ON participant.study_id = discard.study_id AND participant.reviewer_id = discard.participant_id JOIN study_card card ON card.study_id = discard.study_id AND card.pr_card_id = discard.pr_card_id)
    )::text AS snapshot`,
)).rows[0].snapshot;

const persistentFingerprint = (pool, studyKey) => fingerprintPersistentStudy({
    pool,
    studyKey,
    artifactPaths: sourceArtifacts.get(studyKey).map(file => path.join(root, file)),
});

const completeValidationQueue = async (client, categoryId, {leaveLastPending = false} = {}) => {
    const completionCount = leaveLastPending ? 29 : 30;
    for (let ordinal = 0; ordinal < completionCount; ordinal += 1) {
        const {id} = await queueCard(client);
        const classify = ordinal % 2 === 0;
        const response = await mutation(client, `/queue/${id}/${classify ? "classify" : "discard"}`, classify
            ? {category_id: categoryId, expected_revision: "0", ...(ordinal === 0 ? {} : {remarks: `validated-${client.username}-${ordinal}`})}
            : {expected_revision: "0", reason: `discarded-${client.username}-${ordinal}`});
        assert.equal(response.status, 303, `${client.username} could not complete card ${ordinal}`);
    }
    assert.equal((await client.request("/queue")).status, leaveLastPending ? 303 : 200,
        `${client.username} queue completion should match its reserved pending-card count`);
};

const completeStudyForExport = async (pool, {studyId, participantId, categoryId, pendingCardId}) => pool.query(
    `INSERT INTO pr_classification(pr_card_id, participant_id, category_id, remarks, study_id)
     SELECT card.pr_card_id, $2, $3, 'synthetic export completion', $1
     FROM study_card card
     WHERE card.study_id = $1
       AND ($4::uuid IS NULL OR card.pr_card_id <> $4)
       AND NOT EXISTS (SELECT FROM pr_classification classification
                       WHERE classification.study_id = $1 AND classification.participant_id = $2 AND classification.pr_card_id = card.pr_card_id)
       AND NOT EXISTS (SELECT FROM pr_discard discard
                       WHERE discard.study_id = $1 AND discard.participant_id = $2 AND discard.pr_card_id = card.pr_card_id)`,
    [studyId, participantId, categoryId, pendingCardId],
);

const createSnapshotBarrier = pool => {
    let announceSnapshot;
    let resumeSnapshot;
    let paused = false;
    const snapshotEstablished = new Promise(resolve => {
        announceSnapshot = resolve;
    });
    const resumed = new Promise(resolve => {
        resumeSnapshot = resolve;
    });

    return {
        pool: {
            connect: async () => {
                const client = await pool.connect();
                return {
                    query: async (...args) => {
                        const result = await client.query(...args);
                        const sql = typeof args[0] === "string" ? args[0] : args[0]?.text;
                        if (!paused && sql?.includes("study-export:study")) {
                            paused = true;
                            announceSnapshot();
                            await resumed;
                        }
                        return result;
                    },
                    release: error => client.release(error),
                };
            },
        },
        snapshotEstablished,
        release: () => resumeSnapshot(),
    };
};

const parseComparisonCsv = (csv, cardCount, participantCount) => {
    const records = parse(csv, {record_delimiter: "\r\n"});
    const expectedColumns = 2 + participantCount * 3;
    const expectedHeader = ["pr_id", "pr_url"];
    for (let ordinal = 1; ordinal <= participantCount; ordinal += 1) {
        expectedHeader.push(
            `categoria_usuario_${ordinal}`,
            `descripcion_categoria_usuario_${ordinal}`,
            `comentario_clasificacion_usuario_${ordinal}`,
        );
    }

    assert.equal(records.length, cardCount + 1, `the ${cardCount}-card sample should produce exactly one CSV row per card`);
    assert.deepEqual(records[0], expectedHeader, "the export should contain only included participant blocks");
    assert.ok(records.every(record => record.length === expectedColumns), "all rows should retain the expected CSV column count");
    return records;
};

test("isolated hostile E2E binds six sessions, private decisions, exports, and progress to the exact 369/30 study memberships", async () => {
    const pool = new Pool(config.database);
    let complete = false;
    try {
        const {rows: studies} = await pool.query(
            "SELECT study_key, expected_card_count, bootstrap_state FROM study WHERE study_key = ANY($1) ORDER BY expected_card_count DESC",
            [[currentStudyKey, validationStudyKey]],
        );
        assert.deepEqual(studies, [
            {study_key: currentStudyKey, expected_card_count: 369, bootstrap_state: "READY"},
            {study_key: validationStudyKey, expected_card_count: 30, bootstrap_state: "READY"},
        ]);
        const {rows: [ready]} = await pool.query("SELECT COUNT(*)::integer AS studies FROM study WHERE bootstrap_state = 'READY'");
        assert.deepEqual(ready, {studies: 2});
        const [primaryMembership, validationMembership] = await Promise.all([
            pool.query(
                "SELECT source_card_id, pr_card_id FROM study_card WHERE study_id = (SELECT id FROM study WHERE study_key = $1) ORDER BY ordinal",
                [currentStudyKey],
            ),
            pool.query(
                "SELECT source_card_id, pr_card_id FROM study_card WHERE study_id = (SELECT id FROM study WHERE study_key = $1) ORDER BY ordinal",
                [validationStudyKey],
            ),
        ]);
        const primaryCards = primaryMembership.rows;
        const validationCards = validationMembership.rows;
        assert.equal(primaryCards.length, 369);
        assert.equal(validationCards.length, 30);
        const {rows: membershipRows} = await pool.query(
            `SELECT study.study_key, participant.participant_key, card.source_card_id, card.ordinal
             FROM study JOIN study_participant participant ON participant.study_id = study.id
             JOIN study_card card ON card.study_id = study.id
             WHERE study.study_key = ANY($1)
             ORDER BY study.expected_card_count DESC, participant.ordinal, card.ordinal`,
            [[currentStudyKey, validationStudyKey]],
        );
        for (const [studyKey, expectedIds] of canonicalSourceIds) {
            for (const participantKey of participantKeys) {
                assert.deepEqual(
                    membershipRows.filter(row => row.study_key === studyKey && row.participant_key === participantKey)
                        .map(row => row.source_card_id),
                    expectedIds,
                    `${studyKey}/${participantKey} must receive the complete canonical order`,
                );
            }
        }
        const {rows: validationQueues} = await pool.query(
            `SELECT participant.participant_key, COUNT(card.pr_card_id)::integer AS cards
             FROM study validation JOIN study_participant participant ON participant.study_id = validation.id
             JOIN study_card card ON card.study_id = validation.id
             WHERE validation.study_key = $1 GROUP BY participant.participant_key ORDER BY participant.participant_key`,
            [validationStudyKey],
        );
        assert.deepEqual(validationQueues, [
            {participant_key: "diego", cards: 30},
            {participant_key: "javier", cards: 30},
            {participant_key: "pablo", cards: 30},
        ]);
        const {rows: [crossStudyCards]} = await pool.query(
            `SELECT COUNT(*)::integer AS count
             FROM study_card primary_card JOIN study_card validation_card ON validation_card.source_card_id = primary_card.source_card_id
             WHERE primary_card.study_id = (SELECT id FROM study WHERE study_key = $1)
               AND validation_card.study_id = (SELECT id FROM study WHERE study_key = $2)`,
            [currentStudyKey, validationStudyKey],
        );
        assert.deepEqual(crossStudyCards, {count: 0});

        const clients = new Map(usernames.map(username => [username, new CookieClient(username, config.credentials[username])]));
        await Promise.all([...clients.values()].map(login));
        const initialCards = await Promise.all([...clients.values()].map(queueCard));
        assert.deepEqual(initialCards.slice(0, 3).map(card => card.id), Array(3).fill(primaryCards[0].pr_card_id));
        assert.deepEqual(initialCards.slice(3).map(card => card.id), Array(3).fill(validationCards[0].pr_card_id));
        const cookieValues = [...clients.values()].map(client => client.cookieHeader());
        assert.equal(new Set(cookieValues).size, 6, "six logins must create independent Secure session cookies");
        assert.equal(new Set([...clients.values()].map(client => client.csrfToken)).size, 6,
            "six logins must create independent synchronizer tokens");
        const sessionIds = [...clients.values()].map(client => client.cookies.get("__Host-session").split(".", 1)[0]);
        const {rows: sessionBindings} = await pool.query(
            `SELECT account.normalized_username, study.study_key,
                    session.study_id = account.study_id AS study_bound,
                    session.reviewer_id = account.reviewer_id AS participant_bound
             FROM app_session session JOIN participant_account account ON account.id = session.account_id
             JOIN study ON study.id = account.study_id
             WHERE session.session_id = ANY($1::text[]) ORDER BY account.normalized_username`,
            [sessionIds],
        );
        assert.deepEqual(sessionBindings.map(row => [row.normalized_username, row.study_key, row.study_bound, row.participant_bound]), [
            ["diego", currentStudyKey, true, true],
            ["diego-30", validationStudyKey, true, true],
            ["javier", currentStudyKey, true, true],
            ["javier-30", validationStudyKey, true, true],
            ["pablo", currentStudyKey, true, true],
            ["pablo-30", validationStudyKey, true, true],
        ]);
        assert.equal(new Set(sessionIds).size, 6, "six authenticated accounts must own six server-side sessions");
        const membership = await pool.query(
            `SELECT study.expected_card_count, card.pr_card_id
             FROM unnest($1::uuid[]) requested(pr_card_id)
             JOIN study_card card ON card.pr_card_id = requested.pr_card_id
             JOIN study ON study.id = card.study_id`,
            [initialCards.map(card => card.id)],
        );
        assert.deepEqual([...new Set(membership.rows.map(row => row.expected_card_count))].sort(), [30, 369]);

        const categories = new Map();
        for (const username of usernames) {
            const client = clients.get(username);
            const response = await mutation(client, "/categories", {
                name: categoryName(username),
                ...(username === "javier" ? {definition: "Private primary definition"} : {}),
                ...(username === "javier-30" ? {definition: "Private validation definition"} : {}),
            });
            assert.equal(response.status, 201);
            categories.set(username, JSON.parse(response.body).id);
        }
        const categorizedCards = await Promise.all([...clients.values()].map(queueCard));
        for (const [index, username] of usernames.entries()) {
            assert.match(categorizedCards[index].html, new RegExp(escaped(categoryName(username))));
            for (const other of usernames.filter(name => name !== username)) {
                assert.doesNotMatch(categorizedCards[index].html, new RegExp(escaped(categoryName(other))));
            }
        }

        const currentCategoryId = categories.get("javier");
        const foreignCurrentCard = {id: primaryCards[0].pr_card_id};
        const javierValidation = clients.get("javier-30");
        const stateBeforeAttacks = await privateState(pool);
        const hostile = await Promise.all([
            javierValidation.request(`/queue/${foreignCurrentCard.id}`),
            javierValidation.request(`/queue?study_id=${encodeURIComponent(currentStudyKey)}&participant_id=foreign`),
            mutation(javierValidation, `/queue/${validationCards[0].pr_card_id}/classify`, {
                category_id: currentCategoryId, expected_revision: "0", study_id: currentStudyKey, participant_id: "foreign",
            }),
            mutation(javierValidation, "/categories", {name: "cookie-attack"}, {cookie: clients.get("javier").cookieHeader()}),
            mutation(javierValidation, "/categories", {name: "csrf-attack"}, {"x-csrf-token": clients.get("javier").csrfToken}),
            mutation(javierValidation, "/categories", {name: "origin-attack"}, {origin: "https://attacker.invalid"}),
            javierValidation.request("/export?study_id=pr-card-sorting-local&participant_id=foreign"),
        ]);
        assert.deepEqual(hostile.map(response => response.status), [404, 303, 404, 403, 403, 403, 200]);
        assert.equal(hostile[1].headers.location, `/queue/${validationCards[0].pr_card_id}`);
        assert.doesNotMatch(`${hostile[0].body}${hostile[2].body}`, /Private primary definition/);
        for (const username of usernames) assert.doesNotMatch(hostile[6].body, new RegExp(escaped(categoryName(username))));
        assert.equal(await privateState(pool), stateBeforeAttacks,
            "hostile URL, query, form, cookie, and CSRF requests must not mutate either study");
        const loginPage = await clients.get("javier").request("/login");
        assert.doesNotMatch(loginPage.body, /<select|\b(?:study_id|participant_id)\b/i);

        const validationBeforePrimary = await persistentFingerprint(pool, validationStudyKey);
        const javier = clients.get("javier");
        const diego = clients.get("diego");
        const pablo = clients.get("pablo");
        const firstPrimaryCard = primaryCards[0].pr_card_id;
        const secondPrimaryCard = primaryCards[1].pr_card_id;
        const thirdPrimaryCard = primaryCards[2].pr_card_id;
        const classified = await mutation(javier, `/queue/${firstPrimaryCard}/classify`, {
            category_id: categories.get("javier"), expected_revision: "0", remarks: "Initial private note",
        });
        assert.equal(classified.status, 303);
        assert.equal(classified.headers.location, `/queue/${secondPrimaryCard}`);
        const edited = await mutation(javier, `/queue/${firstPrimaryCard}/classify`, {
            category_id: categories.get("javier"), expected_revision: "1", remarks: "Edited private note",
        });
        assert.equal(edited.status, 303);
        const withoutNote = await mutation(javier, `/queue/${secondPrimaryCard}/classify`, {
            category_id: categories.get("javier"), expected_revision: "0",
        });
        assert.equal(withoutNote.status, 303);
        assert.equal(withoutNote.headers.location, `/queue/${thirdPrimaryCard}`);
        const discarded = await mutation(javier, `/queue/${thirdPrimaryCard}/discard`, {
            expected_revision: "0", reason: "outside scope",
        });
        assert.equal(discarded.status, 303);
        const {rows: [nextPrimaryCard]} = await pool.query(
            `SELECT card.pr_card_id
             FROM study JOIN study_participant participant ON participant.study_id = study.id
             JOIN study_card card ON card.study_id = study.id
             LEFT JOIN pr_classification classification ON classification.study_id = study.id
                 AND classification.participant_id = participant.reviewer_id AND classification.pr_card_id = card.pr_card_id
             LEFT JOIN pr_discard discard ON discard.study_id = study.id
                 AND discard.participant_id = participant.reviewer_id AND discard.pr_card_id = card.pr_card_id
             WHERE study.study_key = $1 AND participant.participant_key = 'javier'
               AND classification.id IS NULL AND discard.pr_card_id IS NULL
             ORDER BY card.ordinal LIMIT 1`,
            [currentStudyKey],
        );
        assert.equal(discarded.headers.location, `/queue/${nextPrimaryCard.pr_card_id}`);
        const diegoDecision = await mutation(diego, `/queue/${firstPrimaryCard}/classify`, {
            category_id: categories.get("diego"), expected_revision: "0",
        });
        assert.equal(diegoDecision.status, 303);
        const pabloDecision = await mutation(pablo, `/queue/${firstPrimaryCard}/discard`, {
            expected_revision: "0", reason: "outside scope",
        });
        assert.equal(pabloDecision.status, 303);
        const {rows: primaryDecisions} = await pool.query(
            `SELECT participant.participant_key,
                    classification.id IS NOT NULL AS classified,
                    discard.pr_card_id IS NOT NULL AS discarded
             FROM study JOIN study_participant participant ON participant.study_id = study.id
             JOIN study_card card ON card.study_id = study.id AND card.source_card_id = $2
             LEFT JOIN pr_classification classification ON classification.study_id = study.id
                 AND classification.participant_id = participant.reviewer_id AND classification.pr_card_id = card.pr_card_id
             LEFT JOIN pr_discard discard ON discard.study_id = study.id
                 AND discard.participant_id = participant.reviewer_id AND discard.pr_card_id = card.pr_card_id
             WHERE study.study_key = $1 ORDER BY participant.ordinal`,
            [currentStudyKey, primaryCards[0].source_card_id],
        );
        assert.deepEqual(primaryDecisions, [
            {participant_key: "javier", classified: true, discarded: false},
            {participant_key: "diego", classified: true, discarded: false},
            {participant_key: "pablo", classified: false, discarded: true},
        ]);
        const javierCard = await javier.request(`/queue/${firstPrimaryCard}`);
        assert.match(javierCard.body, /Edited private note/);
        for (const client of [diego, pablo]) {
            const detail = await client.request(`/queue/${firstPrimaryCard}`);
            assert.doesNotMatch(detail.body, /Edited private note|Private primary definition/);
        }
        for (const [username, client] of [["javier", javier], ["diego", diego], ["pablo", pablo]]) {
            const progress = await client.request("/progress?study_id=foreign&participant_id=foreign");
            assert.equal(progress.status, 200);
            assert.match(progress.body, /369 assigned cards/);
            assert.match(progress.body, new RegExp(`${username === "javier" ? 6 : 1} of 369 cards completed`));
        }
        const primaryBeforeValidation = await persistentFingerprint(pool, currentStudyKey);
        assert.equal(await persistentFingerprint(pool, validationStudyKey), validationBeforePrimary,
            "primary decisions must not alter persistent validation 30 state");

        const validationClients = ["javier-30", "diego-30", "pablo-30"].map(username => clients.get(username));
        await completeValidationQueue(validationClients[0], categories.get("javier-30"), {leaveLastPending: true});
        await completeValidationQueue(validationClients[1], categories.get("diego-30"));
        const pendingValidationCard = await queueCard(validationClients[0]);
        assert.equal(pendingValidationCard.id, validationCards.at(-1).pr_card_id);
        const validationEdit = await mutation(validationClients[0], `/queue/${validationCards[0].pr_card_id}/classify`, {
            category_id: categories.get("javier-30"), expected_revision: "1", remarks: "Edited private validation note",
        });
        assert.equal(validationEdit.status, 303);
        const validationPartnerCard = await validationClients[1].request(`/queue/${validationCards[0].pr_card_id}`);
        assert.equal(validationPartnerCard.status, 200);
        assert.doesNotMatch(validationPartnerCard.body, /Edited private validation note|Private validation definition/);
        const incompleteValidationExport = await mutation(validationClients[0], "/export/download", {});
        assert.equal(incompleteValidationExport.status, 403);
        assert.match(incompleteValidationExport.headers["content-type"], /^text\/plain/);
        assert.doesNotMatch(incompleteValidationExport.body, /^pr_id,pr_url/m);
        const completedValidationCard = await mutation(validationClients[0], `/queue/${pendingValidationCard.id}/classify`, {
            category_id: categories.get("javier-30"), expected_revision: "0",
        });
        assert.equal(completedValidationCard.status, 303);
        const validationTwoParticipantExport = await mutation(validationClients[0], "/export/download", {});
        assert.equal(validationTwoParticipantExport.status, 200);
        assert.match(validationTwoParticipantExport.headers["content-type"], /^text\/csv;\s*charset=utf-8$/i);
        const validationTwoParticipantRecords = parseComparisonCsv(validationTwoParticipantExport.body, 30, 2);
        assert.equal(validationTwoParticipantRecords[0].length, 8);
        assert.equal(validationTwoParticipantRecords[1][4], "Edited private validation note");

        const {rows: [validationScope]} = await pool.query(
            `SELECT study.id AS study_id, participant.reviewer_id AS participant_id
             FROM study JOIN study_participant participant ON participant.study_id = study.id
             WHERE study.study_key = $1 AND participant.participant_key = 'javier'`,
            [validationStudyKey],
        );
        assert.ok(validationScope, "authenticated export participant must belong to the validation study");
        const snapshotBarrier = createSnapshotBarrier(pool);
        const snapshotExport = createStudyComparisonExport({
            pool: snapshotBarrier.pool,
            context: {studyId: validationScope.study_id, participantId: validationScope.participant_id},
        });
        try {
            const reachedSnapshot = await Promise.race([
                snapshotBarrier.snapshotEstablished.then(() => true),
                snapshotExport.then(() => false),
            ]);
            assert.equal(reachedSnapshot, true, "export should pause immediately after its first study SELECT establishes the snapshot");
            await completeValidationQueue(validationClients[2], categories.get("pablo-30"));
            snapshotBarrier.release();
            const snapshotRecords = parseComparisonCsv(await snapshotExport, 30, 2);
            assert.equal(snapshotRecords.some(record => record.includes(categoryName("pablo-30"))
                || record.some(value => value.startsWith("validated-pablo-30-"))), false,
            "a participant completing after the snapshot must be entirely excluded");
            process.stdout.write("snapshot_export_receipt cards=30 participants=2 columns=8\n");
        } finally {
            snapshotBarrier.release();
            await snapshotExport;
        }

        const validationThreeParticipantExport = await mutation(validationClients[0], "/export/download", {});
        assert.equal(validationThreeParticipantExport.status, 200);
        const validationThreeParticipantRecords = parseComparisonCsv(validationThreeParticipantExport.body, 30, 3);
        assert.equal(validationThreeParticipantRecords[0].length, 11);
        assert.equal(validationThreeParticipantRecords.some(record => record.includes(categoryName("pablo-30"))
            || record.some(value => value.startsWith("validated-pablo-30-"))), true);
        for (const client of validationClients) {
            const progress = await client.request("/progress?study_id=foreign&participant_id=foreign");
            assert.equal(progress.status, 200);
            assert.match(progress.body, /30 assigned cards/);
            assert.match(progress.body, /30 of 30 cards completed/);
            for (const other of validationClients.filter(otherClient => otherClient !== client)) {
                assert.doesNotMatch(progress.body, new RegExp(escaped(categoryName(other.username))));
            }
        }
        process.stdout.write("export30_receipt pending=29/30 rejected=true complete=30 rows=30 columns=8,11\n");
        assert.equal(await persistentFingerprint(pool, currentStudyKey), primaryBeforeValidation,
            "validation decisions must not alter persistent primary 369 state");

        const {rows: [primaryScope]} = await pool.query(
            `SELECT study.id AS study_id, participant.reviewer_id AS participant_id
             FROM study JOIN study_participant participant ON participant.study_id = study.id
             WHERE study.study_key = $1 AND participant.participant_key = 'javier'`,
            [currentStudyKey],
        );
        assert.ok(primaryScope);
        const {rows: [diegoScope]} = await pool.query(
            `SELECT study.id AS study_id, participant.reviewer_id AS participant_id
             FROM study JOIN study_participant participant ON participant.study_id = study.id
             WHERE study.study_key = $1 AND participant.participant_key = 'diego'`,
            [currentStudyKey],
        );
        const {rows: [pabloScope]} = await pool.query(
            `SELECT study.id AS study_id, participant.reviewer_id AS participant_id
             FROM study JOIN study_participant participant ON participant.study_id = study.id
             WHERE study.study_key = $1 AND participant.participant_key = 'pablo'`,
            [currentStudyKey],
        );
        await completeStudyForExport(pool, {
            studyId: primaryScope.study_id, participantId: primaryScope.participant_id,
            categoryId: categories.get("javier"), pendingCardId: primaryCards.at(-1).pr_card_id,
        });
        await completeStudyForExport(pool, {
            studyId: diegoScope.study_id, participantId: diegoScope.participant_id,
            categoryId: categories.get("diego"), pendingCardId: null,
        });
        const {rows: exportProgress} = await pool.query(
            `SELECT participant.participant_key,
                    COUNT(*) FILTER (WHERE classification.id IS NOT NULL OR discard.pr_card_id IS NOT NULL)::integer AS terminal
             FROM study JOIN study_participant participant ON participant.study_id = study.id
             JOIN study_card card ON card.study_id = study.id
             LEFT JOIN pr_classification classification ON classification.study_id = study.id
                 AND classification.participant_id = participant.reviewer_id AND classification.pr_card_id = card.pr_card_id
             LEFT JOIN pr_discard discard ON discard.study_id = study.id
                 AND discard.participant_id = participant.reviewer_id AND discard.pr_card_id = card.pr_card_id
             WHERE study.study_key = $1 GROUP BY participant.participant_key ORDER BY participant.participant_key`,
            [currentStudyKey],
        );
        assert.deepEqual(exportProgress, [
            {participant_key: "diego", terminal: 369},
            {participant_key: "javier", terminal: 368},
            {participant_key: "pablo", terminal: 1},
        ]);
        const incompletePrimaryExport = await mutation(javier, "/export/download", {});
        assert.equal(incompletePrimaryExport.status, 403);
        assert.match(incompletePrimaryExport.headers["content-type"], /^text\/plain/);
        assert.doesNotMatch(incompletePrimaryExport.body, /^pr_id,pr_url/m);
        const pendingPrimaryCard = await queueCard(javier);
        assert.equal(pendingPrimaryCard.id, primaryCards.at(-1).pr_card_id);
        const completedPrimaryCard = await mutation(javier, `/queue/${pendingPrimaryCard.id}/classify`, {
            category_id: categories.get("javier"), expected_revision: "0",
        });
        assert.equal(completedPrimaryCard.status, 303);
        const primaryTwoParticipantExport = await mutation(javier, "/export/download", {});
        assert.equal(primaryTwoParticipantExport.status, 200);
        const primaryTwoParticipantRecords = parseComparisonCsv(primaryTwoParticipantExport.body, 369, 2);
        assert.equal(primaryTwoParticipantRecords[0].length, 8);
        assert.equal(primaryTwoParticipantRecords.some(record => record.includes(categoryName("pablo"))), false);
        process.stdout.write("export369_receipt pending=368/369 rejected=true complete=369 rows=369 columns=8\n");

        await completeStudyForExport(pool, {
            studyId: pabloScope.study_id, participantId: pabloScope.participant_id,
            categoryId: categories.get("pablo"), pendingCardId: primaryCards.at(-1).pr_card_id,
        });
        const pendingPabloCard = await queueCard(pablo);
        assert.equal(pendingPabloCard.id, primaryCards.at(-1).pr_card_id);
        const completedPabloCard = await mutation(pablo, `/queue/${pendingPabloCard.id}/classify`, {
            category_id: categories.get("pablo"), expected_revision: "0",
        });
        assert.equal(completedPabloCard.status, 303);
        const primaryThreeParticipantExport = await mutation(javier, "/export/download", {});
        assert.equal(primaryThreeParticipantExport.status, 200);
        const primaryThreeParticipantRecords = parseComparisonCsv(primaryThreeParticipantExport.body, 369, 3);
        assert.equal(primaryThreeParticipantRecords[0].length, 11);
        assert.ok(primaryThreeParticipantRecords.some(record => record.includes(categoryName("pablo"))));
        process.stdout.write("export369_three_participant_receipt rows=369 columns=11\n");

        const {rows: [validationCompletion]} = await pool.query(
            `SELECT COUNT(*) FILTER (WHERE classification.id IS NOT NULL OR discard.pr_card_id IS NOT NULL)::integer AS terminal
             FROM study validation JOIN study_participant participant ON participant.study_id = validation.id
             JOIN study_card card ON card.study_id = validation.id
             LEFT JOIN pr_classification classification ON classification.study_id = validation.id
                 AND classification.participant_id = participant.reviewer_id AND classification.pr_card_id = card.pr_card_id
             LEFT JOIN pr_discard discard ON discard.study_id = validation.id
                 AND discard.participant_id = participant.reviewer_id AND discard.pr_card_id = card.pr_card_id
             WHERE validation.study_key = $1`,
            [validationStudyKey],
        );
        assert.equal(validationCompletion.terminal, 90);
        const {rows: [privacy]} = await pool.query(
            `SELECT COUNT(*) FILTER (WHERE classification.id IS NOT NULL AND category.id IS NULL)::integer AS unowned_classifications,
                    COUNT(*) FILTER (WHERE classification.id IS NOT NULL AND discard.pr_card_id IS NOT NULL)::integer AS contradictory_terminal_states
             FROM pr_classification classification
             LEFT JOIN participant_category category ON category.id = classification.category_id
                 AND category.study_id = classification.study_id AND category.participant_id = classification.participant_id
             FULL JOIN pr_discard discard ON discard.study_id = classification.study_id
                 AND discard.participant_id = classification.participant_id AND discard.pr_card_id = classification.pr_card_id
             WHERE COALESCE(classification.study_id, discard.study_id) = (SELECT id FROM study WHERE study_key = $1)`,
            [validationStudyKey],
        );
        assert.deepEqual(privacy, {unowned_classifications: 0, contradictory_terminal_states: 0});
        for (const client of clients.values()) {
            const logout = await mutation(client, "/logout", {});
            assert.equal(logout.status, 302);
            assert.equal(logout.headers.location, "/login");
            assert.equal((await client.request("/queue")).status, 401);
        }
        complete = true;
    } finally {
        await pool.end();
    }
    if (complete) process.stdout.write("STAGE_MULTI_STUDY_HOSTILE_E2E_OK\nMULTI_STUDY_HOSTILE_E2E_OK\n");
});
