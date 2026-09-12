import assert from "node:assert/strict";
import {createHmac} from "node:crypto";
import {once} from "node:events";
import test from "node:test";
import express from "express";
import {authenticateLogin} from "../util/login-authentication.js";
import {createSessionMiddleware} from "../util/session-middleware.js";

const now = new Date("2026-01-01T12:00:00.000Z");
const signingSecret = Buffer.alloc(32, 7);
const policy = {
    sessionCookie: {name: "__Host-session", secure: true, httpOnly: true, sameSite: "lax", path: "/"},
    idleTtlMs: 28_800_000,
    absoluteTtlMs: 86_400_000,
    getSessionSecrets: () => [signingSecret],
};
const accounts = [
    {id: "current-account", normalized_username: "javier", study_id: "current-study", reviewer_id: 11,
        participant_key: "javier", password_hash: "current-hash", enabled: true, credential_version: 2,
        failed_login_attempts: 0, failed_login_window_started_at: null, locked_until: null},
    {id: "validation-account", normalized_username: "javier-30", study_id: "validation-study", reviewer_id: 11,
        participant_key: "javier", password_hash: "validation-hash", enabled: true, credential_version: 4,
        failed_login_attempts: 0, failed_login_window_started_at: null, locked_until: null},
];

class MultiStudyAuthPool {
    constructor() {
        this.sessions = new Map();
        this.accountRows = [...accounts];
    }

    async connect() {
        return {query: (sql, parameters = []) => this.query(sql, parameters), release: () => {}};
    }

    async query(sql, parameters = []) {
        if ([ "BEGIN", "COMMIT", "ROLLBACK" ].includes(sql)) return {rows: []};
        if (sql.startsWith("INSERT INTO login_ip_attempt")) {
            return {rows: [{attempt_count: 1, window_started_at: now}]};
        }
        if (sql.includes("FROM participant_account account") && sql.includes("normalized_username")) {
            return {rows: this.accountRows.filter(account => account.normalized_username === parameters[0])};
        }
        if (sql.startsWith("UPDATE participant_account")) return {rows: []};
        if (sql.startsWith("DELETE FROM app_session")) {
            this.sessions.delete(parameters[0]);
            return {rows: []};
        }
        if (sql.startsWith("INSERT INTO app_session")) {
            const account = this.accountRows.find(candidate => candidate.id === parameters[1]);
            this.sessions.set(parameters[0], {
                account_id: account.id,
                study_id: parameters[2],
                reviewer_id: parameters[3],
                participant_key: account.participant_key,
                enabled: account.enabled,
                session_credential_version: parameters[4],
                account_credential_version: account.credential_version,
                created_at: parameters[5],
                last_activity_at: parameters[5],
                expires_at: parameters[6],
                absolute_expires_at: parameters[7],
                csrf_token: parameters[8],
            });
            return {rows: []};
        }
        if (sql.includes("FROM app_session session")) {
            const session = this.sessions.get(parameters[0]);
            return {rows: session ? [session] : []};
        }
        if (sql.startsWith("UPDATE app_session")) return {rows: []};
        throw new Error(`Unexpected query: ${sql}`);
    }
}

const authenticate = (pool, username, password, sessionId) => authenticateLogin({
    pool,
    username,
    password,
    clientIp: "127.0.0.1",
    clock: () => now,
    createSessionId: () => sessionId,
    createCsrfToken: () => "c".repeat(43),
    passwordVerifier: async (hash, value) => (hash === "current-hash" && value === "current-password")
        || (hash === "validation-hash" && value === "validation-password"),
});

const readContext = async (pool, sessionId, tampering = "") => {
    const tag = createHmac("sha256", signingSecret).update(sessionId, "ascii").digest("base64url");
    const app = express();
    app.use(createSessionMiddleware({pool, clock: () => now, policy}));
    app.get("/context", (request, response) => response.json(request.sessionContext));
    const server = app.listen(0);
    await once(server, "listening");
    try {
        const response = await fetch(`http://127.0.0.1:${server.address().port}/context?study_id=${tampering}`, {
            headers: {cookie: `__Host-session=${sessionId}.${tag}`, "x-study-id": tampering},
        });
        return response.json();
    } finally {
        await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
};

test("Given current and validation login handles When both authenticate Then persisted accounts create distinct study-bound sessions", async () => {
    const pool = new MultiStudyAuthPool();

    const current = await authenticate(pool, "javier", "current-password", "a".repeat(43));
    const validation = await authenticate(pool, "javier-30", "validation-password", "b".repeat(43));

    assert.deepEqual(current, {kind: "authenticated", sessionId: "a".repeat(43)});
    assert.deepEqual(validation, {kind: "authenticated", sessionId: "b".repeat(43)});
    assert.equal(pool.sessions.get(current.sessionId).study_id, "current-study");
    assert.equal(pool.sessions.get(validation.sessionId).study_id, "validation-study");
    assert.equal(pool.sessions.get(current.sessionId).participant_key, "javier");
    assert.equal(pool.sessions.get(validation.sessionId).participant_key, "javier");
});

test("Given a validation session When client identity fields target the current study Then persisted session context remains authoritative", async () => {
    const pool = new MultiStudyAuthPool();
    const result = await authenticate(pool, "javier-30", "validation-password", "b".repeat(43));

    const context = await readContext(pool, result.sessionId, "current-study");

    assert.deepEqual(context, {
        accountId: "validation-account",
        studyId: "validation-study",
        participantId: 11,
        participantKey: "javier",
    });
});

test("Given wrong, disabled, suffix-only, or ambiguous credentials When login runs Then failures stay generic and create no session", async () => {
    const cases = [
        {username: "javier", password: "wrong"},
        {username: "javier-999", password: "validation-password"},
        {username: "disabled", password: "validation-password", account: {...accounts[1], normalized_username: "disabled", enabled: false}},
        {username: "duplicate", password: "validation-password", account: [
            {...accounts[0], normalized_username: "duplicate"},
            {...accounts[1], normalized_username: "duplicate"},
        ]},
    ];

    for (const [index, fixture] of cases.entries()) {
        const pool = new MultiStudyAuthPool();
        if (fixture.account) pool.accountRows.push(...(Array.isArray(fixture.account) ? fixture.account : [fixture.account]));
        const result = await authenticate(pool, fixture.username, fixture.password, String(index).repeat(43));
        assert.deepEqual(result, {kind: "invalid"});
        assert.equal(pool.sessions.size, 0);
    }
});
