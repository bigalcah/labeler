import assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtemp, readdir} from "node:fs/promises";
import {promisify} from "node:util";
import {tmpdir} from "node:os";
import {once} from "node:events";
import test from "node:test";
import {createApp} from "../app.js";

const run = promisify(execFile);

class FakePool {
    constructor({fail = false} = {}) {
        this.fail = fail;
        this.queries = [];
    }

    async query(sql, params) {
        this.queries.push({sql, params});
        await Promise.resolve();
        if (this.fail) throw new Error("injected database failure");
        if (sql.includes("FROM study") && sql.includes("bootstrap_state")) {
            return {rows: [{id: "study-1", expected_card_count: 300}]};
        }
        if (sql.includes("FROM study_participant")) {
            return {rows: [{study_id: "study-1", id: "participant-1", name: "alice", ordinal: 1}]};
        }
        if (sql.includes("FROM study_card")) {
            return {rows: [{total: 300, classified: 1, discarded: 2, pending: 297}]};
        }
        throw new Error(`Unexpected query: ${sql}`);
    }
}

class ReadyStudyPool {
    constructor(rows) {
        this.rows = rows;
    }

    async query(sql) {
        if (sql.includes("FROM study") && sql.includes("bootstrap_state")) return {rows: this.rows};
        throw new Error(`Unexpected query: ${sql}`);
    }
}

const listen = async app => {
    const server = app.listen(0);
    await once(server, "listening");
    return server;
};

test("factory import in an isolated process creates no listener or log artifact", async () => {
    const cwd = await mkdtemp(`${tmpdir()}/labeler-factory-`);
    const appUrl = new URL("../app.js", import.meta.url).href;
    const {stdout} = await run(process.execPath, [
        "--input-type=module",
        "-e",
        `import ${JSON.stringify(appUrl)}; console.log(JSON.stringify(process._getActiveHandles().filter(handle => handle.constructor.name === "Server").length));`,
    ], {cwd});

    assert.equal(stdout.trim(), "0");
    assert.deepEqual(await readdir(cwd), []);
});

test("real database route uses injected pool and middleware dependencies", async () => {
    const pool = new FakePool();
    let sessionSeen = false;
    let loggerSeen = false;
    const app = await createApp({
        pool,
        sessionMiddleware: (_req, _res, next) => {
            sessionSeen = true;
            next();
        },
        clock: () => new Date("2026-01-01T00:00:00.000Z"),
        logger: (_req, _res, next) => {
            loggerSeen = true;
            next();
        },
    });
    const server = await listen(app);

    const response = await fetch(`http://127.0.0.1:${server.address().port}/progress?participant=alice`);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /alice/);
    assert.equal(pool.queries.length, 3);
    assert.equal(sessionSeen, true);
    assert.equal(loggerSeen, true);

    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    assert.equal(server.listening, false);
});

test("async database failure after an await reaches controlled error middleware", async () => {
    const app = await createApp({pool: new FakePool({fail: true})});
    const server = await listen(app);

    const response = await fetch(`http://127.0.0.1:${server.address().port}/progress?participant=alice`);
    assert.equal(response.status, 500);
    assert.match(await response.text(), /injected database failure/);

    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    assert.equal(server.listening, false);
});

test("health and unregistered paths keep their HTTP contracts", async () => {
    const app = await createApp({pool: new FakePool()});
    const server = await listen(app);
    const baseUrl = `http://127.0.0.1:${server.address().port}`;

    const health = await fetch(`${baseUrl}/actuator/health`);
    assert.equal(health.status, 200);
    assert.equal((await health.json()).status, "UP");

    const missing = await fetch(`${baseUrl}/__not-registered`);
    assert.equal(missing.status, 404);

    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    assert.equal(server.listening, false);
});

test("queue returns 503 when the injected pool has no READY study", async () => {
    const app = await createApp({pool: new ReadyStudyPool([])});
    const server = await listen(app);

    try {
        const response = await fetch(`http://127.0.0.1:${server.address().port}/javier/queue`);
        assert.equal(response.status, 503);
    } finally {
        await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
    assert.equal(server.listening, false);
});

test("queue returns 503 when the injected pool has multiple READY studies", async () => {
    const app = await createApp({pool: new ReadyStudyPool([{id: "study-1"}, {id: "study-2"}])});
    const server = await listen(app);

    try {
        const response = await fetch(`http://127.0.0.1:${server.address().port}/javier/queue`);
        assert.equal(response.status, 503);
    } finally {
        await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
    assert.equal(server.listening, false);
});
