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
const csrfToken = "t".repeat(43);
const ownedCategoryId = "550e8400-e29b-41d4-a716-446655440000";
const foreignCategoryId = "550e8400-e29b-41d4-a716-446655440001";

class CategoryPool {
    constructor() {
        this.connections = 0;
        this.categories = new Map([
            [ownedCategoryId, {id: ownedCategoryId, study_id: "study-1", participant_id: 11, raw_name: "Needs review", normalized_name: "needs review", updated_at: "2026-01-01T00:00:00.000Z"}],
            [foreignCategoryId, {id: foreignCategoryId, study_id: "study-2", participant_id: 11, raw_name: "Private to another study", normalized_name: "private to another study", updated_at: "2026-01-01T00:00:00.000Z"}],
        ]);
        this.classifications = new Map([
            ["study-1:card-1", ownedCategoryId],
            ["study-2:card-2", foreignCategoryId],
        ]);
        this.locks = new Map();
        this.version = 1;
        this.writes = [];
    }

    async connect() {
        this.connections += 1;
        let releaseLock = null;
        const client = {
            query: async (sql, parameters = []) => {
                if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") {
                    if (sql !== "BEGIN" && releaseLock) {
                        releaseLock();
                        releaseLock = null;
                    }
                    return {rows: []};
                }
                if (sql.includes("SELECT id, updated_at") && sql.includes("FOR UPDATE")) {
                    const [categoryId, studyId, participantId] = parameters;
                    const previousLock = this.locks.get(categoryId) || Promise.resolve();
                    let release;
                    const currentLock = new Promise(resolve => { release = resolve; });
                    this.locks.set(categoryId, currentLock);
                    await previousLock;
                    releaseLock = () => {
                        release();
                        if (this.locks.get(categoryId) === currentLock) this.locks.delete(categoryId);
                    };
                    const category = this.categories.get(categoryId);
                    return {rows: category?.study_id === studyId && category.participant_id === participantId ? [{id: category.id, updated_at: category.updated_at}] : []};
                }
                if (sql.startsWith("UPDATE participant_category")) {
                    const [categoryId, studyId, participantId, rawName, normalizedName, expectedUpdatedAt] = parameters;
                    const category = this.categories.get(categoryId);
                    if (!category || category.study_id !== studyId || category.participant_id !== participantId
                        || (expectedUpdatedAt !== null && category.updated_at !== expectedUpdatedAt)) {
                        return {rows: []};
                    }
                    if ([...this.categories.values()].some(candidate => candidate.id !== categoryId
                        && candidate.study_id === studyId
                        && candidate.participant_id === participantId
                        && candidate.normalized_name === normalizedName)) {
                        const error = new Error("duplicate category");
                        error.code = "23505";
                        throw error;
                    }
                    category.raw_name = rawName;
                    category.normalized_name = normalizedName;
                    category.updated_at = `2026-01-01T00:00:00.00${this.version++}Z`;
                    this.writes.push({categoryId, studyId, participantId, rawName, normalizedName});
                    return {rows: [{id: category.id, raw_name: category.raw_name, updated_at: category.updated_at}]};
                }
                throw new Error(`Unexpected query: ${sql}`);
            },
            release: () => {},
        };
        return client;
    }

    async query() {
        throw new Error("The rename route must use a transaction");
    }
}

const start = async pool => {
    const app = await createApp({
        pool,
        sessionMiddleware: (req, res, next) => {
            req.sessionContext = context;
            req.csrfToken = csrfToken;
            res.locals.sessionContext = context;
            res.locals.csrfToken = csrfToken;
            next();
        },
    });
    const server = app.listen(0);
    await once(server, "listening");
    return server;
};

const close = server => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
const renameRequest = (baseUrl, categoryId, body, options = {}) => fetch(`${baseUrl}/categories/${categoryId}`, {
    method: "PATCH",
    headers: {
        "content-type": "application/json",
        origin: "http://127.0.0.1",
        "x-csrf-token": csrfToken,
        ...options.headers,
    },
    body: JSON.stringify(body),
});

test("renaming uses session ownership, normalizes the name, and preserves classifications", async () => {
    const pool = new CategoryPool();
    const server = await start(pool);
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    try {
        const response = await renameRequest(baseUrl, ownedCategoryId, {
            name: "  Needs   Tests  ",
            expected_updated_at: "2026-01-01T00:00:00.000Z",
            participant_id: 22,
            study_id: "study-2",
        });
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), {
            id: ownedCategoryId,
            raw_name: "Needs   Tests",
            updated_at: "2026-01-01T00:00:00.001Z",
        });
        assert.equal(pool.classifications.get("study-1:card-1"), ownedCategoryId);
        assert.deepEqual(pool.writes[0], {
            categoryId: ownedCategoryId,
            studyId: context.studyId,
            participantId: context.participantId,
            rawName: "Needs   Tests",
            normalizedName: "needs tests",
        });
    } finally {
        await close(server);
    }
});

test("renaming rejects empty names and duplicate normalized names", async () => {
    const pool = new CategoryPool();
    pool.categories.set("550e8400-e29b-41d4-a716-446655440002", {
        id: "550e8400-e29b-41d4-a716-446655440002",
        study_id: context.studyId,
        participant_id: 11,
        raw_name: "Needs Tests",
        normalized_name: "needs tests",
        updated_at: "2026-01-01T00:00:00.000Z",
    });
    const server = await start(pool);
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    try {
        assert.equal((await renameRequest(baseUrl, ownedCategoryId, {name: "   "})).status, 400);
        assert.equal((await renameRequest(baseUrl, ownedCategoryId, {name: 42})).status, 400);
        assert.equal((await renameRequest(baseUrl, ownedCategoryId, {name: "x".repeat(161)})).status, 400);
        assert.equal((await renameRequest(baseUrl, ownedCategoryId, {name: " needs   tests "})).status, 409);
        assert.equal(pool.writes.length, 0);
    } finally {
        await close(server);
    }
});

test("renaming a category from another study for the same participant is unreadable and does not write", async () => {
    const pool = new CategoryPool();
    const server = await start(pool);
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    try {
        const response = await renameRequest(baseUrl, foreignCategoryId, {name: "Changed"});
        assert.equal(response.status, 404);
        assert.equal(pool.writes.length, 0);
        assert.equal(pool.categories.get(foreignCategoryId).raw_name, "Private to another study");
        assert.equal(pool.classifications.get("study-1:card-1"), ownedCategoryId);
        assert.equal(pool.classifications.get("study-2:card-2"), foreignCategoryId);
    } finally {
        await close(server);
    }
});

test("CSRF and Origin reject category renames before opening a database transaction", async () => {
    const pool = new CategoryPool();
    const server = await start(pool);
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    try {
        const responses = await Promise.all([
            renameRequest(baseUrl, ownedCategoryId, {name: "No token"}, {headers: {"x-csrf-token": undefined}}),
            renameRequest(baseUrl, ownedCategoryId, {name: "Bad origin"}, {headers: {origin: "http://hostile.example"}}),
        ]);
        assert.deepEqual(responses.map(response => response.status), [403, 403]);
        assert.equal(pool.connections, 0);
        assert.equal(pool.writes.length, 0);
        assert.equal(pool.categories.get(ownedCategoryId).raw_name, "Needs review");
    } finally {
        await close(server);
    }
});

test("a stale concurrent rename loses after the category row lock is released", async () => {
    const pool = new CategoryPool();
    const server = await start(pool);
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    try {
        const responses = await Promise.all([
            renameRequest(baseUrl, ownedCategoryId, {name: "First name", expected_updated_at: "2026-01-01T00:00:00.000Z"}),
            renameRequest(baseUrl, ownedCategoryId, {name: "Second name", expected_updated_at: "2026-01-01T00:00:00.000Z"}),
        ]);
        assert.deepEqual(responses.map(response => response.status).sort((left, right) => left - right), [200, 409]);
        assert.equal(pool.writes.length, 1);
    } finally {
        await close(server);
    }
});

test("review UI exposes owned category rename controls without inline handlers", async () => {
    const review = await readFile(new URL("../views/review.ejs", import.meta.url), "utf8");
    const script = await readFile(new URL("../public/js/review.js", import.meta.url), "utf8");
    assert.match(review, /data-category-rename/);
    assert.match(review, /id="rename-category-form"/);
    assert.doesNotMatch(review, /onsubmit\s*=/i);
    assert.match(script, /method: "PATCH"/);
    assert.doesNotMatch(script, /participant_id|study_id/);
});
