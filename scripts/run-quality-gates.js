import {readdirSync} from "node:fs";
import {spawnSync} from "node:child_process";

const root = new URL("../", import.meta.url);
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const unitExcluded = new Set(["private-discard-http.test.js", "current-runtime-e2e.test.js"]);
const integrationRequirements = [
    ["STUDY_HTTP_BASE_URL", "a prepared current-runtime study database"],
    ["STUDY_HTTP_REPLAY_CARD_ID", "a pending card reserved for replay assertions"],
    ["STUDY_HTTP_NAVIGATION_CARD_ID", "a separate pending card reserved for navigation assertions"],
    ["STUDY_HTTP_CONCURRENT_CARD_ID", "a separate pending card reserved for concurrency assertions"],
    ["STUDY_HTTP_CATEGORY_ID", "a category identifier for navigation assertions"],
];

const commandText = (command, args) => [command, ...args].join(" ");
const report = (gate, command, args, exitCode) => {
    process.stdout.write(`${JSON.stringify({gate, command: commandText(command, args), exitCode})}\n`);
};

const runCommand = (gate, command, args) => {
    const result = spawnSync(command, args, {cwd: root, stdio: "inherit", env: process.env});
    const exitCode = result.error ? 1 : (result.status ?? 1);
    report(gate, command, args, exitCode);
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

const testFiles = () => readdirSync(new URL("../test/", import.meta.url))
    .filter(file => file.endsWith(".test.js") && !unitExcluded.has(file))
    .sort()
    .map(file => `test/${file}`);

const requireTarget = (gate, requirements) => {
    const missing = requirements.find(([variable]) => !process.env[variable]);
    const args = ["run", `test:${gate}`];
    if (!missing && gate === "integration") {
        const cardIds = [
            process.env.STUDY_HTTP_REPLAY_CARD_ID,
            process.env.STUDY_HTTP_NAVIGATION_CARD_ID,
            process.env.STUDY_HTTP_CONCURRENT_CARD_ID,
        ];
        if (new Set(cardIds).size !== cardIds.length) {
            process.stderr.write("integration gate requires distinct card IDs for replay, navigation, and concurrency scenarios.\n");
            report(gate, npmCommand, args, 2);
            return 2;
        }
    }
    if (!missing) return 0;
    const [variable, description] = missing;
    process.stderr.write(`${gate} gate requires ${variable}: ${description}.\n`);
    report(gate, npmCommand, args, 2);
    return 2;
};

const gate = process.argv[2];
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
    exitCode = runCommand("unit", process.execPath, ["--test", ...testFiles()]);
    break;
case "integration":
    exitCode = requireTarget("integration", integrationRequirements);
    if (exitCode !== 0) break;
    exitCode = runCommand("integration", process.execPath, ["--test", "test/private-discard-http.test.js"]);
    break;
case "e2e":
    exitCode = requireTarget("e2e", [["STUDY_E2E_BASE_URL", "a reachable current-runtime deployment"]]);
    if (exitCode !== 0) break;
    exitCode = runCommand("e2e", process.execPath, ["--test", "test/current-runtime-e2e.test.js"]);
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

process.exitCode = exitCode;
