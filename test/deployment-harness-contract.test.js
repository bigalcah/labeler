import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {readFile} from "node:fs/promises";
import test from "node:test";

const harnessUrl = new URL("../scripts/test-study-deployment.sh", import.meta.url);
const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const dockerIgnore = await readFile(new URL("../.dockerignore", import.meta.url), "utf8");

test("deployment harness fails with an actionable prerequisite when Docker is unavailable", () => {
    const result = spawnSync("/bin/sh", [harnessUrl.pathname], {
        env: {...process.env, PATH: "/nonexistent"},
        encoding: "utf8",
    });

    assert.equal(result.status, 2);
    assert.match(result.stderr, /^DEPLOYMENT_HARNESS_PREREQUISITE: docker CLI is required/m);
});

test("deployment harness scopes generated resources and cleanup to its unique projects", async () => {
    const harness = await readFile(harnessUrl, "utf8");

    assert.match(harness, /mktemp -d/);
    assert.match(harness, /umask 077/);
    assert.match(harness, /CLEAN_PROJECT=.*RUN_ID.*clean/);
    assert.match(harness, /EXISTING_PROJECT=.*RUN_ID.*existing/);
    assert.match(harness, /ports: !override/);
    assert.match(harness, /127\.0\.0\.1:\$\{HTTP_PORT\}:80/);
    assert.match(harness, /127\.0\.0\.1:\$\{HTTPS_PORT\}:443/);
    assert.match(harness, /name: \$\{project\}-data/);
    assert.match(harness, /name: \$\{project\}-network/);
    assert.match(harness, /docker compose -p "\$project"/);
    assert.match(harness, /down --remove-orphans/);
    assert.doesNotMatch(harness, /down (?:-v|--volumes)/);
    assert.doesNotMatch(harness, /docker (?:system|volume|network) prune/);
    assert.doesNotMatch(harness, /deployment\/\.env(?:\s|"|'|$)/);
});

test("deployment harness has a separate explicit package gate", () => {
    assert.equal(packageJson.scripts["test:deployment"],
        "node --test test/deployment-harness.integration.js");
    assert.match(dockerIgnore, /^scripts\/test-study-deployment\.sh$/m);
});
