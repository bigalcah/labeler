import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {readFile, stat} from "node:fs/promises";
import test from "node:test";

const harnessUrl = new URL("../scripts/test-study-deployment.sh", import.meta.url);
const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const dockerIgnore = await readFile(new URL("../.dockerignore", import.meta.url), "utf8");
const integration = await readFile(new URL("./multi-study-hostile-e2e.integration.js", import.meta.url), "utf8");

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

test("clean dual-profile harness invokes authenticated CSV and snapshot-race checks before drift", async () => {
    const harness = await readFile(harnessUrl, "utf8");

    assert.match(harness, /multi-study-e2e-credentials\.json/);
    assert.equal(/multi-study-export-hmac-secret|STUDY_MULTI_STUDY_E2E_EXPORT_HMAC_SECRET_FILE/.test(harness), false);
    assert.equal(/multi-study-export(?:-manifest)?/.test(harness), false);
    assert.match(harness, /STUDY_MULTI_STUDY_E2E_ISOLATED_RUNTIME=true/);
    assert.match(harness, /STUDY_MULTI_STUDY_E2E_BASE_URL="https:\/\/127\.0\.0\.1:\$CLEAN_HTTPS_PORT"/);
    assert.match(harness, /STUDY_MULTI_STUDY_E2E_VIRTUAL_HOST=harness\.test/);
    assert.match(harness, /STUDY_MULTI_STUDY_E2E_DATABASE_HOST="\$CLEAN_DATABASE_HOST"/);
    assert.match(harness, /unset NODE_TEST_CONTEXT/);
    assert.equal(harness.includes("STUDY_MULTI_STUDY_E2E_EXPORT_OUTPUT"), false);
    assert.match(harness, /snapshot_export_cards=30/);
    assert.match(harness, /snapshot_export_participants=2/);
    assert.match(harness, /followup_export_participants=3/);
    assert.match(integration, /from "csv-parse\/sync"/);
    assert.match(integration, /createStudyComparisonExport/);
    assert.match(integration, /study-export:study/);
    assert.match(integration, /\/export\/download/);
    assert.match(integration, /snapshotEstablished/);
    assert.equal(integration.includes("spawnSync"), false);
    assert.equal(integration.includes("[\"export:study\""), false);
    assert.equal(integration.includes("manifest.json"), false);
    assert.equal(integration.includes(".split(\"\\n\")"), false);
    assert.match(harness, /MULTI_STUDY_HOSTILE_E2E_OK/);
    assert.ok(harness.indexOf("multi-study-hostile-e2e.integration.js") > harness.indexOf("SEED_SQL"));
    assert.ok(harness.indexOf("multi-study-hostile-e2e.integration.js") < harness.indexOf("rm -sf labeling-study-prepare labeling-server labeling-caddy"));
});

test("deployment harness has a separate explicit package gate", () => {
    assert.equal(packageJson.scripts["test:deployment"],
        "node --test test/deployment-harness.integration.js");
    assert.match(dockerIgnore, /^scripts\/test-study-deployment\.sh$/m);
});

test("offline export command and entry point are retired", async () => {
    assert.equal(packageJson.scripts["export:study"], undefined);
    await assert.rejects(stat(new URL("../scripts/export-study.js", import.meta.url)), {code: "ENOENT"});
});
