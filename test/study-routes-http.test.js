import assert from "node:assert/strict";
import {once} from "node:events";
import test from "node:test";
import {createApp} from "../app.js";

const context = Object.freeze({
    accountId: "account-1",
    studyId: "study-1",
    participantId: 11,
    participantKey: "participant-a",
});
const pendingCardId = "550e8400-e29b-41d4-a716-446655440000";
const csrfToken = "t".repeat(43);

class StudyHttpPool {
    constructor({pending = pendingCardId} = {}) {
        this.pending = pending;
        this.queries = [];
    }

    async query(sql, parameters = []) {
        this.queries.push({sql, parameters});
        if (sql.includes("SELECT study_card.pr_card_id AS id")) {
            return {rows: this.pending ? [ {id: this.pending} ] : []};
        }
        if (sql.includes("COUNT(study_card.pr_card_id)")) {
            return {rows: [ {total: 300, classified: 2, discarded: 1, pending: 297} ]};
        }
        if (sql.startsWith("INSERT INTO participant_category")) {
            return {rows: [ {id: "category-1", raw_name: parameters[1]} ]};
        }
        throw new Error(`Unexpected pool query: ${sql}`);
    }
}

const start = async ({pool, authenticated = true} = {}) => {
    const app = await createApp({
        pool,
        sessionMiddleware: (req, res, next) => {
            req.sessionContext = authenticated ? context : null;
            req.csrfToken = authenticated ? csrfToken : null;
            res.locals.sessionContext = req.sessionContext;
            res.locals.csrfToken = req.csrfToken;
            next();
        },
    });
    const server = app.listen(0);
    await once(server, "listening");
    return server;
};

const close = server => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));

test("study routes reject unauthenticated requests and old participant routes are unregistered", async () => {
    const server = await start({pool: new StudyHttpPool(), authenticated: false});
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    try {
        assert.equal((await fetch(`${baseUrl}/queue`)).status, 401);
        assert.equal((await fetch(`${baseUrl}/progress`)).status, 401);
        assert.equal((await fetch(`${baseUrl}/participant-b/queue`)).status, 404);
        assert.equal((await fetch(`${baseUrl}/instances?participant=participant-b`)).status, 404);
    } finally {
        await close(server);
    }
});

test("canonical queue ignores supplied study and participant identifiers", async () => {
    const pool = new StudyHttpPool();
    const server = await start({pool});
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    try {
        const response = await fetch(`${baseUrl}/queue?participant=participant-b&study_id=study-2`, {redirect: "manual"});
        assert.equal(response.status, 303);
        assert.equal(response.headers.get("location"), `/queue/${pendingCardId}`);
        assert.deepEqual(pool.queries[0].parameters, [context.studyId, context.participantId]);
    } finally {
        await close(server);
    }
});

test("progress and category creation use session ownership despite supplied identifiers", async () => {
    const pool = new StudyHttpPool();
    const server = await start({pool});
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    try {
        const progress = await fetch(`${baseUrl}/progress?participant=participant-b&study_id=study-2`);
        const progressHtml = await progress.text();
        assert.equal(progress.status, 200);
        assert.match(progressHtml, /participant-a/);
        assert.doesNotMatch(progressHtml, /participant-b|study-2/);

        const category = await fetch(`${baseUrl}/categories`, {
            method: "POST",
            headers: {"content-type": "application/x-www-form-urlencoded", origin: "http://127.0.0.1", "x-csrf-token": csrfToken},
            body: "name=Private+category&participant_id=22&study_id=study-2",
        });
        assert.equal(category.status, 201);
        assert.deepEqual(pool.queries.at(-1).parameters, [context.participantId, "Private category", "private category"]);
    } finally {
        await close(server);
    }
});

test("empty canonical queue renders 200 without leaking identifiers", async () => {
    const pool = new StudyHttpPool({pending: null});
    const server = await start({pool});
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    try {
        const response = await fetch(`${baseUrl}/queue?participant=participant-b`);
        const html = await response.text();
        assert.equal(response.status, 200);
        assert.match(html, /Classification queue complete/);
        assert.doesNotMatch(html, /participant-b/);
    } finally {
        await close(server);
    }
});
