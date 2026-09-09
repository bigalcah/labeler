import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {readFile} from "node:fs/promises";
import test from "node:test";

const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

test("quality gates define a working CSS lint command", () => {
    assert.match(packageJson.scripts["lint:css"], /stylelint ["']?public\/css\/\*\*\/\*\.css/);
    assert.equal(packageJson.devDependencies["stylelint-config-standard"], "^39.0.1");
    assert.equal(packageJson.scripts.quality, "node scripts/run-quality-gates.js quality");
    assert.equal(packageJson.scripts["test:unit"], "node scripts/run-quality-gates.js unit");
    assert.equal(packageJson.scripts["test:study-http"], "node scripts/run-quality-gates.js integration");
});

test("integration gate fails without a prepared runtime target", () => {
    assert.throws(() => execFileSync("npm", ["run", "test:integration"], {
        env: {...process.env, STUDY_HTTP_BASE_URL: ""},
        stdio: "pipe",
    }), error => error.status === 2 && error.stderr.includes("STUDY_HTTP_BASE_URL"));
});

test("integration gate rejects missing scenario variables before invoking HTTP tests", () => {
    assert.throws(() => execFileSync("npm", ["run", "test:integration"], {
        env: {
            ...process.env,
            STUDY_HTTP_BASE_URL: "http://127.0.0.1:1",
            STUDY_HTTP_SESSION_COOKIE: "session",
            STUDY_HTTP_CSRF_TOKEN: "csrf",
        },
        stdio: "pipe",
    }), error => error.status === 2
        && error.stderr.includes("STUDY_HTTP_REPLAY_CARD_ID")
        && !error.stdout.includes("TAP version"));
});

test("integration gate rejects reused stateful card identifiers", () => {
    const environment = {
        ...process.env,
        STUDY_HTTP_BASE_URL: "http://127.0.0.1:1",
        STUDY_HTTP_SESSION_COOKIE: "session",
        STUDY_HTTP_CSRF_TOKEN: "csrf",
        STUDY_HTTP_REPLAY_CARD_ID: "same-card",
        STUDY_HTTP_NAVIGATION_CARD_ID: "same-card",
        STUDY_HTTP_CONCURRENT_CARD_ID: "concurrent-card",
        STUDY_HTTP_CATEGORY_ID: "category",
    };
    assert.throws(() => execFileSync("npm", ["run", "test:integration"], {env: environment, stdio: "pipe"}),
        error => error.status === 2 && error.stderr.includes("distinct card IDs"));
});

test("E2E gate fails without a reachable runtime target", () => {
    assert.throws(() => execFileSync("npm", ["run", "test:e2e"], {
        env: {...process.env, STUDY_E2E_BASE_URL: ""},
        stdio: "pipe",
    }), error => error.status === 2 && error.stderr.includes("STUDY_E2E_BASE_URL"));
});
