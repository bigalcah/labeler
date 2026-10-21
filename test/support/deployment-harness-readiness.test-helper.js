import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {chmod, mkdtemp, readFile, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import test from "node:test";

const waitHelperUrl = new URL("./wait-for-docker-log.js", import.meta.url);

const createFakeDocker = async ({logs, running}) => {
    const directory = await mkdtemp(path.join(tmpdir(), "labeler-fake-docker-"));
    const statePath = path.join(directory, "state.json");
    const dockerPath = path.join(directory, "docker");
    await writeFile(statePath, JSON.stringify({calls: [], logs, running}));
    await writeFile(dockerPath, `#!/usr/bin/env node
import {readFileSync, writeFileSync} from "node:fs";
const statePath = process.env.FAKE_DOCKER_STATE_PATH;
const state = JSON.parse(readFileSync(statePath, "utf8"));
const [operation] = process.argv.slice(2);
state.calls.push(operation);
if (operation === "logs") {
    const output = state.logs;
    state.logs = [];
    writeFileSync(statePath, JSON.stringify(state));
    process.stdout.write(output.length ? output.join("\\n") + "\\n" : "");
} else if (operation === "inspect") {
    writeFileSync(statePath, JSON.stringify(state));
    process.stdout.write(String(state.running) + "\\n");
} else {
    process.stderr.write("unexpected fake Docker command\\n");
    process.exitCode = 2;
}
`);
    await chmod(dockerPath, 0o700);
    return {directory, statePath};
};

const runWaiter = (statePath, directory, timeoutMilliseconds) => spawnSync(process.execPath,
    [waitHelperUrl.pathname, "handoff-owner", "HANDOFF_READY", String(timeoutMilliseconds)], {
        encoding: "utf8",
        env: {...process.env, PATH: `${directory}${path.delimiter}${process.env.PATH}`,
            FAKE_DOCKER_STATE_PATH: statePath},
        timeout: 5000,
    });

test("Given the lock owner emits one ready line and remains running When finite logs are checked Then readiness returns with the owner alive", async () => {
    const fakeDocker = await createFakeDocker({logs: ["HANDOFF_READY {\"operationId\":\"synthetic\"}"], running: true});
    try {
        const result = runWaiter(fakeDocker.statePath, fakeDocker.directory, 30000);

        assert.equal(result.status, 0, result.stderr);
        assert.equal(result.stdout, "{\"operationId\":\"synthetic\"}\n");
        const state = JSON.parse(await readFile(fakeDocker.statePath, "utf8"));
        assert.equal(state.running, true);
        assert.deepEqual(state.logs, []);
        assert.deepEqual(state.calls, ["logs", "inspect"]);
    } finally {
        await rm(fakeDocker.directory, {recursive: true, force: true});
    }
});

test("Given the lock owner emits no ready line When the bounded deadline expires Then the wait fails visibly", async () => {
    const fakeDocker = await createFakeDocker({logs: [], running: true});
    try {
        const result = runWaiter(fakeDocker.statePath, fakeDocker.directory, 800);

        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /Timed out waiting for HANDOFF_READY from handoff-owner/);
    } finally {
        await rm(fakeDocker.directory, {recursive: true, force: true});
    }
});

test("Given the lock owner exits before readiness When its finite logs are checked Then the wait fails visibly", async () => {
    const fakeDocker = await createFakeDocker({logs: [], running: false});
    try {
        const result = runWaiter(fakeDocker.statePath, fakeDocker.directory, 30000);

        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /handoff-owner exited before HANDOFF_READY/);
        const state = JSON.parse(await readFile(fakeDocker.statePath, "utf8"));
        assert.deepEqual(state.calls, ["logs", "inspect"]);
    } finally {
        await rm(fakeDocker.directory, {recursive: true, force: true});
    }
});
