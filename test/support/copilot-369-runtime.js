import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {createPasswordHash, isValidPasswordHash} from "../../util/credential-policy.js";
import {readPullRequestCards} from "../../util/csv-pr-provider.js";
import {readCopilot369Cards} from "../../util/copilot-369-source.js";
import {persistCopilot369Cards} from "../../util/copilot-369-persistence.js";
import {runStudyMigrations} from "../../util/study-schema.js";
import {
    closeCopilot369Database,
    seedHistoricalCopilot369Studies,
    startCopilot369Database,
} from "./copilot-369-fixture.js";

const REPOSITORY_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const PRIMARY_CSV = path.join(REPOSITORY_ROOT, "plans/copilot-369-cards.csv");
const VALIDATION_CSV = path.join(REPOSITORY_ROOT, "plans/validation-30-cards.csv");
const VALIDATION_MANIFEST = path.join(REPOSITORY_ROOT, "plans/validation-30-cards.manifest.json");
const HISTORICAL_VALIDATION_SOURCE = path.join(REPOSITORY_ROOT, "plans/merged_after_rework_cards_seed_20260510.csv");
const PARTICIPANTS = Object.freeze(["javier", "diego", "pablo"]);
const QA_PASSWORDS = Object.freeze(Object.fromEntries(PARTICIPANTS.map(key => [key, `copilot369-qa-${key}-synthetic`])));
const createCopilot369QaSessionPolicy = () => Object.freeze({sessionCookie: {name: "copilot-369-qa-session", secure: false, httpOnly: true, sameSite: "lax", path: "/"},
    trustProxyHops: 0, idleTtlMs: 28_800_000, absoluteTtlMs: 86_400_000,
    getSessionSecrets: () => [Buffer.from("copilot-369-qa-only-session-signing-key")]});
const sha256 = buffer => createHash("sha256").update(buffer).digest("hex");
const encodeCopilot369Form = values => new URLSearchParams(values).toString();
const parseCopilot369CsrfToken = html => {
    const match = html.match(/<input\b[^>]*\bname=(?:["']csrf_token["']|csrf_token)\b[^>]*\bvalue=(?:["']([^"']+)["']|([^\s>]+))/i);
    assert.ok(match, "rendered form should contain its synchronizer token");
    return match[1] || match[2];
};

class Copilot369HttpClient {
    constructor(baseUrl, username, password) {
        this.baseUrl = baseUrl;
        this.origin = new URL(baseUrl).origin;
        this.username = username;
        this.password = password;
        this.cookies = new Map();
        this.csrfToken = null;
    }

    cookieHeader() {
        return [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; ");
    }

    async request(requestPath, {method = "GET", headers = {}, body} = {}) {
        const response = await fetch(new URL(requestPath, this.baseUrl), {
            method, redirect: "manual", headers: {cookie: this.cookieHeader(), ...headers}, body,
        });
        for (const header of response.headers.getSetCookie()) {
            const [pair] = header.split(";", 1);
            const separator = pair.indexOf("=");
            const name = pair.slice(0, separator);
            const value = pair.slice(separator + 1);
            if (value === "") this.cookies.delete(name);
            else this.cookies.set(name, value);
        }
        return response;
    }

    async login() {
        const page = await this.request("/login");
        assert.equal(page.status, 200);
        const token = parseCopilot369CsrfToken(await page.text());
        const response = await this.request("/login", {
            method: "POST", headers: {origin: this.origin, "content-type": "application/x-www-form-urlencoded"},
            body: encodeCopilot369Form({username: this.username, password: this.password, csrf_token: token}),
        });
        assert.equal(response.status, 302, `${this.username} should authenticate through HTTP`);
        assert.equal(response.headers.get("location"), "/queue");
        assert.match(this.cookieHeader(), /copilot-369-qa-session=[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}/);
        assert.equal(response.headers.getSetCookie().some(value => value.startsWith("copilot-369-qa-session=") && !/;\s*Secure/i.test(value)), true);
    }

    async queueCard() {
        const queue = await this.request("/queue");
        assert.equal(queue.status, 303);
        const cardId = queue.headers.get("location").slice("/queue/".length);
        const detail = await this.request(queue.headers.get("location"));
        assert.equal(detail.status, 200);
        this.csrfToken = parseCopilot369CsrfToken(await detail.text());
        return cardId;
    }

    mutationHeaders(token = this.csrfToken) {
        return {origin: this.origin, "content-type": "application/x-www-form-urlencoded", ...(token === null ? {} : {"x-csrf-token": token})};
    }
}

const createAccounts = async () => {
    const hashes = new Map(await Promise.all(PARTICIPANTS.map(async participantKey => {
        const passwordHash = await createPasswordHash(QA_PASSWORDS[participantKey]);
        assert.equal(isValidPasswordHash(passwordHash), true);
        return [participantKey, passwordHash];
    })));
    return ["pr-card-sorting-local", "pr-card-sorting-validation-30"].flatMap(studyKey => PARTICIPANTS.map((participantKey, ordinal) => ({studyKey, participantKey, normalizedUsername: `${participantKey}${studyKey.endsWith("-30") ? "-30" : ""}`, passwordHash: hashes.get(participantKey), credentialVersion: ordinal + 1})));
};

const studyConfig = (studyKey, expectedCardCount) => ({
    studyKey,
    expectedCardCount,
    participants: [...PARTICIPANTS],
    loginUsernames: Object.fromEntries(PARTICIPANTS.map(key => [key, `${key}${expectedCardCount === 30 ? "-30" : ""}`])),
});

const insertMembership = async (client, studyId, cards) => {
    await client.query(
        `INSERT INTO study_card(study_id, pr_card_id, source_card_id, ordinal, source_checksum)
         SELECT $1, card.id, member.source_card_id, member.ordinality - 1, card.content_checksum
         FROM unnest($2::text[]) WITH ORDINALITY AS member(source_card_id, ordinality)
         JOIN pr_cards card ON card.source_card_id = member.source_card_id`,
        [studyId, cards.map(card => card.source_card_id)],
    );
};

const withTransaction = async (pool, action) => {
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const result = await action(client);
        await client.query("COMMIT");
        return result;
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
};

const createCopilot369Runtime = async () => {
    const database = await startCopilot369Database();
    try {
        await runStudyMigrations(database.pool);
        const [studies, primary, validation, manifestBytes, accounts] = await Promise.all([
            seedHistoricalCopilot369Studies({pool: database.pool}),
            readCopilot369Cards(PRIMARY_CSV),
            readPullRequestCards(VALIDATION_CSV, {expectedCardCount: 30}),
            readFile(VALIDATION_MANIFEST),
            createAccounts(),
        ]);
        assert.deepEqual(validation.errors, []);
        const manifest = JSON.parse(manifestBytes.toString("utf8"));
        assert.equal(validation.sourceChecksum, manifest.subset.sha256);
        assert.deepEqual(validation.cards.map(card => card.source_card_id), manifest.orderedCardIds);
        assert.equal(primary.cards.length, 369);
        assert.equal(validation.cards.length, 30);
        const primaryIds = new Set(primary.cards.map(card => card.source_card_id));
        assert.equal(validation.cards.some(card => primaryIds.has(card.source_card_id)), false);
        await withTransaction(database.pool, async client => {
            for (const account of accounts) {
                await client.query(
                    `UPDATE participant_account account SET password_hash = $1
                     FROM study_participant member JOIN study ON study.id = member.study_id
                     WHERE study.study_key = $2 AND member.participant_key = $3
                       AND account.study_id = member.study_id AND account.reviewer_id = member.reviewer_id`,
                    [account.passwordHash, account.studyKey, account.participantKey],
                );
            }
        });
        const authenticationBaseline = await readCopilot369AuthState(database.pool);
        const protectedValidationBaseline = await fingerprintProtectedCopilot369Validation(database.pool, studies.validationStudyId);
        await withTransaction(database.pool, async client => {
            const persisted = await persistCopilot369Cards(client, primary.cards, primary.sourceChecksum);
            await client.query("DELETE FROM study_card WHERE study_id = $1", [studies.primaryStudyId]);
            await client.query(
                "UPDATE study SET config = $2::jsonb, source_checksum = $3, expected_card_count = 369 WHERE id = $1",
                [studies.primaryStudyId, JSON.stringify(studyConfig("pr-card-sorting-local", 369)), primary.sourceChecksum],
            );
            await insertMembership(client, studies.primaryStudyId, persisted);
            await client.query(
                "DELETE FROM pr_cards card WHERE NOT EXISTS (SELECT 1 FROM study_card member WHERE member.pr_card_id = card.id)",
            );
        });
        return {
            ...database,
            ...studies,
            primaryCards: primary.cards,
            validationCards: validation.cards,
            accounts,
            passwords: QA_PASSWORDS,
            authenticationBaseline,
            protectedValidationBaseline,
        };
    } catch (error) {
        await closeCopilot369Database(database);
        throw error;
    }
};

const readCopilot369AuthState = async pool => {
    const {rows} = await pool.query(
        `SELECT study.study_key, member.participant_key, member.ordinal, reviewer.name AS reviewer_name,
            account.id AS account_id, account.study_id, account.reviewer_id, account.normalized_username,
            account.password_hash, account.enabled, account.credential_version
         FROM participant_account account JOIN study ON study.id = account.study_id JOIN study_participant member
            ON member.study_id = account.study_id AND member.reviewer_id = account.reviewer_id
         JOIN reviewer ON reviewer.id = member.reviewer_id ORDER BY study.study_key, member.ordinal`,
    );
    return rows;
};

const fingerprintProtectedCopilot369Validation = async (pool, studyId) => {
    const {rows: [row]} = await pool.query(
        `SELECT jsonb_build_object(
            'study', (SELECT to_jsonb(study) FROM study WHERE id = $1),
            'reviewers', (SELECT COALESCE(jsonb_agg(to_jsonb(reviewer) ORDER BY reviewer.id), '[]'::jsonb)
                         FROM reviewer JOIN study_participant member ON member.reviewer_id = reviewer.id WHERE member.study_id = $1),
            'participants', (SELECT COALESCE(jsonb_agg(to_jsonb(member) ORDER BY member.ordinal), '[]'::jsonb)
                            FROM study_participant member WHERE member.study_id = $1),
            'accounts', (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', account.id, 'study_id', account.study_id,
                            'reviewer_id', account.reviewer_id, 'username', account.normalized_username,
                            'password_hash', account.password_hash, 'enabled', account.enabled,
                            'credential_version', account.credential_version, 'created_at', account.created_at)
                            ORDER BY account.reviewer_id), '[]'::jsonb) FROM participant_account account WHERE account.study_id = $1),
            'memberships', (SELECT COALESCE(jsonb_agg(to_jsonb(member) ORDER BY member.ordinal), '[]'::jsonb)
                            FROM study_card member WHERE member.study_id = $1),
            'sharedCards', (SELECT COALESCE(jsonb_agg(to_jsonb(card) ORDER BY card.source_card_id), '[]'::jsonb)
                            FROM pr_cards card JOIN study_card member ON member.pr_card_id = card.id WHERE member.study_id = $1),
            'snapshots', (SELECT COALESCE(jsonb_agg(to_jsonb(snapshot) ORDER BY snapshot.pr_card_id, snapshot.id), '[]'::jsonb)
                          FROM github_card_snapshot snapshot JOIN study_card member ON member.pr_card_id = snapshot.pr_card_id WHERE member.study_id = $1),
            'runs', (SELECT COALESCE(jsonb_agg(to_jsonb(run) ORDER BY run.id), '[]'::jsonb) FROM github_enrichment_run run WHERE run.study_id = $1),
            'runPages', (SELECT COALESCE(jsonb_agg(to_jsonb(page) ORDER BY page.pr_card_id, page.endpoint, page.page_ordinal), '[]'::jsonb) FROM github_run_page page WHERE page.study_id = $1),
            'runCards', (SELECT COALESCE(jsonb_agg(to_jsonb(mapping) ORDER BY mapping.run_id, mapping.pr_card_id), '[]'::jsonb) FROM github_enrichment_run_card mapping WHERE mapping.study_id = $1),
            'promotions', (SELECT COALESCE(jsonb_agg(to_jsonb(promotion) ORDER BY promotion.study_id), '[]'::jsonb) FROM study_enrichment_promotion promotion WHERE promotion.study_id = $1),
            'classifications', (SELECT COALESCE(jsonb_agg(to_jsonb(classification) ORDER BY classification.pr_card_id, classification.participant_id), '[]'::jsonb) FROM pr_classification classification WHERE classification.study_id = $1),
            'discards', (SELECT COALESCE(jsonb_agg(to_jsonb(discard) ORDER BY discard.pr_card_id, discard.participant_id), '[]'::jsonb) FROM pr_discard discard WHERE discard.study_id = $1),
            'categories', (SELECT COALESCE(jsonb_agg(to_jsonb(category) ORDER BY category.participant_id, category.id), '[]'::jsonb) FROM participant_category category WHERE category.study_id = $1),
            'apiTelemetry', (SELECT COALESCE(jsonb_agg(to_jsonb(event) ORDER BY event.recorded_at, event.event_id), '[]'::jsonb) FROM github_api_telemetry_event event WHERE event.study_id = $1)
        )::text AS state`,
        [studyId],
    );
    const [historicalSource, validationCsv, validationManifest] = await Promise.all([
        readFile(HISTORICAL_VALIDATION_SOURCE), readFile(VALIDATION_CSV), readFile(VALIDATION_MANIFEST),
    ]);
    return sha256(Buffer.from(JSON.stringify({
        state: JSON.parse(row.state),
        artifacts: [sha256(historicalSource), sha256(validationCsv), sha256(validationManifest)],
    })));
};

const readCopilot369PrivateState = async (pool, studyIds) => {
    const {rows: [row]} = await pool.query(
        `SELECT jsonb_build_object(
            'categories', (SELECT COALESCE(jsonb_agg(to_jsonb(c) ORDER BY c.study_id, c.participant_id, c.id), '[]'::jsonb) FROM participant_category c WHERE c.study_id = ANY($1::uuid[])),
            'classifications', (SELECT COALESCE(jsonb_agg(to_jsonb(c) ORDER BY c.study_id, c.participant_id, c.pr_card_id), '[]'::jsonb) FROM pr_classification c WHERE c.study_id = ANY($1::uuid[])),
            'discards', (SELECT COALESCE(jsonb_agg(to_jsonb(d) ORDER BY d.study_id, d.participant_id, d.pr_card_id), '[]'::jsonb) FROM pr_discard d WHERE d.study_id = ANY($1::uuid[]))
        )::text AS state`,
        [studyIds],
    );
    return row.state;
};

export {
    Copilot369HttpClient,
    createCopilot369Runtime,
    createCopilot369QaSessionPolicy,
    encodeCopilot369Form,
    fingerprintProtectedCopilot369Validation,
    parseCopilot369CsrfToken,
    readCopilot369AuthState,
    readCopilot369PrivateState,
};
