import {createHash, randomUUID} from "node:crypto";
import {createReadStream} from "node:fs";
import {access, link, readFile, rm, stat, writeFile} from "node:fs/promises";
import path from "node:path";
import {resolveStudyBackupInputs, resolveStudyRestoreInputs} from "./study-backup-input.js";
import {transientTableData} from "./study-backup-process.js";

const encryptionPolicy = Object.freeze({
    tool: "openssl",
    cipher: "aes-256-cbc",
    kdf: "pbkdf2",
    digest: "sha256",
    iterations: 600000,
});

class StudyBackupError extends Error {
    constructor(message) {
        super(message);
        this.name = "StudyBackupError";
    }
}

const sha256File = filePath => new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("error", reject);
    stream.on("data", chunk => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
});

const assertDestinationAvailable = async filePath => {
    try {
        await access(filePath);
        throw new StudyBackupError(`Refusing to overwrite existing path: ${filePath}`);
    } catch (error) {
        if (error instanceof StudyBackupError) throw error;
        if (error.code !== "ENOENT") throw error;
    }
    if (!(await stat(path.dirname(filePath))).isDirectory()) {
        throw new StudyBackupError(`Destination parent is not a directory: ${path.dirname(filePath)}`);
    }
};

const digestRows = rows => ({
    count: rows.length,
    sha256: createHash("sha256").update(JSON.stringify(rows)).digest("hex"),
});

const collectBackupSnapshot = async client => {
    const cards = await client.query(
        "SELECT source_card_id, row_checksum FROM pr_cards ORDER BY source_card_id",
    );
    const classifications = await client.query(
        `SELECT study_id, pr_card_id, participant_id, category_id, observation
         FROM pr_classification ORDER BY study_id, pr_card_id, participant_id`,
    );
    const credentials = await client.query(
        `SELECT study_id, reviewer_id, normalized_username, password_hash, enabled, credential_version
         FROM participant_account ORDER BY study_id, reviewer_id`,
    );
    return {
        cards: digestRows(cards.rows),
        classifications: digestRows(classifications.rows),
        credentials: digestRows(credentials.rows),
    };
};

const assertSnapshot = snapshot => {
    for (const name of [ "cards", "classifications", "credentials" ]) {
        const section = snapshot?.[name];
        if (!Number.isSafeInteger(section?.count) || section.count < 0 || !/^[a-f0-9]{64}$/.test(section?.sha256)) {
            throw new StudyBackupError(`Backup manifest ${name} snapshot is invalid`);
        }
    }
};

const assertManifestContract = (manifest, archivePath, publishedArchivePath = archivePath) => {
    if (manifest?.manifestVersion !== 1 || manifest.archiveFile !== path.basename(publishedArchivePath)) {
        throw new StudyBackupError("Backup manifest identity is invalid");
    }
    if (manifest.format !== "custom" || manifest.encrypted !== true
        || JSON.stringify(manifest.encryption) !== JSON.stringify(encryptionPolicy)) {
        throw new StudyBackupError("Backup manifest encryption policy mismatch");
    }
    if (JSON.stringify(manifest.excludedTableData) !== JSON.stringify(transientTableData)) {
        throw new StudyBackupError("Backup manifest transient-data policy mismatch");
    }
    if (!Number.isSafeInteger(manifest.retentionDays) || manifest.retentionDays < 1) {
        throw new StudyBackupError("Backup manifest retention policy is invalid");
    }
    if (!manifest.database || [ "host", "port", "database", "user" ].some(name => !manifest.database[name])) {
        throw new StudyBackupError("Backup manifest database identity is incomplete");
    }
    if (!/^[a-f0-9]{64}$/.test(manifest.archiveSha256)) {
        throw new StudyBackupError("Backup manifest archive checksum is invalid");
    }
    if (typeof manifest.createdAt !== "string" || Number.isNaN(Date.parse(manifest.createdAt))) {
        throw new StudyBackupError("Backup manifest timestamp is invalid");
    }
    assertSnapshot(manifest.snapshot);
};

const verifyStudyBackup = async options => {
    let manifest;
    try {
        manifest = JSON.parse(await readFile(options.manifestPath, "utf8"));
    } catch (_error) {
        throw new StudyBackupError("Backup manifest is not readable JSON");
    }
    assertManifestContract(manifest, options.archivePath, options.publishedArchivePath);
    if (options.expectedDatabase
        && JSON.stringify(manifest.database) !== JSON.stringify(options.expectedDatabase)) {
        throw new StudyBackupError("Backup manifest database identity does not match production");
    }
    if (manifest.archiveSha256 !== await sha256File(options.archivePath)) {
        throw new StudyBackupError("Backup archive checksum mismatch");
    }
    await options.inspectEncryptedArchive({
        archivePath: options.archivePath,
        encryptionKeyFile: options.encryptionKeyFile,
    });
    return manifest;
};

const createStudyBackup = async options => {
    const {inputs, pool, createEncryptedArchive, inspectEncryptedArchive, now = () => new Date()} = options;
    await Promise.all([assertDestinationAvailable(inputs.archivePath), assertDestinationAvailable(inputs.manifestPath)]);
    const suffix = `.partial-${process.pid}-${randomUUID()}`;
    const temporaryArchive = `${inputs.archivePath}${suffix}`;
    const temporaryManifest = `${inputs.manifestPath}${suffix}`;
    const client = await pool.connect();
    let archivePublished = false;
    try {
        await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
        const {rows: [ exported ]} = await client.query("SELECT pg_export_snapshot() AS snapshot_id");
        const snapshot = await collectBackupSnapshot(client);
        await createEncryptedArchive({...inputs, outputPath: temporaryArchive, snapshotId: exported.snapshot_id});
        const manifest = {
            manifestVersion: 1,
            archiveFile: path.basename(inputs.archivePath),
            archiveSha256: await sha256File(temporaryArchive),
            createdAt: now().toISOString(),
            format: "custom",
            encrypted: true,
            encryption: encryptionPolicy,
            excludedTableData: transientTableData,
            retentionDays: inputs.retentionDays,
            database: inputs.database,
            snapshot,
        };
        await writeFile(temporaryManifest, `${JSON.stringify(manifest, null, 2)}\n`, {flag: "wx"});
        await verifyStudyBackup({
            archivePath: temporaryArchive,
            publishedArchivePath: inputs.archivePath,
            manifestPath: temporaryManifest,
            encryptionKeyFile: inputs.encryptionKeyFile,
            inspectEncryptedArchive,
        });
        await link(temporaryArchive, inputs.archivePath);
        archivePublished = true;
        await link(temporaryManifest, inputs.manifestPath);
        await client.query("COMMIT");
        return manifest;
    } catch (error) {
        await client.query("ROLLBACK");
        if (archivePublished) await rm(inputs.archivePath, {force: true});
        if (error instanceof StudyBackupError) throw error;
        throw new StudyBackupError(`Study backup failed: ${error.message}`);
    } finally {
        client.release();
        await Promise.all([rm(temporaryArchive, {force: true}), rm(temporaryManifest, {force: true})]);
    }
};

const assertIsolatedRestoreTarget = (production, target) => {
    if (production.database === target.database) {
        throw new StudyBackupError("Restore target must differ from production database identity");
    }
};

const compareBackupSnapshot = (expected, actual) => {
    assertSnapshot(expected);
    assertSnapshot(actual);
    for (const name of [ "cards", "classifications", "credentials" ]) {
        if (JSON.stringify(expected[name]) !== JSON.stringify(actual[name])) {
            throw new StudyBackupError(`${name} snapshot mismatch after isolated restore`);
        }
    }
};

const restoreAndVerifyStudyBackup = async options => {
    assertIsolatedRestoreTarget(options.productionDatabase, options.targetDatabase);
    const manifest = await verifyStudyBackup({
        archivePath: options.archivePath,
        manifestPath: options.manifestPath,
        encryptionKeyFile: options.encryptionKeyFile,
        expectedDatabase: options.productionDatabase,
        inspectEncryptedArchive: options.inspectEncryptedArchive,
    });
    const {rows: [ targetState ]} = await options.targetPool.query(
        `SELECT COUNT(*)::integer AS table_count FROM pg_class relation
         JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
         WHERE namespace.nspname = 'public' AND relation.relkind IN ('r', 'p')`,
    );
    if (targetState.table_count !== 0) {
        throw new StudyBackupError("Isolated restore target must be an empty database");
    }
    await options.restoreEncryptedArchive({
        archivePath: options.archivePath,
        encryptionKeyFile: options.encryptionKeyFile,
        targetDatabase: options.targetDatabase,
        environment: options.environment,
    });
    compareBackupSnapshot(manifest.snapshot, await collectBackupSnapshot(options.targetPool));
    return manifest;
};

export {
    StudyBackupError,
    assertIsolatedRestoreTarget,
    collectBackupSnapshot,
    compareBackupSnapshot,
    createStudyBackup,
    encryptionPolicy,
    resolveStudyBackupInputs,
    resolveStudyRestoreInputs,
    restoreAndVerifyStudyBackup,
    verifyStudyBackup,
};
