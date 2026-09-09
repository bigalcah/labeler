import assert from "node:assert/strict";
import {createHmac} from "node:crypto";
import {once} from "node:events";
import test from "node:test";
import {createApp} from "../app.js";
import {authenticateLogin} from "../util/login-authentication.js";

const now = new Date("2026-01-01T12:00:00.000Z");
const sessionSecret = Buffer.alloc(32, 3);
const sessionPolicy = {
    sessionCookie: {name: "__Host-session", secure: true, httpOnly: true, sameSite: "lax", path: "/"},
    trustProxyHops: 0,
    idleTtlMs: 28_800_000,
    absoluteTtlMs: 86_400_000,
    getSessionSecrets: () => [sessionSecret],
};

const signedCookie = sessionId => `${sessionId}.${createHmac("sha256", sessionSecret).update(sessionId, "ascii").digest("base64url")}`;

class LoginPool {
    constructor({account = null, ipAttempts = 0} = {}) {
        this.account = account;
        this.ipAttempts = ipAttempts;
        this.sessions = [];
        this.deletedSessionIds = [];
    }

    async connect() {
        return {
            query: async (sql, parameters = []) => {
                if ([ "BEGIN", "COMMIT", "ROLLBACK" ].includes(sql)) return {rows: []};
                if (sql.startsWith("INSERT INTO login_ip_attempt")) {
                    this.ipAttempts += 1;
                    return {rows: [{attempt_count: this.ipAttempts, window_started_at: now}]};
                }
                if (sql.includes("FROM participant_account account")) {
                    return {rows: this.account ? [this.account] : []};
                }
                if (sql.startsWith("UPDATE participant_account") && sql.includes("failed_login_attempts = 0")) {
                    this.account.failed_login_attempts = 0;
                    return {rows: []};
                }
                if (sql.startsWith("UPDATE participant_account")) {
                    this.account.failed_login_attempts += 1;
                    if (this.account.failed_login_attempts >= 5) this.account.locked_until = new Date("2026-01-01T12:15:00.000Z");
                    return {rows: []};
                }
                if (sql.startsWith("DELETE FROM app_session")) {
                    this.deletedSessionIds.push(parameters[0]);
                    return {rows: []};
                }
                if (sql.startsWith("INSERT INTO app_session")) {
                    this.sessions.push(parameters);
                    return {rows: []};
                }
                throw new Error(`Unexpected query: ${sql}`);
            },
            release: () => {},
        };
    }
}

const account = (overrides = {}) => ({
    id: "account-1",
    study_id: "study-1",
    reviewer_id: 12,
    password_hash: "stored-password-hash",
    enabled: true,
    credential_version: 3,
    failed_login_attempts: 0,
    failed_login_window_started_at: null,
    locked_until: null,
    ...overrides,
});

const authenticate = ({pool, username = "participant-a", password = "correct", sessionId = null}) => authenticateLogin({
    pool,
    username,
    password,
    sessionId,
    clientIp: "127.0.0.1",
    clock: () => now,
    createSessionId: () => "a".repeat(43),
    passwordVerifier: async (hash, value) => hash === "stored-password-hash" && value === "correct",
});

test("Given valid credentials When login authenticates Then it creates a regenerated opaque PostgreSQL session", async () => {
    const pool = new LoginPool({account: account()});

    const result = await authenticate({pool, sessionId: "b".repeat(43)});

    assert.deepEqual(result, {kind: "authenticated", sessionId: "a".repeat(43)});
    assert.equal(pool.sessions.length, 1);
    assert.deepEqual(pool.sessions[0].slice(0, 5), ["a".repeat(43), "account-1", "study-1", 12, 3]);
    assert.match(pool.sessions[0][8], /^[A-Za-z0-9_-]{43}$/);
    assert.deepEqual(pool.deletedSessionIds, ["b".repeat(43)]);
});

test("Given a regenerated login session When a second login succeeds Then its synchronizer token is rotated", async () => {
    const pool = new LoginPool({account: account()});
    const first = await authenticateLogin({
        pool,
        username: "participant-a",
        password: "correct",
        clientIp: "127.0.0.1",
        clock: () => now,
        createSessionId: () => "a".repeat(43),
        createCsrfToken: () => "c".repeat(43),
        passwordVerifier: async (hash, value) => hash === "stored-password-hash" && value === "correct",
    });
    const second = await authenticateLogin({
        pool,
        username: "participant-a",
        password: "correct",
        sessionId: "a".repeat(43),
        clientIp: "127.0.0.1",
        clock: () => now,
        createSessionId: () => "b".repeat(43),
        createCsrfToken: () => "d".repeat(43),
        passwordVerifier: async (hash, value) => hash === "stored-password-hash" && value === "correct",
    });

    assert.deepEqual(first, {kind: "authenticated", sessionId: "a".repeat(43)});
    assert.deepEqual(second, {kind: "authenticated", sessionId: "b".repeat(43)});
    assert.equal(pool.sessions[0][8], "c".repeat(43));
    assert.equal(pool.sessions[1][8], "d".repeat(43));
    assert.notEqual(pool.sessions[0][8], pool.sessions[1][8]);
});

test("Given invalid, nonexistent, disabled, or locked credentials When login authenticates Then every account result is generic", async () => {
    const cases = [
        {pool: new LoginPool({account: account()}), password: "wrong"},
        {pool: new LoginPool(), password: "wrong"},
        {pool: new LoginPool({account: account({enabled: false})}), password: "correct"},
        {pool: new LoginPool({account: account({locked_until: new Date("2026-01-01T12:15:00.000Z")})}), password: "correct"},
    ];

    const results = await Promise.all(cases.map(({pool, password}) => authenticate({pool, password})));

    assert.deepEqual(results, cases.map(() => ({kind: "invalid"})));
    assert.equal(cases.every(({pool}) => pool.sessions.length === 0), true);
});

for (const password of [ undefined, null, 42, {}, [] ]) {
    test(`Given a non-text password When login authenticates Then it returns a generic failure: ${String(password)}`, async () => {
        const pool = new LoginPool({account: account()});
        const result = await authenticateLogin({
            pool,
            username: "participant-a",
            password,
            clientIp: "127.0.0.1",
            clock: () => now,
            passwordVerifier: async (hash, value) => {
                assert.equal(hash, "stored-password-hash");
                assert.equal(typeof value, "string");
                return false;
            },
        });

        assert.deepEqual(result, {kind: "invalid"});
        assert.equal(pool.sessions.length, 0);
    });
}

test("Given an absent username When login authenticates Then it uses the equivalent dummy verifier", async () => {
    const pool = new LoginPool();
    const calls = [];

    const result = await authenticateLogin({
        pool,
        username: "absent",
        password: "wrong",
        clientIp: "127.0.0.1",
        clock: () => now,
        createSessionId: () => "a".repeat(43),
        passwordVerifier: async (hash, password) => {
            calls.push({hash, password});
            return false;
        },
    });

    assert.deepEqual(result, {kind: "invalid"});
    assert.equal(calls.length, 1);
    assert.notEqual(calls[0].hash, "stored-password-hash");
});

test("Given an absent username When the default verifier runs Then the Argon2id dummy check returns a generic failure", async () => {
    const pool = new LoginPool();

    const result = await authenticateLogin({
        pool,
        username: "absent",
        password: "wrong",
        clientIp: "127.0.0.1",
        clock: () => now,
    });

    assert.deepEqual(result, {kind: "invalid"});
});

test("Given five account failures When another credential is submitted Then it remains generic and creates no session", async () => {
    const pool = new LoginPool({account: account({failed_login_attempts: 4})});

    const result = await authenticate({pool, password: "wrong"});

    assert.deepEqual(result, {kind: "invalid"});
    assert.equal(pool.account.locked_until.getTime(), new Date("2026-01-01T12:15:00.000Z").getTime());
    assert.equal(pool.sessions.length, 0);
});

test("Given twenty recent attempts from an IP When another login is submitted Then it returns a bounded Retry-After result without authentication", async () => {
    const pool = new LoginPool({account: account(), ipAttempts: 20});

    const result = await authenticate({pool});

    assert.deepEqual(result, {kind: "rate_limited", retryAfterSeconds: 900});
    assert.equal(pool.sessions.length, 0);
});

test("Given credential submissions When the login HTTP route handles them Then it issues only regenerated sessions and generic failures", async () => {
    const validPool = new LoginPool({account: account()});
    const invalidPool = new LoginPool({account: account()});
    const limitedPool = new LoginPool({account: account(), ipAttempts: 20});
    const createServer = async pool => {
        const app = await createApp({
            pool,
            sessionPolicy,
            sessionMiddleware: (_req, _res, next) => next(),
            clock: () => now,
            passwordVerifier: async (hash, value) => hash === "stored-password-hash" && value === "correct",
            csrf: {
                createCsrfToken: () => "c".repeat(43),
                ensureLoginCsrfContext: async () => ({token: "c".repeat(43)}),
                validateLoginCsrfToken: async () => true,
            },
        });
        const server = app.listen(0);
        await once(server, "listening");
        return server;
    };
    const validServer = await createServer(validPool);
    const invalidServer = await createServer(invalidPool);
    const limitedServer = await createServer(limitedPool);

    try {
        const valid = await fetch(`http://127.0.0.1:${validServer.address().port}/login`, {
            method: "POST",
            headers: {"content-type": "application/x-www-form-urlencoded", cookie: `__Host-session=${signedCookie("b".repeat(43))}`, origin: "http://127.0.0.1"},
            body: "username=participant-a&password=correct&csrf_token=" + "c".repeat(43),
            redirect: "manual",
        });
        const invalid = await fetch(`http://127.0.0.1:${invalidServer.address().port}/login`, {
            method: "POST",
            headers: {"content-type": "application/x-www-form-urlencoded", origin: "http://127.0.0.1"},
            body: "username=participant-a&password=wrong&csrf_token=" + "c".repeat(43),
        });
        const login = await fetch(`http://127.0.0.1:${validServer.address().port}/login`);
        const limited = await fetch(`http://127.0.0.1:${limitedServer.address().port}/login`, {
            method: "POST",
            headers: {"content-type": "application/x-www-form-urlencoded", origin: "http://127.0.0.1"},
            body: "username=participant-a&password=correct&csrf_token=" + "c".repeat(43),
        });

        assert.equal(valid.status, 302);
        assert.match(valid.headers.get("set-cookie") || "", /^__Host-session=(?!b{43})[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; Secure; SameSite=Lax/);
        assert.deepEqual(validPool.deletedSessionIds, ["b".repeat(43)]);
        assert.equal(invalid.status, 401);
        assert.match(await invalid.text(), /Invalid username or password\./);
        assert.doesNotMatch(await login.text(), /Select Reviewer|reviewer\.id/);
        assert.equal(invalidPool.sessions.length, 0);
        assert.equal(limited.status, 429);
        assert.equal(limited.headers.get("retry-after"), "900");
        assert.equal(limitedPool.sessions.length, 0);
    } finally {
        await Promise.all([ validServer, invalidServer, limitedServer ].map(server => new Promise((resolve, reject) => {
            server.close(error => error ? reject(error) : resolve());
        })));
    }
});
