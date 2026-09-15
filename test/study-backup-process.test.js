import assert from "node:assert/strict";
import {watch} from "node:fs";
import {access, mkdtemp, readFile, rm, writeFile} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {buildCreatePipeline, buildRestorePipeline, inspectEncryptedArchive} from "../util/study-backup-process.js";

const database = {host: "db", port: "5432", database: "labeling", user: "labeler"};

const createExecutable = async (directory, name, content) => {
    await writeFile(path.join(directory, name), content, {mode: 0o700});
};

const waitForFile = filePath => new Promise((resolve, reject) => {
    let completed = false;
    const finish = error => {
        if (completed) return;
        completed = true;
        clearTimeout(timeout);
        watcher.close();
        if (error) reject(error);
        else resolve();
    };
    const watcher = watch(path.dirname(filePath), (_event, fileName) => {
        if (fileName === path.basename(filePath)) finish();
    });
    const timeout = setTimeout(() => finish(new Error(`Timed out waiting for ${path.basename(filePath)}`)), 1_000);
    access(filePath).then(() => finish(), error => {
        if (error.code !== "ENOENT") finish(error);
    });
});

const rejectWithin = (operation, message) => new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(message)), 500);
    operation.then(resolve, reject).finally(() => clearTimeout(timeout));
});

const resolveWithin = (operation, message) => new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(message)), 500);
    operation.then(result => {
        clearTimeout(timeout);
        resolve(result);
    }, error => {
        clearTimeout(timeout);
        reject(error);
    });
});

const preserveTestError = async (directory, fixture, run) => {
    let testError;
    try {
        await run();
    } catch (error) {
        testError = error;
    }
    let cleanupError;
    try {
        const processId = Number(await readFile(fixture.pidPath, "utf8"));
        try {
            process.kill(processId, "SIGTERM");
        } catch (error) {
            if (error.code !== "ESRCH") throw error;
        }
        await waitForFile(fixture.terminatedPath);
    } catch (error) {
        cleanupError = error;
    }
    try {
        await rm(directory, {recursive: true});
    } catch (error) {
        cleanupError ??= error;
    }
    if (testError && cleanupError) throw new AggregateError([ testError, cleanupError ], "Test and fixture cleanup failed");
    if (testError || cleanupError) throw testError ?? cleanupError;
};

test("backup and restore pipelines stream encryption and address only the isolated target", () => {
    const createPipeline = buildCreatePipeline({
        snapshotId: "snapshot-1",
        database,
        encryptionKeyFile: "/external/backup.key",
        outputPath: "/external/study.dump.enc",
    });
    assert.equal(createPipeline.producer.command, "pg_dump");
    assert.equal(createPipeline.producer.args.some(argument => argument.startsWith("--file=")), false);
    assert.deepEqual(createPipeline.consumer.args.slice(-4), [
        "-pass", "file:/external/backup.key", "-out", "/external/study.dump.enc",
    ]);

    const restorePipeline = buildRestorePipeline({
        archivePath: "/external/study.dump.enc",
        encryptionKeyFile: "/external/backup.key",
        targetDatabase: {...database, host: "isolated-db", database: "labeling_restore", user: "restore"},
    });
    assert.equal(restorePipeline.consumer.command, "pg_restore");
    assert.equal(restorePipeline.consumer.args.includes("--host=isolated-db"), true);
    assert.equal(restorePipeline.consumer.args.includes("--dbname=labeling_restore"), true);
    assert.equal(restorePipeline.consumer.args.includes("--dbname=labeling"), false);
});

test("Given an isolated restore target, when building the restore pipeline, then pg_restore receives no archive operand", () => {
    const restorePipeline = buildRestorePipeline({
        archivePath: "/external/study.dump.enc",
        encryptionKeyFile: "/external/backup.key",
        targetDatabase: {...database, host: "isolated-db", database: "labeling_restore", user: "restore"},
    });

    assert.deepEqual(restorePipeline.consumer.args, [
        "--exit-on-error",
        "--no-owner",
        "--no-privileges",
        "--no-password",
        "--host=isolated-db",
        "--port=5432",
        "--username=restore",
        "--dbname=labeling_restore",
    ]);
});

test("Given encrypted archive inspection, when pg_restore lists standard input, then it receives only --list", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "labeler-study-backup-inspect-args-"));
    try {
        await createExecutable(directory, "openssl", "#!/bin/sh\nexit 0\n");
        await createExecutable(directory, "pg_restore", "#!/bin/sh\n[ \"$#\" -eq 1 ] && [ \"$1\" = \"--list\" ] || exit 41\n");
        await assert.doesNotReject(() => inspectEncryptedArchive({archivePath: path.join(directory, "study.dump.enc"),
            encryptionKeyFile: path.join(directory, "backup.key"), environment: {PATH: directory}}));
    } finally {
        await rm(directory, {recursive: true});
    }
});

test("Given a live decryptor, when pg_restore fails early, then inspection rejects and terminates the decryptor", {timeout: 2_000}, async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "labeler-study-backup-inspect-teardown-"));
    const fixture = {
        pidPath: path.join(directory, "producer.pid"),
        startedPath: path.join(directory, "producer.started"),
        terminatedPath: path.join(directory, "producer.terminated"),
    };
    await preserveTestError(directory, fixture, async () => {
        await createExecutable(directory, "openssl", `#!${process.execPath}\nconst {writeFileSync} = require("node:fs");\nwriteFileSync(process.env.PRODUCER_PID_FILE, String(process.pid));\nwriteFileSync(process.env.PRODUCER_STARTED_FILE, "");\nprocess.stdout.write("ready\\n");\nprocess.on("SIGTERM", () => { writeFileSync(process.env.PRODUCER_TERMINATED_FILE, ""); process.exit(0); });\nsetInterval(() => {}, 1_000);\n`);
        await createExecutable(directory, "pg_restore", `#!${process.execPath}\nprocess.stdin.once("data", () => process.exit(47));\n`);
        const inspection = inspectEncryptedArchive({archivePath: path.join(directory, "study.dump.enc"),
            encryptionKeyFile: path.join(directory, "backup.key"), environment: {PATH: directory,
                PRODUCER_PID_FILE: fixture.pidPath, PRODUCER_STARTED_FILE: fixture.startedPath, PRODUCER_TERMINATED_FILE: fixture.terminatedPath}});
        await assert.rejects(() => rejectWithin(inspection, "inspection did not reject promptly"), /pg_restore failed with exit code 47/);
        await waitForFile(fixture.terminatedPath);
    });
});

test("Given a live decryptor, when pg_restore exits successfully early, then inspection resolves and terminates the decryptor", {timeout: 2_000}, async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "labeler-study-backup-inspect-early-success-"));
    const fixture = {
        pidPath: path.join(directory, "producer.pid"),
        startedPath: path.join(directory, "producer.started"),
        terminatedPath: path.join(directory, "producer.terminated"),
    };
    const consumerExitedPath = path.join(directory, "consumer.exited");
    await preserveTestError(directory, fixture, async () => {
        await createExecutable(directory, "openssl", `#!${process.execPath}\nconst {writeFileSync} = require("node:fs");\nwriteFileSync(process.env.PRODUCER_PID_FILE, String(process.pid));\nwriteFileSync(process.env.PRODUCER_STARTED_FILE, "");\nprocess.stdout.write("ready\\n");\nprocess.on("SIGTERM", () => { writeFileSync(process.env.PRODUCER_TERMINATED_FILE, ""); process.exit(0); });\nsetInterval(() => {}, 1_000);\n`);
        await createExecutable(directory, "pg_restore", `#!${process.execPath}\nconst {writeFileSync} = require("node:fs");\nprocess.stdin.once("data", () => { writeFileSync(process.env.CONSUMER_EXITED_FILE, ""); process.exit(0); });\n`);
        const inspection = inspectEncryptedArchive({archivePath: path.join(directory, "study.dump.enc"),
            encryptionKeyFile: path.join(directory, "backup.key"), environment: {PATH: directory,
                CONSUMER_EXITED_FILE: consumerExitedPath, PRODUCER_PID_FILE: fixture.pidPath,
                PRODUCER_STARTED_FILE: fixture.startedPath, PRODUCER_TERMINATED_FILE: fixture.terminatedPath}});
        await waitForFile(consumerExitedPath);
        await assert.doesNotReject(() => resolveWithin(inspection, "inspection did not resolve after pg_restore exited early"));
        await waitForFile(fixture.terminatedPath);
    });
});

test("Given a failing decryptor, when pg_restore remains active, then inspection rejects and terminates pg_restore", {timeout: 2_000}, async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "labeler-study-backup-inspect-producer-failure-"));
    const fixture = {
        pidPath: path.join(directory, "consumer.pid"),
        startedPath: path.join(directory, "producer.started"),
        terminatedPath: path.join(directory, "consumer.terminated"),
    };
    const consumerStartedPath = path.join(directory, "consumer.started");
    await preserveTestError(directory, fixture, async () => {
        await createExecutable(directory, "openssl", `#!${process.execPath}\nconst {access, watch} = require("node:fs");\nconst path = require("node:path");\nlet completed = false;\nconst fail = () => {\n    if (completed) return;\n    completed = true;\n    watcher.close();\n    process.exit(43);\n};\nconst watcher = watch(path.dirname(process.env.CONSUMER_STARTED_FILE), (_event, fileName) => {\n    if (fileName === path.basename(process.env.CONSUMER_STARTED_FILE)) fail();\n});\naccess(process.env.CONSUMER_STARTED_FILE, error => {\n    if (!error) fail();\n    else if (error.code !== "ENOENT") process.exit(44);\n});\n`);
        await createExecutable(directory, "pg_restore", `#!${process.execPath}\nconst {writeFileSync} = require("node:fs");\nwriteFileSync(process.env.CONSUMER_PID_FILE, String(process.pid));\nprocess.on("SIGTERM", () => { writeFileSync(process.env.CONSUMER_TERMINATED_FILE, ""); process.exit(0); });\nwriteFileSync(process.env.CONSUMER_STARTED_FILE, "");\nsetInterval(() => {}, 1_000);\n`);
        const inspection = inspectEncryptedArchive({archivePath: path.join(directory, "study.dump.enc"),
            encryptionKeyFile: path.join(directory, "backup.key"), environment: {PATH: directory,
                CONSUMER_PID_FILE: fixture.pidPath, CONSUMER_TERMINATED_FILE: fixture.terminatedPath,
                CONSUMER_STARTED_FILE: consumerStartedPath, PRODUCER_STARTED_FILE: fixture.startedPath}});
        await assert.rejects(() => rejectWithin(inspection, "inspection did not reject after openssl failed"), /openssl failed with exit code 43/);
        await waitForFile(fixture.terminatedPath);
    });
});
