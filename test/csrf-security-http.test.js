import assert from "node:assert/strict";
import {once} from "node:events";
import {readFile} from "node:fs/promises";
import test from "node:test";
import {createApp} from "../app.js";

const context = Object.freeze({
    accountId: "account-1",
    studyId: "study-1",
    participantId: 11,
    participantKey: "participant-a",
});
const tokenA = "a".repeat(43);
const tokenB = "b".repeat(43);

class SecurityPool {
    constructor() {
        this.categoryWrites = 0;
        this.contexts = new Map();
    }

    async query(sql, parameters = []) {
        if (sql.startsWith("INSERT INTO participant_category")) {
            this.categoryWrites += 1;
            return {rows: [{id: "category-1", raw_name: parameters[1]}]};
        }
        if (sql.startsWith("INSERT INTO login_csrf_context")) {
            this.contexts.set(parameters[0], {token: parameters[1], expires_at: parameters[2]});
            return {rows: []};
        }
        if (sql.startsWith("SELECT token, expires_at FROM login_csrf_context")) {
            const csrfContext = this.contexts.get(parameters[0]);
            return {rows: csrfContext ? [csrfContext] : []};
        }
        throw new Error(`Unexpected pool query: ${sql}`);
    }
}

const sessionMiddleware = sessions => (req, res, next) => {
    const sessionId = req.headers.cookie?.split("=")[1];
    const session = sessions.get(sessionId);
    req.sessionContext = session ? context : null;
    req.csrfToken = session?.token || null;
    res.locals.sessionContext = req.sessionContext;
    res.locals.csrfToken = req.csrfToken;
    next();
};

const startServer = async ({pool, sessions = new Map([["session-a", {token: tokenA}]])} = {}) => {
    const app = await createApp({
        pool,
        sessionMiddleware: sessionMiddleware(sessions),
        originPolicy: {nodeEnv: "production", appOrigin: "https://study.example"},
    });
    const server = app.listen(0);
    await once(server, "listening");
    return server;
};

const closeServer = server => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));

const categoryRequest = (baseUrl, options = {}) => fetch(`${baseUrl}/categories`, {
    method: "POST",
    headers: {
        cookie: "__Host-session=session-a",
        origin: "https://study.example",
        "content-type": "application/x-www-form-urlencoded",
        "x-csrf-token": tokenA,
        ...options.headers,
    },
    body: "name=Private+category",
});

test("mutation security rejects missing, invalid, cross-session CSRF and Origin before database writes", async () => {
    const pool = new SecurityPool();
    const server = await startServer({pool, sessions: new Map([
        ["session-a", {token: tokenA}],
        ["session-b", {token: tokenB}],
    ])});
    const baseUrl = `http://127.0.0.1:${server.address().port}`;

    try {
        const rejected = await Promise.all([
            categoryRequest(baseUrl, {headers: {"x-csrf-token": undefined}}),
            categoryRequest(baseUrl, {headers: {"x-csrf-token": "x".repeat(43)}}),
            categoryRequest(baseUrl, {headers: {"x-csrf-token": tokenB}}),
            categoryRequest(baseUrl, {headers: {origin: "https://hostile.example"}}),
            categoryRequest(baseUrl, {headers: {origin: undefined}}),
        ]);

        assert.deepEqual(rejected.map(response => response.status), [403, 403, 403, 403, 403]);
        assert.equal(pool.categoryWrites, 0);
    } finally {
        await closeServer(server);
    }
});

test("mutation security accepts a valid session token from the request header", async () => {
    const pool = new SecurityPool();
    const server = await startServer({pool});
    const baseUrl = `http://127.0.0.1:${server.address().port}`;

    try {
        const response = await categoryRequest(baseUrl);

        assert.equal(response.status, 201);
        assert.equal(pool.categoryWrites, 1);
    } finally {
        await closeServer(server);
    }
});

test("rendered login responses include CSP and views have no inline scripts or handlers", async () => {
    const pool = new SecurityPool();
    const server = await startServer({pool, sessions: new Map()});
    const baseUrl = `http://127.0.0.1:${server.address().port}`;

    try {
        const response = await fetch(`${baseUrl}/login`);
        const html = await response.text();
        const review = await readFile(new URL("../views/review.ejs", import.meta.url), "utf8");
        const card = await readFile(new URL("../views/partials/instance/data.ejs", import.meta.url), "utf8");

        assert.equal(response.status, 200);
        assert.match(response.headers.get("content-security-policy") || "", /default-src 'self'/);
        assert.doesNotMatch(response.headers.get("content-security-policy") || "", /unsafe-(?:inline|eval)/);
        assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/i);
        assert.doesNotMatch(review, /onsubmit\s*=/i);
        assert.doesNotMatch(review, /<script\s*>/i);
        assert.doesNotMatch(card, /<script\s*>/i);
    } finally {
        await closeServer(server);
    }
});
