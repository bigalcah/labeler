import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const readRepositoryFile = relativePath => readFile(path.join(root, relativePath), "utf8");

test("compose gates server startup on the guarded study preparation service", async () => {
    const compose = await readRepositoryFile("deployment/docker-compose.yml");

    assert.doesNotMatch(compose, /test-data\/(?:label\.txt|reviewer\.txt|instance\.tsv)/);
    assert.match(compose, /labeling-study-prepare:/);
    assert.match(compose, /labeling-study-prepare:[\s\S]*labeling-database:\s*\n\s*condition: service_healthy/);
    assert.match(compose, /labeling-server:[\s\S]*labeling-study-prepare:\s*\n\s*condition: service_completed_successfully/);
    assert.match(compose, /merged_after_rework_cards_seed_20260510\.csv:.*prs\.csv:ro/);
});

test("server image contains the guarded migration and bootstrap inputs", async () => {
    const dockerfile = await readRepositoryFile("deployment/server/Dockerfile");

    assert.match(dockerfile, /COPY schema\/migrations schema\/migrations\//);
    assert.match(dockerfile, /postgresql\d*-client/);
    assert.match(dockerfile, /COPY scripts scripts\//);
});

test("deployment preparation selects a guarded database path before bootstrap", async () => {
    const script = await readRepositoryFile("scripts/prepare-study-deployment.sh");
    const foundationPosition = script.indexOf("migrate:study");
    const cleanCheckPosition = script.indexOf("retire:legacy:clean-check");
    const retirementPosition = script.indexOf("retire:legacy:apply");
    const bootstrapPosition = script.indexOf("bootstrap:study");

    assert.notEqual(foundationPosition, -1);
    assert.notEqual(cleanCheckPosition, -1);
    assert.notEqual(retirementPosition, -1);
    assert.notEqual(bootstrapPosition, -1);
    assert.match(script, /clean\)/);
    assert.match(script, /existing\)/);
    assert.match(script, /clean\)[\s\S]*retire:legacy:clean-check[\s\S]*migrate:study/);
    assert.match(
        script,
        /existing\)[\s\S]*LEGACY_RETIREMENT_CONFIRM[\s\S]*migrate:study[\s\S]*retire:legacy:apply/,
    );
    assert.ok(cleanCheckPosition < foundationPosition);
    assert.ok(foundationPosition < retirementPosition);
    assert.ok(cleanCheckPosition < bootstrapPosition);
    assert.ok(retirementPosition < bootstrapPosition);
});

test("retirement apply mode reads the explicit migration only after guarded readiness", async () => {
    const script = await readRepositoryFile("scripts/retire-legacy-labeler.js");
    const readinessPosition = script.indexOf("const state = await checkRetirementReadiness");
    const migrationPosition = script.indexOf("002_retire_legacy_labeler.sql");
    const applyPosition = script.indexOf("pool.query(migration)");

    assert.match(script, /--apply/);
    assert.match(script, /LEGACY_RETIREMENT_CONFIRM/);
    assert.ok(readinessPosition < migrationPosition);
    assert.ok(migrationPosition < applyPosition);
});
