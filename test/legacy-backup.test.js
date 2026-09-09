import assert from "node:assert/strict";
import {mkdtemp, readFile, rm, writeFile} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
    createLegacyBackup,
    resolveBackupInputs,
    verifyLegacyBackup,
} from "../util/legacy-backup.js";
import {readLegacyInventory} from "../util/legacy-inventory.js";

const root = path.resolve(new URL("..", import.meta.url).pathname);

const backupManifest = async (archivePath, inventory, overrides = {}) => {
    const {createHash} = await import("node:crypto");
    const archiveSha256 = createHash("sha256").update(await readFile(archivePath)).digest("hex");
    return {
        manifestVersion: 1,
        archiveFile: path.basename(archivePath),
        archiveSha256,
        inventorySha256: inventory.inventorySha256,
        createdAt: "2026-08-20T00:00:00.000Z",
        format: "custom",
        dataOnly: true,
        database: {host: "db", port: "5432", database: "labeling", user: "labeler"},
        tables: inventory.inventory.backup.tables,
        ...overrides,
    };
};

test("backup inputs require explicit external paths and file-backed database credentials", async () => {
    assert.throws(() => resolveBackupInputs({}, root), /LEGACY_BACKUP_ARCHIVE/);
    assert.throws(() => resolveBackupInputs({
        LEGACY_BACKUP_ARCHIVE: path.join(root, "backup.dump"),
        LEGACY_BACKUP_MANIFEST: "/tmp/backup.manifest.json",
        PGHOST: "db",
        PGPORT: "5432",
        PGDATABASE: "labeling",
        PGUSER: "labeler",
    }, root), /outside the repository/);
    assert.throws(() => resolveBackupInputs({
        LEGACY_BACKUP_ARCHIVE: "/tmp/backup.dump",
        LEGACY_BACKUP_MANIFEST: "/tmp/backup.manifest.json",
        PGHOST: "db",
        PGPORT: "5432",
        PGDATABASE: "labeling",
        PGUSER: "labeler",
        PGPASSWORD: "secret",
    }, root), /PGPASSFILE is required/);

    const directory = await mkdtemp(path.join(os.tmpdir(), "labeler-pgpassfile-"));
    const passfile = path.join(directory, "database-passfile");
    await writeFile(passfile, "db:5432:labeling:labeler:secret\n", {mode: 0o400});

    try {
        const inputs = resolveBackupInputs({
            LEGACY_BACKUP_ARCHIVE: "/tmp/backup.dump",
            LEGACY_BACKUP_MANIFEST: "/tmp/backup.manifest.json",
            PGHOST: "db",
            PGPORT: "5432",
            PGDATABASE: "labeling",
            PGUSER: "labeler",
            PGPASSFILE: passfile,
            PGPASSWORD: "secret",
        }, root);
        assert.equal(inputs.environment.PGPASSFILE, passfile);
        assert.equal(Object.hasOwn(inputs.environment, "PGPASSWORD"), false);
    } finally {
        await rm(directory, {recursive: true});
    }
});

test("backup verification binds the archive to the intended database identity", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "labeler-backup-test-"));
    const archivePath = path.join(directory, "legacy.dump");
    const manifestPath = path.join(directory, "legacy.manifest.json");
    const inventory = await readLegacyInventory();
    await writeFile(archivePath, "archive-content");
    await writeFile(manifestPath, JSON.stringify(await backupManifest(archivePath, inventory)));

    try {
        await assert.rejects(() => verifyLegacyBackup({
            archivePath,
            manifestPath,
            inventory,
            expectedDatabase: {host: "other-db", port: "5432", database: "labeling", user: "labeler"},
            runCommand: async () => {},
        }), /database identity does not match/);
    } finally {
        await rm(directory, {recursive: true});
    }
});

test("backup verification rejects malformed manifests and invalid archive checksums", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "labeler-backup-test-"));
    const archivePath = path.join(directory, "legacy.dump");
    const manifestPath = path.join(directory, "legacy.manifest.json");
    const inventory = await readLegacyInventory();
    await writeFile(archivePath, "archive-content");

    try {
        await writeFile(manifestPath, "not-json");
        await assert.rejects(
            () => verifyLegacyBackup({archivePath, manifestPath, inventory, runCommand: async () => {}}),
            /manifest is not readable JSON/,
        );

        await writeFile(manifestPath, JSON.stringify(await backupManifest(archivePath, inventory, {
            archiveSha256: "0".repeat(64),
        })));
        await assert.rejects(
            () => verifyLegacyBackup({archivePath, manifestPath, inventory, runCommand: async () => {}}),
            /archive checksum mismatch/,
        );
    } finally {
        await rm(directory, {recursive: true});
    }
});

test("backup verification rejects archives that pg_restore cannot read", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "labeler-backup-test-"));
    const archivePath = path.join(directory, "legacy.dump");
    const manifestPath = path.join(directory, "legacy.manifest.json");
    const inventory = await readLegacyInventory();
    await writeFile(archivePath, "archive-content");
    await writeFile(manifestPath, JSON.stringify(await backupManifest(archivePath, inventory)));

    try {
        await assert.rejects(
            () => verifyLegacyBackup({
                archivePath,
                manifestPath,
                inventory,
                runCommand: async () => {
                    throw new Error("invalid archive");
                },
            }),
            /archive readability check failed/,
        );
    } finally {
        await rm(directory, {recursive: true});
    }
});

test("backup creation refuses existing destinations before invoking pg_dump", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "labeler-backup-test-"));
    const archivePath = path.join(directory, "legacy.dump");
    const manifestPath = path.join(directory, "legacy.manifest.json");
    const inventory = await readLegacyInventory();
    await writeFile(archivePath, "existing");
    let invoked = false;

    try {
        await assert.rejects(() => createLegacyBackup({
            inputs: {
                archivePath,
                manifestPath,
                credentials: {host: "db", port: "5432", database: "labeling", user: "labeler"},
                environment: {PGPASSWORD: "secret"},
            },
            inventory,
            runCommand: async () => {
                invoked = true;
            },
        }), /Refusing to overwrite/);
        assert.equal(invoked, false);
    } finally {
        await rm(directory, {recursive: true});
    }
});

test("backup creation publishes and verifies a custom archive and manifest through injected commands", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "labeler-backup-test-"));
    const archivePath = path.join(directory, "legacy.dump");
    const manifestPath = path.join(directory, "legacy.manifest.json");
    const inventory = await readLegacyInventory();
    const commands = [];
    const execute = async (command, args) => {
        commands.push([ command, args ]);
        if (command === "pg_dump") {
            const outputArgument = args.find(argument => argument.startsWith("--file="));
            await writeFile(outputArgument.slice("--file=".length), "custom-archive");
        }
    };

    try {
        await createLegacyBackup({
            inputs: {
                archivePath,
                manifestPath,
                credentials: {host: "db", port: "5432", database: "labeling", user: "labeler"},
                environment: {PGPASSWORD: "secret"},
            },
            inventory,
            runCommand: execute,
            now: () => new Date("2026-08-20T00:00:00.000Z"),
        });
        const manifest = await verifyLegacyBackup({archivePath, manifestPath, inventory, runCommand: execute});

        assert.equal(manifest.format, "custom");
        assert.deepEqual(commands.map(([ command ]) => command), [ "pg_dump", "pg_restore", "pg_restore" ]);
        assert.equal(await readFile(archivePath, "utf8"), "custom-archive");
    } finally {
        await rm(directory, {recursive: true});
    }
});
