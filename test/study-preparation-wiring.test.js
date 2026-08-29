import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";

const compose = await readFile(new URL("../deployment/docker-compose.yml", import.meta.url), "utf8");
const prepare = await readFile(new URL("../scripts/prepare-study-deployment.sh", import.meta.url), "utf8");
const bootstrap = await readFile(new URL("../scripts/bootstrap-study.js", import.meta.url), "utf8");
const enrichment = await readFile(new URL("../scripts/enrich-study.js", import.meta.url), "utf8");
const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

test("GitHub configuration and secret wiring is limited to study preparation", () => {
    const prepareBlock = compose.match(/ {2}labeling-study-prepare:[\s\S]*? {2}labeling-server:/)?.[0] || "";
    const serverBlock = compose.match(/ {2}labeling-server:[\s\S]*?volumes:/)?.[0] || compose.slice(compose.indexOf("  labeling-server:"));
    assert.match(prepareBlock, /GITHUB_ENRICHMENT_ENABLED/);
    assert.match(prepareBlock, /GITHUB_CREDENTIAL_ALIASES/);
    assert.match(prepareBlock, /GITHUB_TOKEN/);
    assert.match(prepareBlock, /GITHUB_DEFAULT_ALIAS/);
    assert.doesNotMatch(serverBlock, /GITHUB_/);
    assert.match(prepare, /GITHUB_ENRICHMENT_ENABLED=.*false/);
    assert.match(prepare, /npm run bootstrap:study[\s\S]*npm run enrich:study/);
    assert.equal(packageJson.scripts["enrich:study"], "node scripts/enrich-study.js");
    assert.doesNotMatch(compose, /owner\/repository/);
});

test("enrichment is a separate post-bootstrap command with an explicit disabled guard", () => {
    assert.doesNotMatch(bootstrap, /readGithubConfig|createGithubClient|enrichStudyWithGithub/);
    assert.match(enrichment, /const githubConfig = readGithubConfig\(\);/);
    assert.match(enrichment, /if \(!githubConfig\.enabled\)/);
    assert.match(enrichment, /if \(githubConfig\.enabled\)/);
    assert.match(enrichment, /createGithubClient\(\{config: githubConfig\}\)/);
});

test("a paused enrichment prevents successful preparation and server startup", () => {
    assert.match(enrichment, /result\.status === "PAUSED"/);
    assert.match(enrichment, /process\.exitCode = [1-9]/);
    assert.match(prepare, /set -eu/);
    assert.match(prepare, /npm run enrich:study/);
    assert.match(compose, /condition: service_completed_successfully/);
});
