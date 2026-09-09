import assert from "node:assert/strict";
import {createHmac} from "node:crypto";
import {once} from "node:events";
import test from "node:test";
import express from "express";
import {createSessionId, createSessionMiddleware, setSessionCookie} from "../util/session-middleware.js";

const now = new Date("2026-01-01T12:00:00.000Z");
const sessionId = createSessionId();
const currentSecret = Buffer.alloc(32, 1);
const previousSecret = Buffer.alloc(32, 2);
const sessionPolicy = {
    sessionCookie: {name: "__Host-session", secure: true, httpOnly: true, sameSite: "lax", path: "/"},
    idleTtlMs: 28_800_000,
    absoluteTtlMs: 86_400_000,
    getSessionSecrets: () => [currentSecret, previousSecret],
};

const signedCookie = (id, secret) => `${id}.${createHmac("sha256", secret).update(id, "ascii").digest("base64url")}`;

const validRow = () => ({
    account_id: "account-1",
    study_id: "study-1",
    reviewer_id: 12,
    participant_key: "participant-a",
    enabled: true,
    session_credential_version: 3,
    account_credential_version: 3,
    created_at: new Date("2026-01-01T00:00:00.000Z"),
    last_activity_at: new Date("2026-01-01T11:59:00.000Z"),
    expires_at: new Date("2026-01-01T19:59:00.000Z"),
    absolute_expires_at: new Date("2026-01-02T00:00:00.000Z"),
});

class SessionPool {
    constructor({mode = "valid"} = {}) {
        this.mode = mode;
        this.queries = [];
    }

    async query(sql, parameters) {
        this.queries.push({sql, parameters});
        if (this.mode === "store-failure" || (this.mode === "activity-write-failure" && sql.startsWith("UPDATE"))) {
            throw new Error("database sentinel failure");
        }
        if (sql.startsWith("SELECT")) {
            if ([ "revoked", "missing-membership" ].includes(this.mode)) return {rows: []};
            const row = validRow();
            if (this.mode === "disabled") row.enabled = false;
            if (this.mode === "version-mismatch") row.account_credential_version = 4;
            if (this.mode === "idle-expired") row.last_activity_at = new Date("2026-01-01T03:59:59.999Z");
            if (this.mode === "absolute-expired") row.created_at = new Date("2025-12-31T11:59:59.999Z");
            return {rows: [row]};
        }
        if (sql.startsWith("UPDATE")) return {rowCount: 1, rows: []};
        throw new Error(`Unexpected query: ${sql}`);
    }
}

const requestContext = async (pool, cookie = signedCookie(sessionId, currentSecret)) => {
    const app = express();
    app.use(createSessionMiddleware({pool, clock: () => now, policy: sessionPolicy}));
    app.get("/protected", (req, res) => res.json({session: req.sessionContext || null}));
    const server = app.listen(0);
    await once(server, "listening");
    try {
        const response = await fetch(`http://127.0.0.1:${server.address().port}/protected`, {
            headers: {cookie: `__Host-session=${cookie}`},
        });
        return {body: await response.json(), pool};
    } finally {
        await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
};

test("valid PostgreSQL session derives an authoritative context and refreshes valid activity", async () => {
    const {body, pool} = await requestContext(new SessionPool());

    assert.deepEqual(body, {session: {
        accountId: "account-1",
        studyId: "study-1",
        participantId: 12,
        participantKey: "participant-a",
    }});
    assert.equal(pool.queries.length, 2);
    assert.match(pool.queries[0].sql, /FROM app_session session/);
    assert.match(pool.queries[0].sql, /INNER JOIN participant_account account/);
    assert.match(pool.queries[0].sql, /INNER JOIN study_participant participant/);
    assert.match(pool.queries[1].sql, /^UPDATE app_session/);
    assert.deepEqual(pool.queries[1].parameters.slice(0, 2), [sessionId, now]);
});

test("previous signing secret remains valid while current secret is used for issuance", async () => {
    const {body, pool} = await requestContext(new SessionPool(), signedCookie(sessionId, previousSecret));

    assert.equal(body.session.participantKey, "participant-a");
    assert.deepEqual(pool.queries[0].parameters, [sessionId]);
});

for (const cookie of [
    sessionId,
    `${sessionId}.tampered`,
    `${sessionId.slice(0, -1)}.${"a".repeat(43)}`,
    `${sessionId}.${"a".repeat(43)}.extra`,
    `${sessionId}.%ZZ`,
]) {
    test(`invalid session cookie is rejected before a database query: ${cookie.slice(0, 20)}`, async () => {
        const {body, pool} = await requestContext(new SessionPool(), cookie);

        assert.deepEqual(body, {session: null});
        assert.equal(pool.queries.length, 0);
    });
}

for (const mode of [ "idle-expired", "absolute-expired", "revoked", "disabled", "missing-membership", "version-mismatch" ]) {
    test(`invalid session is unauthenticated when ${mode}`, async () => {
        const {body, pool} = await requestContext(new SessionPool({mode}));

        assert.deepEqual(body, {session: null});
        assert.equal(pool.queries.length, 1);
    });
}

for (const mode of [ "store-failure", "activity-write-failure" ]) {
    test(`store failure is unauthenticated without disclosing database details when ${mode}`, async () => {
        const {body, pool} = await requestContext(new SessionPool({mode}));

        assert.deepEqual(body, {session: null});
        assert.equal(pool.queries.length, mode === "store-failure" ? 1 : 2);
    });
}

test("opaque session IDs are cryptographically-sized and cookie writer preserves host cookie attributes", async () => {
    const otherSessionId = createSessionId();
    const app = express();
    app.get("/issue", (_req, res) => {
        setSessionCookie(res, sessionId, sessionPolicy);
        res.end();
    });
    const server = app.listen(0);
    await once(server, "listening");

    try {
        const response = await fetch(`http://127.0.0.1:${server.address().port}/issue`);
        const cookie = response.headers.get("set-cookie") || "";

        assert.match(sessionId, /^[A-Za-z0-9_-]{43}$/);
        assert.notEqual(sessionId, otherSessionId);
        assert.equal(cookie, `__Host-session=${signedCookie(sessionId, currentSecret)}; Path=/; HttpOnly; Secure; SameSite=Lax`);
        assert.doesNotMatch(cookie, /Domain=/i);
    } finally {
        await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
});
