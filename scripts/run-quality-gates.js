import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {integrationTestPlan, unitTestFiles} from "./quality-gate-inventory.js";
import {isPassingTestSummary} from "./quality-gate-test-guard.js";

const root = new URL("../", import.meta.url);
const testReporter = fileURLToPath(new URL("./quality-gate-test-reporter.js", import.meta.url));
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const integrationPlan = integrationTestPlan();
const integrationRequirements = [
    ["LABELER_READINESS_TEST_IMAGE", "a server image built from the validated revision for the preparation-entrypoint fixture"],
];
const unitRequirements = [
    ["LABELER_READINESS_TEST_IMAGE", "a server image built from the validated revision for the release-handoff test"],
];

const commandText = (command, args) => [command, ...args].join(" ");
const report = (gate, command, args, exitCode, details = {}) => {
    const commandValue = command === null ? null : commandText(command, args);
    process.stdout.write(`${JSON.stringify({gate, command: commandValue, exitCode, ...details})}\n`);
};

const runCommand = (gate, command, args) => {
    const result = spawnSync(command, args, {cwd: root, stdio: "inherit", env: process.env});
    const exitCode = result.error ? 1 : (result.status ?? 1);
    report(gate, command, args, exitCode, {signal: result.signal ?? null});
    return exitCode;
};

const runCommands = (gate, commands) => {
    let firstFailure = 0;
    for (const [command, args] of commands) {
        const exitCode = runCommand(gate, command, args);
        if (exitCode !== 0 && firstFailure === 0) firstFailure = exitCode;
    }
    return firstFailure;
};

const buildTestArgs = (files, summaryPath) => {
    if (files.length === 0) return null;
    return [
        "--test",
        "--test-concurrency=1",
        "--test-reporter=spec",
        `--test-reporter=${testReporter}`,
        "--test-reporter-destination=stdout",
        `--test-reporter-destination=${summaryPath}`,
        ...files,
    ];
};

const readTestSummary = summaryPath => {
    try {
        return JSON.parse(readFileSync(summaryPath, "utf8"));
    } catch {
        return null;
    }
};

const runTestCommand = (gate, files, {env = process.env, stdio = "inherit"} = {}) => {
    if (files.length === 0) {
        process.stderr.write(`${gate} gate selected no test files; refusing Node test auto-discovery.\n`);
        report(gate, null, [], 2, {executed: false, selectedFiles: 0, testSummary: null, signal: null});
        return {exitCode: 2, executed: false, selectedFiles: 0, summary: null, signal: null, processExitCode: null};
    }

    const directory = mkdtempSync(join(tmpdir(), "labeler-quality-gate-"));
    const summaryPath = join(directory, "summary.json");
    const args = buildTestArgs(files, summaryPath);
    const childEnvironment = {...env};
    delete childEnvironment.NODE_TEST_CONTEXT;

    try {
        writeFileSync(summaryPath, "", {mode: 0o600});
        const result = spawnSync(process.execPath, args, {cwd: root, stdio, env: childEnvironment});
        const summary = readTestSummary(summaryPath);
        const processExitCode = result.error ? 1 : result.status;
        const runnerExitCode = processExitCode ?? 1;
        const exitCode = runnerExitCode === 0 && !isPassingTestSummary(summary) ? 1 : runnerExitCode;

        report(gate, process.execPath, args, exitCode, {
            executed: true,
            selectedFiles: files.length,
            testSummary: summary,
            signal: result.signal ?? null,
        });
        return {exitCode, executed: true, selectedFiles: files.length, summary, signal: result.signal ?? null, processExitCode};
    } finally {
        rmSync(directory, {recursive: true, force: true});
    }
};

const requireTarget = (gate, requirements) => {
    const missing = requirements.find(([variable]) => !process.env[variable]);
    const args = ["run", `test:${gate}`];
    if (!missing) return 0;
    const [variable, description] = missing;
    process.stderr.write(`${gate} gate requires ${variable}: ${description}.\n`);
    report(gate, npmCommand, args, 2);
    return 2;
};

const runGate = gate => {
    let exitCode;
    switch (gate) {
    case "lint":
        exitCode = runCommands("lint", [
            [npmCommand, ["run", "lint:js"]],
            [npmCommand, ["run", "lint:css"]],
            [npmCommand, ["run", "lint:md"]],
        ]);
        break;
    case "unit":
        exitCode = requireTarget("unit", unitRequirements);
        if (exitCode !== 0) break;
        exitCode = runTestCommand("unit", unitTestFiles()).exitCode;
        break;
    case "integration":
        exitCode = requireTarget("integration", integrationRequirements);
        if (exitCode !== 0) break;
        exitCode = runTestCommand("integration", integrationPlan.fixture).exitCode;
        break;
    case "e2e":
        exitCode = requireTarget("e2e", [["STUDY_E2E_BASE_URL", "a reachable current-runtime deployment"]]);
        if (exitCode !== 0) break;
        exitCode = runTestCommand("e2e", ["test/current-runtime-e2e.test.js"]).exitCode;
        break;
    case "quality":
        exitCode = runCommands("quality", [
            [npmCommand, ["run", "lint"]],
            [npmCommand, ["run", "test:unit"]],
        ]);
        break;
    default:
        process.stderr.write("Usage: node scripts/run-quality-gates.js <quality|lint|unit|integration|e2e>\n");
        exitCode = 2;
    }
    return exitCode;
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    process.exitCode = runGate(process.argv[2]);
}

export {buildTestArgs, runCommand, runTestCommand};
