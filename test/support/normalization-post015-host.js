import {execFile, spawn} from "node:child_process";
import {mkdtemp, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {promisify} from "node:util";
import path from "node:path";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import pg from "pg";
import {closeCopilot369Database, startCopilot369Database} from "./copilot-369-fixture.js";
import {probePost015Normalization} from "./normalization-post015-prepare.js";

const execute = promisify(execFile);
const root = path.resolve(new URL("../..", import.meta.url).pathname);

const runHostFixture = async (script, input, archive = null) => {
    const directory = await mkdtemp(path.join(tmpdir(), "post015-host-"));
    try {
        await writeFile(path.join(directory, "observations.json"), JSON.stringify(input), {mode: 0o600});
        if (archive) await writeFile(path.join(directory, "archive.dump"), archive, {mode: 0o400});
        const result = await execute("docker", ["run", "--rm", "--network", "none", "--read-only",
            "--mount", `type=bind,src=${root},dst=/workspace,readonly`,
            "--mount", `type=bind,src=${directory},dst=/fixture`, "python:3.12-alpine", "python3", "-B",
            `/workspace/test/fixtures/host/${script}`], {timeout: 30000, maxBuffer: 1048576});
        return JSON.parse(result.stdout);
    } finally {
        await rm(directory, {recursive: true, force: true});
    }
};

const runDockerInput = async (argumentsList, input) => new Promise((resolve, reject) => {
    const child = spawn("docker", argumentsList, {stdio: ["pipe", "ignore", "pipe"]});
    let stderr = "";
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.on("error", reject);
    child.stdin.on("error", error => {
        if (error.code !== "EPIPE") reject(error);
    });
    child.on("close", code => {
        if (code === 0) resolve();
        else reject(new Error(`Isolated PostgreSQL restore failed: ${stderr}`));
    });
    child.stdin.end(input);
});

const utcSecond = () => new Date(Math.floor(Date.now() / 1000) * 1000).toISOString().replace(".000Z", "Z");

const runPost015BackupBinding = async ({database, profiles, legacyCsvPath, pre015, post015}) => {
    const restoredDatabase = await startCopilot369Database();
    let restoredPool;
    try {
        const restoreName = `post015_restore_${randomUUID().replaceAll("-", "")}`;
        await restoredDatabase.pool.query(`CREATE DATABASE "${restoreName}" TEMPLATE template0`);
        const backupStartedAt = utcSecond();
        const {stdout: archive} = await execute("docker", ["exec", database.containerName, "pg_dump",
            "--format=custom", "--no-owner", "--no-acl", "--username", "labeler_test", "--dbname",
            database.pool.options.database], {encoding: "buffer", maxBuffer: 67108864, timeout: 120000});
        const backupCompletedAt = utcSecond();
        await runDockerInput(["exec", "-i", restoredDatabase.containerName, "pg_restore", "--clean", "--if-exists",
            "--exit-on-error", "--no-owner", "--no-privileges", "--username", "labeler_test", "--dbname", restoreName], archive);
        const restoreCompletedAt = utcSecond();
        restoredPool = new pg.Pool({...restoredDatabase.pool.options, database: restoreName, max: 1});
        const restored = await probePost015Normalization({pool: restoredPool, containerName: restoredDatabase.containerName},
            profiles, legacyCsvPath);
        assert.equal(restored.applied015, true);
        assert.equal(restored.observation.schema, post015.schema);
        assert.equal(restored.observation.dataBundle, post015.dataBundle);
        assert.equal(restored.observation.schemaFingerprint, post015.schemaFingerprint);
        assert.equal(restored.observation.fingerprint, post015.fingerprint);
        const fresh = await probePost015Normalization(database, profiles, legacyCsvPath);
        assert.equal(fresh.observation.schemaFingerprint, post015.schemaFingerprint);
        assert.equal(fresh.observation.fingerprint, post015.fingerprint);
        return {
            ...await runHostFixture("normalization-backup-binding.py", {
                pre015, post015: fresh.observation, restored: restored.observation,
                backupStartedAt, backupCompletedAt, restoreCompletedAt,
            }, archive),
            restoredObservation: restored.observation,
        };
    } finally {
        if (restoredPool) await restoredPool.end();
        await closeCopilot369Database(restoredDatabase);
        await assert.rejects(execute("docker", ["inspect", restoredDatabase.containerName]));
    }
};

const runCommitted015Reconcile = async (pre015, post015) =>
    runHostFixture("normalization-reconcile.py", {pre015, post015});

export {runCommitted015Reconcile, runPost015BackupBinding};
