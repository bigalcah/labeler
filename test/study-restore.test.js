import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {mkdtemp, rm, writeFile} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
    assertIsolatedRestoreTarget,
    compareBackupSnapshot,
    resolveStudyRestoreInputs,
    restoreAndVerifyStudyBackup,
} from "../util/study-backup.js";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const database = {host: "db", port: "5432", database: "labeling", user: "labeler"};
const snapshot = {
    cards: {count: 300, sha256: "1".repeat(64)},
    classifications: {count: 3, sha256: "2".repeat(64)},
    credentials: {count: 3, sha256: "3".repeat(64)},
};

const createProtectedFile = async (directory, name, content) => {
    const filePath = path.join(directory, name);
    await writeFile(filePath, content, {mode: 0o400});
    return filePath;
};

test("study restore inputs require explicit confirmation and a file-backed target credential", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "labeler-study-restore-input-"));
    const keyFile = await createProtectedFile(directory, "backup.key", "backup-encryption-secret\n");
    const targetPassfile = await createProtectedFile(directory, "restore.pgpass", "db:5432:labeling_restore:restore:secret\n");
    const environment = {
        STUDY_RESTORE_CONFIRM: "isolated-restore",
        STUDY_BACKUP_ARCHIVE: path.join(directory, "study.dump.enc"),
        STUDY_BACKUP_MANIFEST: path.join(directory, "study.manifest.json"),
        STUDY_BACKUP_ENCRYPTION_KEY_FILE: keyFile,
        PGHOST: "db",
        PGPORT: "5432",
        PGDATABASE: "labeling",
        PGUSER: "labeler",
        STUDY_RESTORE_PGHOST: "restore-db",
        STUDY_RESTORE_PGPORT: "5432",
        STUDY_RESTORE_PGDATABASE: "labeling_restore",
        STUDY_RESTORE_PGUSER: "restore",
        STUDY_RESTORE_PGPASSFILE: targetPassfile,
        STUDY_RESTORE_PGPASSWORD: "must-not-propagate",
    };

    try {
        assert.throws(() => resolveStudyRestoreInputs({...environment, STUDY_RESTORE_CONFIRM: undefined}, root), /isolated-restore/);
        const inputs = resolveStudyRestoreInputs(environment, root);
        assert.equal(inputs.environment.PGPASSFILE, targetPassfile);
        assert.equal(Object.hasOwn(inputs.environment, "STUDY_RESTORE_PGPASSWORD"), false);
        assert.deepEqual(inputs.targetDatabase, {host: "restore-db", port: "5432", database: "labeling_restore", user: "restore"});
    } finally {
        await rm(directory, {recursive: true});
    }
});

test("isolated restore rejects production identity and compares credential versions", () => {
    assert.throws(() => assertIsolatedRestoreTarget(database, database), /must differ from production/);
    assert.doesNotThrow(() => assertIsolatedRestoreTarget(database, {...database, database: "labeling_restore"}));
    assert.doesNotThrow(() => compareBackupSnapshot(snapshot, structuredClone(snapshot)));
    assert.throws(() => compareBackupSnapshot(snapshot, {
        ...snapshot,
        credentials: {...snapshot.credentials, sha256: "4".repeat(64)},
    }), /credentials snapshot mismatch/);
});

test("isolated restore verifies an empty target and compares restored data", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "labeler-study-restore-"));
    const archivePath = path.join(directory, "study.dump.enc");
    const manifestPath = path.join(directory, "study.manifest.json");
    const cards = [ {source_card_id: "card-1", row_checksum: "checksum-1"} ];
    const classifications = [ {study_id: "study", pr_card_id: "card", participant_id: 1, category_id: "category", observation: null} ];
    const credentials = [ {study_id: "study", reviewer_id: 1, normalized_username: "one", password_hash: "$argon2id$hash", enabled: true, credential_version: 4} ];
    const restoredSnapshot = Object.fromEntries(Object.entries({cards, classifications, credentials}).map(([name, rows]) => [name, {
        count: rows.length,
        sha256: createHash("sha256").update(JSON.stringify(rows)).digest("hex"),
    }]));
    await writeFile(archivePath, "encrypted-archive");
    await writeFile(manifestPath, JSON.stringify({
        manifestVersion: 1,
        archiveFile: path.basename(archivePath),
        archiveSha256: createHash("sha256").update("encrypted-archive").digest("hex"),
        createdAt: "2026-09-10T00:00:00.000Z",
        format: "custom",
        encrypted: true,
        encryption: {tool: "openssl", cipher: "aes-256-cbc", kdf: "pbkdf2", digest: "sha256", iterations: 600000},
        excludedTableData: [ "public.app_session", "public.login_ip_attempt", "public.login_csrf_context", "public.github_api_telemetry_event" ],
        retentionDays: 30,
        database,
        snapshot: restoredSnapshot,
    }));
    let restored = false;
    const targetPool = {query: async sql => {
        if (sql.includes("FROM pg_class")) return {rows: [ {table_count: 0} ]};
        if (sql.includes("FROM pr_cards")) return {rows: cards};
        if (sql.includes("FROM pr_classification")) return {rows: classifications};
        if (sql.includes("FROM participant_account")) return {rows: credentials};
        throw new Error(`Unexpected query: ${sql}`);
    }};

    try {
        await restoreAndVerifyStudyBackup({
            archivePath,
            manifestPath,
            encryptionKeyFile: path.join(directory, "backup.key"),
            productionDatabase: database,
            targetDatabase: {...database, database: "labeling_restore"},
            environment: {},
            targetPool,
            inspectEncryptedArchive: async () => {},
            restoreEncryptedArchive: async () => {
                restored = true;
            },
        });
        assert.equal(restored, true);
    } finally {
        await rm(directory, {recursive: true});
    }
});
