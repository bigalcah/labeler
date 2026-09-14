import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {watch} from "node:fs";
import {access, mkdtemp, readFile, rm, writeFile} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
    createStudyBackup,
    resolveStudyBackupInputs,
    verifyStudyBackup,
} from "../util/study-backup.js";
import {buildCreatePipeline, buildRestorePipeline, inspectEncryptedArchive} from "../util/study-backup-process.js";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const database = {host: "db", port: "5432", database: "labeling", user: "labeler"};
const snapshot = Object.fromEntries([ "cards", "classifications", "credentials" ]
    .map(name => [ name, {count: 0, sha256: "0".repeat(64)} ]));
const createProtectedFile = async (directory, name, content) => {
    const filePath = path.join(directory, name);
    await writeFile(filePath, content, {mode: 0o400});
    return filePath;
};
const createExecutable = async (directory, name, content) => {
    const executablePath = path.join(directory, name);
    await writeFile(executablePath, content, {mode: 0o700});
};
const waitForFile = filePath => new Promise((resolve, reject) => {
    let done = false;
    const finish = error => { if (done) return; done = true; clearTimeout(timeout); watcher.close(); error ? reject(error) : resolve(); };
    const watcher = watch(path.dirname(filePath), (_event, fileName) => { if (fileName === path.basename(filePath)) finish(); });
    const timeout = setTimeout(() => finish(new Error(`Timed out waiting for ${path.basename(filePath)}`)), 1_000);
    access(filePath).then(() => finish()).catch(() => {});
});

test("study backup inputs require external destinations, file secrets, encryption, and retention", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "labeler-study-backup-input-"));
    const passfile = await createProtectedFile(directory, "database.pgpass", "db:5432:labeling:labeler:secret\n");
    const keyFile = await createProtectedFile(directory, "backup.key", "backup-encryption-secret\n");
    const environment = {
        STUDY_BACKUP_ARCHIVE: path.join(directory, "study.dump.enc"),
        STUDY_BACKUP_MANIFEST: path.join(directory, "study.manifest.json"),
        STUDY_BACKUP_ENCRYPTION_KEY_FILE: keyFile,
        STUDY_BACKUP_RETENTION_DAYS: "30",
        PGHOST: "db",
        PGPORT: "5432",
        PGDATABASE: "labeling",
        PGUSER: "labeler",
        PGPASSFILE: passfile,
        PGPASSWORD: "must-not-propagate",
    };

    try {
        assert.throws(() => resolveStudyBackupInputs({...environment, STUDY_BACKUP_ARCHIVE: "relative.enc"}, root), /absolute path/);
        assert.throws(() => resolveStudyBackupInputs({...environment, STUDY_BACKUP_ARCHIVE: path.join(root, "study.enc")}, root), /outside the repository/);
        assert.throws(() => resolveStudyBackupInputs({...environment, STUDY_BACKUP_RETENTION_DAYS: "0"}, root), /positive integer/);
        assert.throws(() => resolveStudyBackupInputs({...environment, STUDY_BACKUP_ENCRYPTION_KEY_FILE: undefined}, root), /ENCRYPTION_KEY_FILE/);

        const inputs = resolveStudyBackupInputs(environment, root);
        assert.equal(inputs.retentionDays, 30);
        assert.equal(inputs.encryptionKeyFile, keyFile);
        assert.equal(Object.hasOwn(inputs.environment, "PGPASSWORD"), false);
        assert.equal(Object.hasOwn(inputs.environment, "STUDY_BACKUP_ENCRYPTION_PASSPHRASE"), false);
    } finally {
        await rm(directory, {recursive: true});
    }
});

test("study backup creation refuses existing destinations before database access", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "labeler-study-backup-existing-"));
    const archivePath = path.join(directory, "study.dump.enc");
    await writeFile(archivePath, "existing");
    let connected = false;

    try {
        await assert.rejects(() => createStudyBackup({
            inputs: {
                archivePath,
                manifestPath: path.join(directory, "study.manifest.json"),
                encryptionKeyFile: path.join(directory, "backup.key"),
                retentionDays: 30,
                database,
                environment: {},
            },
            pool: {connect: async () => {
                connected = true;
            }},
            createEncryptedArchive: async () => {},
        }), /Refusing to overwrite/);
        assert.equal(connected, false);
    } finally {
        await rm(directory, {recursive: true});
    }
});

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
    const producerPidPath = path.join(directory, "producer.pid");
    const producerStartedPath = path.join(directory, "producer.started"); const producerTerminatedPath = path.join(directory, "producer.terminated");
    let rejectionTimeout; let testError;
    try {
        await createExecutable(directory, "openssl", `#!${process.execPath}\nconst {writeFileSync} = require("node:fs");\nwriteFileSync(process.env.PRODUCER_PID_FILE, String(process.pid));\nwriteFileSync(process.env.PRODUCER_STARTED_FILE, "");\nprocess.on("SIGTERM", () => { writeFileSync(process.env.PRODUCER_TERMINATED_FILE, ""); process.exit(0); });\nsetInterval(() => {}, 1_000);\n`);
        await createExecutable(directory, "pg_restore", "#!/bin/sh\nwhile [ ! -f \"$PRODUCER_STARTED_FILE\" ]; do :; done\nexit 47\n");
        const inspection = inspectEncryptedArchive({archivePath: path.join(directory, "study.dump.enc"),
            encryptionKeyFile: path.join(directory, "backup.key"), environment: {PATH: directory,
                PRODUCER_PID_FILE: producerPidPath, PRODUCER_STARTED_FILE: producerStartedPath, PRODUCER_TERMINATED_FILE: producerTerminatedPath}});
        await assert.rejects(() => Promise.race([
            inspection,
            new Promise((_resolve, reject) => { rejectionTimeout = setTimeout(() => reject(new Error("inspection did not reject promptly")), 500); }),
        ]), /pg_restore failed with exit code 47/);
        await waitForFile(producerTerminatedPath);
    } catch (error) { testError = error; }
    clearTimeout(rejectionTimeout); let cleanupError;
    try {
        const producerPid = Number(await readFile(producerPidPath, "utf8"));
        try {
            process.kill(producerPid, "SIGTERM");
        } catch (error) {
            if (error.code !== "ESRCH") throw error;
        }
        await waitForFile(producerTerminatedPath);
    } catch (error) { cleanupError = error; } finally {
        await rm(directory, {recursive: true}).catch(error => { cleanupError ??= error; });
    }
    if (testError) throw testError; if (cleanupError) throw cleanupError;
});

test("study backup manifest binds encrypted archive, database, retention, and required data identities", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "labeler-study-backup-create-"));
    const archivePath = path.join(directory, "study.dump.enc");
    const manifestPath = path.join(directory, "study.manifest.json");
    const queries = [];
    const client = {
        query: async sql => {
            queries.push(sql);
            if (sql === "SELECT pg_export_snapshot() AS snapshot_id") return {rows: [ {snapshot_id: "snapshot-1"} ]};
            if (sql.includes("FROM pr_cards")) return {rows: [ {source_card_id: "card-1", content_checksum: "checksum-1"} ]};
            if (sql.includes("FROM pr_classification")) return {rows: [ {study_id: "study", pr_card_id: "card", participant_id: 1, category_id: "category", remarks: null} ]};
            if (sql.includes("FROM participant_account")) return {rows: [ {study_id: "study", reviewer_id: 1, normalized_username: "one", password_hash: "$argon2id$hash", enabled: true, credential_version: 4} ]};
            return {rows: []};
        },
        release: () => {},
    };

    try {
        const manifest = await createStudyBackup({
            inputs: {
                archivePath,
                manifestPath,
                encryptionKeyFile: path.join(directory, "backup.key"),
                retentionDays: 30,
                database,
                environment: {},
            },
            pool: {connect: async () => client},
            createEncryptedArchive: async ({outputPath, snapshotId}) => {
                assert.equal(snapshotId, "snapshot-1");
                await writeFile(outputPath, "encrypted-archive");
            },
            inspectEncryptedArchive: async () => {},
            now: () => new Date("2026-09-10T00:00:00.000Z"),
        });

        const cardsQuery = queries.find(query => query.includes("FROM pr_cards"));
        const classificationsQuery = queries.find(query => query.includes("FROM pr_classification"));
        const credentialsQuery = queries.find(query => query.includes("FROM participant_account"));
        assert.match(cardsQuery, /\bcontent_checksum\b/);
        assert.doesNotMatch(cardsQuery, /\brow_checksum\b/);
        assert.match(classificationsQuery, /\bremarks\b/);
        assert.doesNotMatch(classificationsQuery, /\bobservation\b/);
        assert.match(credentialsQuery, /\bnormalized_username\b/);
        assert.match(credentialsQuery, /\bpassword_hash\b/);
        assert.match(credentialsQuery, /\benabled\b/);
        assert.match(credentialsQuery, /\bcredential_version\b/);
        assert.equal(manifest.encryption.cipher, "aes-256-cbc");
        assert.deepEqual(manifest.excludedTableData, [
            "public.app_session",
            "public.login_ip_attempt",
            "public.login_csrf_context",
            "public.github_api_telemetry_event",
        ]);
        assert.equal(manifest.retentionDays, 30);
        assert.deepEqual(manifest.database, database);
        assert.equal(manifest.snapshot.cards.count, 1);
        assert.equal(manifest.snapshot.credentials.count, 1);
        assert.match(manifest.snapshot.credentials.sha256, /^[a-f0-9]{64}$/);
        assert.equal(queries[0], "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
        assert.equal(queries.at(-1), "COMMIT");
        assert.equal(JSON.parse(await readFile(manifestPath, "utf8")).archiveSha256,
            createHash("sha256").update("encrypted-archive").digest("hex"));
    } finally {
        await rm(directory, {recursive: true});
    }
});

test("study backup verification rejects checksum or policy drift before archive inspection", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "labeler-study-backup-verify-"));
    const archivePath = path.join(directory, "study.dump.enc");
    const manifestPath = path.join(directory, "study.manifest.json");
    await writeFile(archivePath, "encrypted-archive");
    await writeFile(manifestPath, JSON.stringify({
        manifestVersion: 1,
        archiveFile: path.basename(archivePath),
        archiveSha256: "0".repeat(64),
        createdAt: "2026-09-10T00:00:00.000Z",
        format: "custom",
        encrypted: true,
        encryption: {tool: "openssl", cipher: "aes-256-cbc", kdf: "pbkdf2", digest: "sha256", iterations: 600000},
        excludedTableData: [ "public.app_session", "public.login_ip_attempt", "public.login_csrf_context", "public.github_api_telemetry_event" ],
        retentionDays: 30,
        database,
        snapshot,
    }));
    let inspected = false;

    try {
        await assert.rejects(() => verifyStudyBackup({
            archivePath,
            manifestPath,
            encryptionKeyFile: path.join(directory, "backup.key"),
            inspectEncryptedArchive: async () => {
                inspected = true;
            },
        }), /checksum mismatch/);
        assert.equal(inspected, false);
    } finally {
        await rm(directory, {recursive: true});
    }
});
