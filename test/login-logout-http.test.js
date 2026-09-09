import assert from "node:assert/strict";
import {once} from "node:events";
import test from "node:test";
import {createApp} from "../app.js";

const now = new Date("2026-01-01T12:00:00.000Z");
const sessionId = "s".repeat(43);
const sessionCsrfToken = "t".repeat(43);

class AuthHttpPool {
    constructor() {
        this.account = {
            id: "account-1",
            study_id: "study-1",
            reviewer_id: 12,
            password_hash: "stored-password-hash",
            enabled: true,
            credential_version: 3,
            failed_login_attempts: 0,
            failed_login_window_started_at: null,
            locked_until: null,
        };
        this.contexts = new Map();
        this.sessions = new Map();
        this.deletedSessionIds = [];
        this.accountFailures = 0;
        this.ipAttempts = 0;
    }

    async query(sql, parameters = []) {
        if (sql.startsWith("INSERT INTO login_csrf_context")) {
            this.contexts.set(parameters[0], {token: parameters[1], expires_at: parameters[2]});
            return {rows: []};
        }
        if (sql.startsWith("SELECT token, expires_at FROM login_csrf_context")) {
            const context = this.contexts.get(parameters[0]);
            return {rows: context ? [context] : []};
        }
        if (sql.startsWith("DELETE FROM app_session")) {
            this.deletedSessionIds.push(parameters[0]);
            this.sessions.delete(parameters[0]);
            return {rows: []};
        }
        throw new Error(`Unexpected pool query: ${sql}`);
    }

    async connect() {
        return {
            query: async (sql, parameters = []) => {
                if ([ "BEGIN", "COMMIT", "ROLLBACK" ].includes(sql)) return {rows: []};
                if (sql.startsWith("INSERT INTO login_ip_attempt")) {
                    this.ipAttempts += 1;
                    return {rows: [{attempt_count: this.ipAttempts, window_started_at: now}]};
                }
                if (sql.includes("FROM participant_account account")) return {rows: [this.account]};
                if (sql.startsWith("UPDATE participant_account") && sql.includes("failed_login_attempts = 0")) {
                    this.account.failed_login_attempts = 0;
                    return {rows: []};
                }
                if (sql.startsWith("UPDATE participant_account")) {
                    this.accountFailures += 1;
                    return {rows: []};
                }
                if (sql.startsWith("INSERT INTO app_session")) {
                    this.sessions.set(parameters[0], {csrfToken: parameters[8]});
                    return {rows: []};
                }
                throw new Error(`Unexpected client query: ${sql}`);
            },
            release: () => {},
        };
    }
}

const sessionMiddleware = pool => (req, res, next) => {
    const cookie = req.headers.cookie || "";
    const sessionCookie = cookie.split(";").map(part => part.trim()).find(part => part.startsWith("__Host-session="));
    const id = sessionCookie?.slice("__Host-session=".length);
    const session = pool.sessions.get(id);
    req.sessionContext = session ? {accountId: "account-1", studyId: "study-1", participantId: 12} : null;
    req.csrfToken = session?.csrfToken || null;
    res.locals.sessionContext = req.sessionContext;
    res.locals.csrfToken = req.csrfToken;
    next();
};

const startServer = async pool => {
    const app = await createApp({
        pool,
        sessionMiddleware: sessionMiddleware(pool),
        clock: () => now,
        passwordVerifier: async (hash, password) => hash === "stored-password-hash" && password === "correct",
        csrf: {
            createCsrfToken: () => sessionCsrfToken,
        },
    });
    const server = app.listen(0);
    await once(server, "listening");
    return server;
};

const closeServer = server => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));

const cookieValue = (header, name) => header.match(new RegExp(`${name}=([^;]+)`))?.[1];

test("public login is accessible, non-enumerating, and rejects missing or invalid CSRF before authentication", async () => {
    const pool = new AuthHttpPool();
    const server = await startServer(pool);
    const baseUrl = `http://127.0.0.1:${server.address().port}`;

    try {
        const page = await fetch(`${baseUrl}/login`);
        const html = await page.text();
        const csrfCookie = page.headers.get("set-cookie");
        const contextId = cookieValue(csrfCookie || "", "__Host-login-csrf");
        const token = html.match(/name=csrf_token value=([^ >]+)/)?.[1];
        assert.equal(page.status, 200);
        assert.match(html, /<label for=username>Username<\/label>/);
        assert.match(html, /autocomplete=username/);
        assert.match(html, /autocomplete=current-password/);
        assert.doesNotMatch(html, /reviewer|participant|participant_id|reviewer_id|account_id/i);
        assert.ok(contextId);
        assert.equal(token?.length, 43);

        const missing = await fetch(`${baseUrl}/login`, {
            method: "POST",
            headers: {cookie: `__Host-login-csrf=${contextId}`, origin: "http://127.0.0.1", "content-type": "application/x-www-form-urlencoded"},
            body: "username=participant-a&password=correct",
        });
        const invalid = await fetch(`${baseUrl}/login`, {
            method: "POST",
            headers: {cookie: `__Host-login-csrf=${contextId}`, origin: "http://127.0.0.1", "content-type": "application/x-www-form-urlencoded"},
            body: "username=participant-a&password=correct&csrf_token=" + "x".repeat(43),
        });
        assert.equal(missing.status, 403);
        assert.equal(invalid.status, 403);
        assert.equal(pool.ipAttempts, 0);
        assert.equal(pool.sessions.size, 0);

        const valid = await fetch(`${baseUrl}/login`, {
            method: "POST",
            headers: {cookie: `__Host-login-csrf=${contextId}`, origin: "http://127.0.0.1", "content-type": "application/x-www-form-urlencoded"},
            body: `username=participant-a&password=correct&csrf_token=${token}`,
            redirect: "manual",
        });
        assert.equal(valid.status, 302);
        assert.match(valid.headers.get("set-cookie") || "", /^__Host-session=/);
        assert.equal(pool.sessions.size, 1);
    } finally {
        await closeServer(server);
    }
});

test("POST logout destroys the current PostgreSQL session and clears the host cookie while GET logout is rejected", async () => {
    const pool = new AuthHttpPool();
    const server = await startServer(pool);
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    pool.sessions.set(sessionId, {csrfToken: sessionCsrfToken});

    try {
        const response = await fetch(`${baseUrl}/logout`, {
            method: "POST",
            headers: {
                cookie: `__Host-session=${sessionId}`,
                origin: "http://127.0.0.1",
                "content-type": "application/x-www-form-urlencoded",
            },
            body: `csrf_token=${sessionCsrfToken}`,
            redirect: "manual",
        });
        const clearedCookie = response.headers.get("set-cookie") || "";
        assert.equal(response.status, 302);
        assert.equal(response.headers.get("location"), "/login");
        assert.deepEqual(pool.deletedSessionIds, [sessionId]);
        assert.equal(pool.sessions.has(sessionId), false);
        assert.match(clearedCookie, /^__Host-session=; Path=\/; Expires=/);
        assert.match(clearedCookie, /HttpOnly; Secure; SameSite=Lax/);

        const getLogout = await fetch(`${baseUrl}/logout`, {redirect: "manual"});
        assert.equal(getLogout.status, 404);
        assert.deepEqual(pool.deletedSessionIds, [sessionId]);
    } finally {
        await closeServer(server);
    }
});
