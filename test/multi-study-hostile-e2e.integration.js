import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {existsSync, readFileSync, statSync} from "node:fs";
import https from "node:https";
import path from "node:path";
import test from "node:test";
import pg from "pg";

const {Pool} = pg;
const root = path.resolve(new URL("..", import.meta.url).pathname);
const currentStudyKey = "pr-card-sorting-local";
const validationStudyKey = "pr-card-sorting-validation-30";
const usernames = Object.freeze(["javier", "diego", "pablo", "javier-30", "diego-30", "pablo-30"]);

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
    const output = required("STUDY_MULTI_STUDY_E2E_EXPORT_OUTPUT");
    if (!path.isAbsolute(output) || existsSync(output) || !existsSync(path.dirname(output))
        || path.relative(root, output).startsWith("..") === false) {
        prerequisite("STUDY_MULTI_STUDY_E2E_EXPORT_OUTPUT must be a new path outside the repository");
    }
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
        databasePassFile: externalFile("STUDY_MULTI_STUDY_E2E_DATABASE_PASS_FILE"),
        exportSecretFile: externalFile("STUDY_MULTI_STUDY_E2E_EXPORT_HMAC_SECRET_FILE"),
        output,
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

const currentFingerprint = async pool => (await pool.query(
    `SELECT jsonb_build_object('study', jsonb_build_object('key', study_key, 'config', config, 'count', expected_card_count, 'state', bootstrap_state, 'checksum', source_checksum),
        'cards', (SELECT jsonb_agg(jsonb_build_object('source', membership.source_card_id, 'ordinal', membership.ordinal, 'checksum', membership.source_checksum, 'content', card.content_checksum) ORDER BY membership.ordinal) FROM study_card membership JOIN pr_cards card ON card.id = membership.pr_card_id WHERE membership.study_id = study.id),
        'members', (SELECT jsonb_agg(jsonb_build_object('key', participant_key, 'ordinal', ordinal) ORDER BY ordinal) FROM study_participant WHERE study_id = study.id),
        'accounts', (SELECT jsonb_agg(jsonb_build_object('username', normalized_username, 'version', credential_version, 'enabled', enabled) ORDER BY normalized_username) FROM participant_account WHERE study_id = study.id),
        'categories', (SELECT jsonb_agg(jsonb_build_object('participant', participant_id, 'name', raw_name) ORDER BY participant_id, raw_name) FROM participant_category WHERE study_id = study.id),
        'classifications', (SELECT jsonb_agg(jsonb_build_object('participant', participant_id, 'card', pr_card_id, 'category', category_id, 'remarks', remarks, 'revision', revision) ORDER BY participant_id, pr_card_id) FROM pr_classification WHERE study_id = study.id),
        'discards', (SELECT jsonb_agg(jsonb_build_object('participant', participant_id, 'card', pr_card_id, 'reason', reason) ORDER BY participant_id, pr_card_id) FROM pr_discard WHERE study_id = study.id),
        'promotion', (SELECT jsonb_agg(jsonb_build_object('run', run_id, 'checksum', source_checksum, 'promoted_at', promoted_at) ORDER BY run_id) FROM study_enrichment_promotion WHERE study_id = study.id))::text AS fingerprint
     FROM study WHERE study_key = $1`, [currentStudyKey],
)).rows[0]?.fingerprint;

const completeValidationQueue = async (client, categoryId, sharedCard, oppositeDecision) => {
    for (let ordinal = 0; ordinal < 30; ordinal += 1) {
        const {id} = await queueCard(client);
        const classify = id === sharedCard ? oppositeDecision === "CLASSIFIED" : ordinal % 2 === 0;
        const response = await mutation(client, `/queue/${id}/${classify ? "classify" : "discard"}`, classify
            ? {category_id: categoryId, expected_revision: "0", remarks: `validated-${client.username}-${ordinal}`}
            : {expected_revision: "0", reason: `discarded-${client.username}-${ordinal}`});
        assert.equal(response.status, 303, `${client.username} could not complete card ${ordinal}`);
    }
    assert.equal((await client.request("/queue")).status, 200, `${client.username} queue should be complete`);
};

test("isolated hostile E2E keeps two READY studies, six authenticated contexts, and all private decisions isolated", async () => {
    const pool = new Pool(config.database);
    let complete = false;
    try {
        const {rows: studies} = await pool.query("SELECT study_key, expected_card_count, bootstrap_state FROM study WHERE study_key = ANY($1) ORDER BY expected_card_count DESC", [[currentStudyKey, validationStudyKey]]);
        assert.deepEqual(studies, [
            {study_key: currentStudyKey, expected_card_count: 300, bootstrap_state: "READY"},
            {study_key: validationStudyKey, expected_card_count: 30, bootstrap_state: "READY"},
        ]);
        const {rows: [ready]} = await pool.query("SELECT COUNT(*)::integer AS studies FROM study WHERE bootstrap_state = 'READY'");
        assert.deepEqual(ready, {studies: 2});
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
        const {rows: [sharedMembership]} = await pool.query(
            `SELECT COUNT(*)::integer AS cards FROM study_card current_card JOIN study_card validation_card ON validation_card.source_card_id = current_card.source_card_id
             WHERE current_card.study_id = (SELECT id FROM study WHERE study_key = $1)
               AND validation_card.study_id = (SELECT id FROM study WHERE study_key = $2)`,
            [currentStudyKey, validationStudyKey],
        );
        assert.deepEqual(sharedMembership, {cards: 30});
        const fingerprintBefore = await currentFingerprint(pool);
        assert.ok(fingerprintBefore, "the current 300-card study must exist before hostile validation");
        const {rows: [shared]} = await pool.query(
            `SELECT current_card.source_card_id, current_card.pr_card_id AS current_card_id, validation_card.pr_card_id AS validation_card_id,
                    current_category.id AS current_category_id, current_category.raw_name AS current_category_name
             FROM study current_study JOIN study_participant current_participant ON current_participant.study_id = current_study.id AND current_participant.participant_key = 'javier'
             JOIN pr_classification current_classification ON current_classification.study_id = current_study.id AND current_classification.participant_id = current_participant.reviewer_id
             JOIN participant_category current_category ON current_category.id = current_classification.category_id
             JOIN study_card current_card ON current_card.study_id = current_study.id AND current_card.pr_card_id = current_classification.pr_card_id
             JOIN study validation_study ON validation_study.study_key = $2 JOIN study_participant validation_participant ON validation_participant.study_id = validation_study.id AND validation_participant.participant_key = 'javier'
             JOIN study_card validation_card ON validation_card.study_id = validation_study.id AND validation_card.source_card_id = current_card.source_card_id
             LEFT JOIN pr_classification validation_classification ON validation_classification.study_id = validation_study.id AND validation_classification.participant_id = validation_participant.reviewer_id AND validation_classification.pr_card_id = validation_card.pr_card_id
             LEFT JOIN pr_discard validation_discard ON validation_discard.study_id = validation_study.id AND validation_discard.participant_id = validation_participant.reviewer_id AND validation_discard.pr_card_id = validation_card.pr_card_id
             WHERE current_study.study_key = $1 AND validation_classification.id IS NULL AND validation_discard.pr_card_id IS NULL LIMIT 1`,
            [currentStudyKey, validationStudyKey],
        );
        assert.ok(shared, "isolated runtime must preseed one current-study javier classification whose source card is pending in validation");
        const {rows: [foreignCurrentCard]} = await pool.query(
            `SELECT current_card.pr_card_id AS card_id
             FROM study current_study
             JOIN study_card current_card ON current_card.study_id = current_study.id
             LEFT JOIN study validation_study ON validation_study.study_key = $2
             LEFT JOIN study_card validation_card ON validation_card.study_id = validation_study.id AND validation_card.source_card_id = current_card.source_card_id
             WHERE current_study.study_key = $1 AND validation_card.pr_card_id IS NULL
             LIMIT 1`,
            [currentStudyKey, validationStudyKey],
        );
        assert.ok(foreignCurrentCard, "current study must include a card outside the validation membership");

        const clients = new Map(usernames.map(username => [username, new CookieClient(username, config.credentials[username])]));
        await Promise.all([...clients.values()].map(login));
        assert.equal(new Set([...clients.values()].map(client => client.cookieHeader())).size, 6, "six logins must create independent cookie jars");
        const initialCards = await Promise.all([...clients.values()].map(queueCard));
        const membership = await pool.query(
            "SELECT study.expected_card_count, card.pr_card_id FROM unnest($1::uuid[]) requested(pr_card_id) JOIN study_card card ON card.pr_card_id = requested.pr_card_id JOIN study ON study.id = card.study_id",
            [initialCards.map(card => card.id)],
        );
        assert.deepEqual([...new Set(membership.rows.map(row => row.expected_card_count))].sort(), [30, 300]);

        const validationClients = ["javier-30", "diego-30", "pablo-30"].map(username => clients.get(username));
        const categories = new Map();
        for (const client of validationClients) {
            const name = `private-${client.username}`;
            const response = await mutation(client, "/categories", {name});
            assert.equal(response.status, 201);
            categories.set(client.username, JSON.parse(response.body).id);
        }
        const javierValidation = clients.get("javier-30");
        const javierCard = await queueCard(javierValidation);
        assert.match(javierCard.html, /private-javier-30/);
        assert.doesNotMatch(javierCard.html, /private-diego-30|private-pablo-30/);
        assert.doesNotMatch(javierCard.html, new RegExp(escaped(shared.current_category_name), "i"));
        const stateBeforeAttacks = await privateState(pool);
        const hostile = await Promise.all([
            javierValidation.request(`/queue/${foreignCurrentCard.card_id}`),
            javierValidation.request(`/queue?study_id=${encodeURIComponent(currentStudyKey)}&participant_id=foreign`),
            mutation(javierValidation, `/queue/${shared.validation_card_id}/classify`, {category_id: shared.current_category_id, expected_revision: "0", study_id: currentStudyKey, participant_id: "foreign"}),
            mutation(javierValidation, "/categories", {name: "cookie-attack"}, {cookie: clients.get("javier").cookieHeader()}),
            mutation(javierValidation, "/categories", {name: "csrf-attack"}, {"x-csrf-token": clients.get("javier").csrfToken}),
            javierValidation.request("/export"),
        ]);
        assert.deepEqual(hostile.map(response => response.status), [404, 303, 404, 403, 403, 404]);
        assert.equal(hostile[1].headers.location, `/queue/${javierCard.id}`);
        assert.doesNotMatch(`${hostile[0].body}${hostile[2].body}`, new RegExp(shared.current_category_name, "i"));
        assert.equal(await privateState(pool), stateBeforeAttacks, "hostile URL, query, form, cookie, and CSRF requests must not mutate either study");
        const loginPage = await clients.get("javier").request("/login");
        assert.doesNotMatch(loginPage.body, /<select|\b(?:study_id|participant_id)\b/i);

        await Promise.all(validationClients.map(client => completeValidationQueue(
            client,
            categories.get(client.username),
            client.username === "javier-30" ? shared.validation_card_id : null,
            "DISCARDED",
        )));
        const {rows: [completion]} = await pool.query(
            `SELECT COUNT(*) FILTER (WHERE classification.id IS NOT NULL)::integer AS classified,
                    COUNT(*) FILTER (WHERE discard.pr_card_id IS NOT NULL)::integer AS discarded,
                    COUNT(*) FILTER (WHERE classification.id IS NOT NULL OR discard.pr_card_id IS NOT NULL)::integer AS terminal
             FROM study validation JOIN study_participant participant ON participant.study_id = validation.id JOIN study_card card ON card.study_id = validation.id
             LEFT JOIN pr_classification classification ON classification.study_id = validation.id AND classification.participant_id = participant.reviewer_id AND classification.pr_card_id = card.pr_card_id
             LEFT JOIN pr_discard discard ON discard.study_id = validation.id AND discard.participant_id = participant.reviewer_id AND discard.pr_card_id = card.pr_card_id
             WHERE validation.study_key = $1`, [validationStudyKey],
        );
        assert.equal(completion.terminal, 90);
        assert.ok(completion.classified > 0 && completion.discarded > 0);
        const {rows: [privacy]} = await pool.query(
            `SELECT COUNT(*) FILTER (WHERE classification.id IS NOT NULL AND category.id IS NULL)::integer AS unowned_classifications,
                    COUNT(*) FILTER (WHERE classification.id IS NOT NULL AND discard.pr_card_id IS NOT NULL)::integer AS contradictory_terminal_states
             FROM pr_classification classification
             LEFT JOIN participant_category category ON category.id = classification.category_id AND category.study_id = classification.study_id AND category.participant_id = classification.participant_id
             FULL JOIN pr_discard discard ON discard.study_id = classification.study_id AND discard.participant_id = classification.participant_id AND discard.pr_card_id = classification.pr_card_id
             WHERE COALESCE(classification.study_id, discard.study_id) = (SELECT id FROM study WHERE study_key = $1)`,
            [validationStudyKey],
        );
        assert.deepEqual(privacy, {unowned_classifications: 0, contradictory_terminal_states: 0});
        const {rows: [differentDecisions]} = await pool.query(
            `SELECT current_classification.id IS NOT NULL AS current_classified, validation_discard.pr_card_id IS NOT NULL AS validation_discarded
             FROM study current_study JOIN study_participant current_participant ON current_participant.study_id = current_study.id AND current_participant.participant_key = 'javier'
             JOIN study_card current_card ON current_card.study_id = current_study.id AND current_card.source_card_id = $1
             JOIN pr_classification current_classification ON current_classification.study_id = current_study.id AND current_classification.participant_id = current_participant.reviewer_id AND current_classification.pr_card_id = current_card.pr_card_id
             JOIN study validation_study ON validation_study.study_key = $3 JOIN study_participant validation_participant ON validation_participant.study_id = validation_study.id AND validation_participant.participant_key = 'javier'
             JOIN study_card validation_card ON validation_card.study_id = validation_study.id AND validation_card.source_card_id = current_card.source_card_id
             LEFT JOIN pr_discard validation_discard ON validation_discard.study_id = validation_study.id AND validation_discard.participant_id = validation_participant.reviewer_id AND validation_discard.pr_card_id = validation_card.pr_card_id
             WHERE current_study.study_key = $2`, [shared.source_card_id, currentStudyKey, validationStudyKey],
        );
        assert.deepEqual(differentDecisions, {current_classified: true, validation_discarded: true});
        assert.equal(await currentFingerprint(pool), fingerprintBefore, "validation work must not change the current 300-study fingerprint");

        const exportResult = spawnSync("npm", ["run", "--silent", "export:study", "--", "--study-key", validationStudyKey, "--output", config.output], {
            cwd: root,
            encoding: "utf8",
            env: {...process.env, DATABASE_HOST: config.database.host, DATABASE_PORT: `${config.database.port}`, DATABASE_USER: config.database.user,
                DATABASE_NAME: config.database.database, DATABASE_PASS_FILE: config.databasePassFile, STUDY_EXPORT_HMAC_SECRET_FILE: config.exportSecretFile},
        });
        assert.equal(exportResult.status, 0, `${exportResult.stdout}\n${exportResult.stderr}`);
        assert.match(exportResult.stdout, /STUDY_EXPORT_PUBLISHED/);
        const results = readFileSync(path.join(config.output, "results.csv"), "utf8");
        assert.equal(results.trim().split("\n").length, 91);
        assert.equal(JSON.parse(readFileSync(path.join(config.output, "manifest.json"), "utf8")).completion.totals.terminal, 90);

        const logout = await mutation(clients.get("pablo-30"), "/logout", {});
        assert.equal(logout.status, 302);
        assert.equal(logout.headers.location, "/login");
        assert.equal((await clients.get("pablo-30").request("/queue")).status, 401);
        complete = true;
    } finally {
        await pool.end();
    }
    if (complete) process.stdout.write("MULTI_STUDY_HOSTILE_E2E_OK\n");
});
