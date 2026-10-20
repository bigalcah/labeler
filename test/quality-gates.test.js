import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {readdirSync} from "node:fs";
import {copyFile, mkdir, mkdtemp, readFile, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";
import test from "node:test";
import {integrationTestPlan, unitRuntimeFiles, unitTestFiles} from "../scripts/quality-gate-inventory.js";
import {isPassingTestSummary} from "../scripts/quality-gate-test-guard.js";
import {buildTestArgs, runCommand, runTestCommand} from "../scripts/run-quality-gates.js";

const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const gateFixture = name => fileURLToPath(new URL(`./fixtures/quality-gates/${name}.js`, import.meta.url));
const runGateFixture = name => runTestCommand("fixture", [gateFixture(name)], {stdio: "ignore"});
const assertIsolatedIntegrationInventoryRejected = async ({unassignedFile, duplicateFile} = {}) => {
    const directory = await mkdtemp(path.join(tmpdir(), "labeler-quality-gate-inventory-"));
    const scriptsDirectory = path.join(directory, "scripts");
    const testDirectory = path.join(directory, "test");
    const inventoryPath = path.join(scriptsDirectory, "quality-gate-inventory.js");

    try {
        await Promise.all([mkdir(scriptsDirectory), mkdir(testDirectory)]);
        await writeFile(path.join(directory, "package.json"), JSON.stringify({type: "module"}));
        const integrationFiles = readdirSync(new URL("../test/", import.meta.url))
            .filter(file => file.endsWith(".integration.js"))
            .sort();
        await Promise.all(integrationFiles
            .map(file => copyFile(new URL(`../test/${file}`, import.meta.url), path.join(testDirectory, file))));
        assert.deepEqual(readdirSync(testDirectory).sort(), integrationFiles);

        let inventorySource = await readFile(new URL("../scripts/quality-gate-inventory.js", import.meta.url), "utf8");
        if (unassignedFile) {
            const entry = `        "${unassignedFile}",\n`;
            assert.equal(inventorySource.split(entry).length - 1, 1);
            inventorySource = inventorySource.replace(entry, "");
        }
        if (duplicateFile) {
            const entry = `"${duplicateFile}"`;
            assert.equal(inventorySource.split(entry).length - 1, 1);
            inventorySource = inventorySource.replace(entry, `${entry},\n        ${entry}`);
        }
        await writeFile(inventoryPath, inventorySource);

        const isolatedInventory = await import(pathToFileURL(inventoryPath).href);
        assert.throws(isolatedInventory.integrationTestPlan,
            /integration inventory must explicitly map every test\/\*\.integration\.js to one runtime stage/);
    } finally {
        await rm(directory, {recursive: true, force: true});
    }
};

test("quality gates define a working CSS lint command", () => {
    assert.match(packageJson.scripts["lint:css"], /stylelint ["']?public\/css\/\*\*\/\*\.css/);
    assert.equal(packageJson.devDependencies["stylelint-config-standard"], "^39.0.1");
    assert.equal(packageJson.scripts.quality, "node scripts/run-quality-gates.js quality");
    assert.equal(packageJson.scripts["test:unit"], "node scripts/run-quality-gates.js unit");
    assert.equal(packageJson.scripts["test:study-http"], "node scripts/run-quality-gates.js integration");
});

test("unit selection includes every test file except the two separately gated runtime contracts", () => {
    const actual = readdirSync(new URL("../test/", import.meta.url))
        .filter(file => file.endsWith(".test.js"))
        .sort()
        .filter(file => !unitRuntimeFiles.has(file))
        .map(file => `test/${file}`);

    assert.deepEqual(unitTestFiles(), actual);
    assert.deepEqual([...unitRuntimeFiles].sort(), ["current-runtime-e2e.test.js", "private-discard-http.test.js"]);
});

test("unit selection fails before TAP when the current server image prerequisite is absent", () => {
    assert.throws(() => execFileSync("npm", ["run", "test:unit"], {
        env: {...process.env, LABELER_READINESS_TEST_IMAGE: ""},
        stdio: "pipe",
    }), error => error.status === 2
        && error.stderr.includes("LABELER_READINESS_TEST_IMAGE")
        && !error.stdout.includes("TAP version"));
});

test("every integration file belongs to one explicit stage with full fixture selection", () => {
    const plan = integrationTestPlan();
    const actual = readdirSync(new URL("../test/", import.meta.url))
        .filter(file => file.endsWith(".integration.js"))
        .sort()
        .map(file => `test/${file}`);
    const planned = Object.values(plan).flat().sort();

    assert.equal(plan.fixture.length, 14);
    assert.equal(plan.fixture.filter(file => file === "test/runtime-failure-rehearsal.integration.js").length, 1);
    assert.deepEqual(plan.runtime, ["test/multi-study-hostile-e2e.integration.js"]);
    assert.deepEqual(plan.deployment, ["test/deployment-harness.integration.js"]);
    assert.deepEqual(planned, actual);
    assert.equal(new Set(planned).size, planned.length);
});

test("integration inventory rejects a present but unassigned suite in an isolated fixture copy", async () => {
    await assertIsolatedIntegrationInventoryRejected({unassignedFile: "test/runtime-failure-rehearsal.integration.js"});
});

test("integration inventory rejects a duplicate suite mapping in an isolated fixture copy", async () => {
    await assertIsolatedIntegrationInventoryRejected({duplicateFile: "test/runtime-failure-rehearsal.integration.js"});
});

test("full Node test gates use sequential bounded concurrency", async () => {
    const runner = await readFile(new URL("../scripts/run-quality-gates.js", import.meta.url), "utf8");

    assert.match(runner, /runTestCommand\("unit", unitTestFiles\(\)\)/);
    assert.match(runner, /runTestCommand\("integration", integrationPlan\.fixture\)/);
    assert.match(runner, /runTestCommand\("e2e", \["test\/current-runtime-e2e\.test\.js"\]\)/);
    assert.ok(buildTestArgs(unitTestFiles(), "summary.json").includes("--test-concurrency=1"));
    assert.ok(buildTestArgs(integrationTestPlan().fixture, "summary.json").includes("--test-concurrency=1"));
    assert.ok(buildTestArgs(["test/current-runtime-e2e.test.js"], "summary.json").includes("--test-concurrency=1"));
});

test("Node test gate accepts a non-empty passing summary", () => {
    const result = runGateFixture("passing");

    assert.equal(result.exitCode, 0);
    assert.equal(result.summary.success, true);
    assert.equal(result.summary.counts.tests, 1);
    assert.equal(result.summary.counts.passed, 1);
    assert.equal(result.summary.counts.skipped, 0);
    assert.equal(result.summary.counts.cancelled, 0);
});

test("Node test gate preserves failing test results", () => {
    const result = runGateFixture("failing");

    assert.notEqual(result.exitCode, 0);
    assert.equal(result.summary.success, false);
    assert.equal(result.summary.counts.failed, 1);
});

test("Node test gate fails when Node reports a skipped test despite a successful process exit", () => {
    const result = runGateFixture("skipped");

    assert.equal(result.processExitCode, 0);
    assert.notEqual(result.exitCode, 0);
    assert.equal(result.summary.counts.skipped, 1);
});

test("Node test gate evaluates the cumulative summary across selected files", () => {
    const result = runTestCommand("fixture", [gateFixture("passing"), gateFixture("skipped")], {stdio: "ignore"});

    assert.equal(result.selectedFiles, 2);
    assert.equal(result.summary.counts.tests, 2);
    assert.equal(result.summary.counts.passed, 1);
    assert.equal(result.summary.counts.skipped, 1);
    assert.notEqual(result.exitCode, 0);
});

test("Node test gate fails when Node reports a cancelled test", () => {
    const result = runGateFixture("cancelled");

    assert.notEqual(result.exitCode, 0);
    assert.ok(result.summary.counts.cancelled > 0);
});

test("Node test gate rejects an empty selection before test auto-discovery", () => {
    const result = runTestCommand("fixture", [], {stdio: "ignore"});

    assert.equal(buildTestArgs([], "summary.json"), null);
    assert.equal(result.exitCode, 2);
    assert.equal(result.executed, false);
    assert.equal(result.selectedFiles, 0);
    assert.equal(result.summary, null);
});

test("Node test gate rejects a successful summary with zero tests", () => {
    assert.equal(isPassingTestSummary({
        success: true,
        counts: {tests: 0, passed: 0, failed: 0, skipped: 0, cancelled: 0, todo: 0},
    }), false);
});

test("a child command terminated by signal is not reported as successful", () => {
    assert.notEqual(runCommand("fixture", process.execPath, ["-e", "process.kill(process.pid, 'SIGTERM')"]), 0);
});

test("integration inventory fails before selection when the current server image prerequisite is absent", () => {
    assert.throws(() => execFileSync("npm", ["run", "test:integration"], {
        env: {...process.env, LABELER_READINESS_TEST_IMAGE: ""},
        stdio: "pipe",
    }), error => error.status === 2
        && error.stderr.includes("LABELER_READINESS_TEST_IMAGE")
        && !error.stdout.includes("TAP version"));
});

test("E2E gate fails without a reachable runtime target", () => {
    assert.throws(() => execFileSync("npm", ["run", "test:e2e"], {
        env: {...process.env, STUDY_E2E_BASE_URL: ""},
        stdio: "pipe",
    }), error => error.status === 2 && error.stderr.includes("STUDY_E2E_BASE_URL"));
});
