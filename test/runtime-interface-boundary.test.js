import assert from "node:assert/strict";
import {once} from "node:events";
import {access, readFile, readdir} from "node:fs/promises";
import path from "node:path";
import test, {after, before} from "node:test";
import {fileURLToPath} from "node:url";
import express from "express";
import {router} from "express-file-routing";
import {isUuid} from "../routes/[name]/queue/[id]/classify/index.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const fromRoot = relativePath => path.join(root, relativePath);

const removedRuntimeFiles = [
    "routes/conflicts/index.js",
    "routes/conflicts/[id]/index.js",
    "routes/conflicts/[id]/discard/index.js",
    "routes/conflicts/[id]/review/index.js",
    "routes/discards/remarks/index.js",
    "routes/instances/[id]/discard/index.js",
    "routes/instances/[id]/review/index.js",
    "routes/export/index.js",
    "routes/export/[target]/index.js",
    "views/export.ejs",
];

const protectedRuntimeFiles = new Map([
    [ "routes/instances/index.js", /FROM pr_cards/ ],
    [ "routes/instances/[id]/index.js", /FROM pr_cards/ ],
    [ "routes/[name]/queue/index.js", /res\.render\("review"/ ],
    [ "routes/[name]/queue/[id]/classify/index.js", /pr_classification/ ],
    [ "routes/[name]/categories/index.js", /participant_category/ ],
    [ "routes/progress/index.js", /FROM pr_cards/ ],
    [ "views/review.ejs", /\/categories/ ],
]);

const removedRequests = [
    [ "GET", "/conflicts" ],
    [ "GET", "/conflicts/card-id" ],
    [ "POST", "/conflicts/card-id/discard" ],
    [ "POST", "/conflicts/card-id/review" ],
    [ "GET", "/discards/remarks" ],
    [ "POST", "/instances/card-id/discard" ],
    [ "POST", "/instances/card-id/review" ],
    [ "GET", "/export" ],
    [ "GET", "/export/review" ],
];

let server;
let baseUrl;

before(async () => {
    const app = express();
    app.set("views", fromRoot("views"));
    app.set("view engine", "ejs");
    app.use("/", await router());
    server = app.listen(0);
    await once(server, "listening");
    baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
}));

const collectFiles = async directory => {
    const entries = await readdir(directory, {withFileTypes: true});
    const files = await Promise.all(entries.map(entry => {
        const entryPath = path.join(directory, entry.name);
        return entry.isDirectory() ? collectFiles(entryPath) : [ entryPath ];
    }));
    return files.flat();
};

test("file-routed legacy review, discard, conflict, and export interfaces are absent", async () => {
    await Promise.all(removedRuntimeFiles.map(async relativePath => {
        await assert.rejects(access(fromRoot(relativePath)), {code: "ENOENT"});
    }));
});

for (const [ method, route ] of removedRequests) {
    test(`${method} ${route} responds as an unregistered route`, async () => {
        const response = await fetch(`${baseUrl}${route}`, {method});

        assert.equal(response.status, 404);
    });
}

test("runtime routes and views contain no retired legacy interface references", async () => {
    const runtimeFiles = (await Promise.all([
        collectFiles(fromRoot("routes")),
        collectFiles(fromRoot("views")),
    ])).flat();
    const runtimeSource = (await Promise.all(runtimeFiles.map(file => readFile(file, "utf8")))).join("\n");

    assert.doesNotMatch(runtimeSource, /instance_review|instance_discard|conflict_resolution_(?:review|discard)/);
    assert.doesNotMatch(runtimeSource, /["'`](?:\/conflicts|\/export)(?:[/?"'`])/);
});

test("MVP card, queue, category, classification, progress, and review surfaces remain", async () => {
    await Promise.all(Array.from(protectedRuntimeFiles, async ([ relativePath, expectedSource ]) => {
        const source = await readFile(fromRoot(relativePath), "utf8");
        assert.match(source, expectedSource);
    }));
});

test("navigation links pending cards directly and omits retired entry points", async () => {
    const navigationSource = await Promise.all([
        readFile(fromRoot("views/index.ejs"), "utf8"),
        readFile(fromRoot("views/partials/header.ejs"), "utf8"),
    ]);

    for (const source of navigationSource) {
        assert.match(source, /\/instances\?status=pending/);
        assert.match(source, /\/progress/);
        assert.doesNotMatch(source, /\/conflicts|\/export/);
    }
});

test("classification UUID validation rejects malformed route and category identifiers", () => {
    assert.equal(isUuid("550e8400-e29b-41d4-a716-446655440000"), true);
    assert.equal(isUuid("999999"), false);
    assert.equal(isUuid("not-a-uuid"), false);
    assert.equal(isUuid(undefined), false);
});
