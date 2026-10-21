import {readdirSync} from "node:fs";

const testDirectory = new URL("../test/", import.meta.url);
const unitRuntimeFiles = new Set(["private-discard-http.test.js", "current-runtime-e2e.test.js"]);
const integrationStages = Object.freeze({
    fixture: Object.freeze([
        "test/copilot-369-preparation.integration.js",
        "test/copilot-369-private-flow.integration.js",
        "test/copilot-369-persistence.integration.js",
        "test/copilot-369-cutover-concurrency.integration.js",
        "test/copilot-369-cutover.integration.js",
        "test/copilot-369-history.integration.js",
        "test/copilot-369-schema.integration.js",
        "test/study-readiness.integration.js",
        "test/study-state-fingerprint.integration.js",
        "test/study-readiness-entrypoint.integration.js",
        "test/study-normalization.integration.js",
        "test/study-bootstrap-ledger.integration.js",
        "test/host-normalization-handoff.integration.js",
        "test/github-enrichment-multi-study.integration.js",
        "test/runtime-failure-rehearsal.integration.js",
    ]),
    runtime: Object.freeze(["test/multi-study-hostile-e2e.integration.js"]),
    deployment: Object.freeze(["test/deployment-harness.integration.js"]),
});

const unitTestFiles = () => readdirSync(testDirectory)
    .filter(file => file.endsWith(".test.js") && !unitRuntimeFiles.has(file))
    .sort()
    .map(file => `test/${file}`);

const integrationTestPlan = () => {
    const actualFiles = readdirSync(testDirectory)
        .filter(file => file.endsWith(".integration.js"))
        .sort()
        .map(file => `test/${file}`);
    const plannedFiles = Object.values(integrationStages).flat().sort();
    if (JSON.stringify(actualFiles) !== JSON.stringify(plannedFiles)) {
        throw new Error("integration inventory must explicitly map every test/*.integration.js to one runtime stage");
    }
    return integrationStages;
};

export {integrationTestPlan, unitRuntimeFiles, unitTestFiles};
