import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {access, chmod, copyFile, mkdir, mkdtemp, rm, stat, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import test from "node:test";
import {fileURLToPath} from "node:url";
import {readLegacyInventory} from "../../util/legacy-inventory.js";
import {probeLegacyBackupInputs, setSyntheticInputOwner} from "./container-input-staging.js";

const repositoryRoot = path.resolve(new URL("../../", import.meta.url).pathname);
const helperImage = "python:3.12-alpine";
const image = process.env.LABELER_READINESS_TEST_IMAGE || "labeler-copilot369-local:b5cddf3";
const stagingCliPath = fileURLToPath(new URL("./container-input-staging.js", import.meta.url));
const fileMetadata = async filePath => {
    const file = await stat(filePath);
    return {uid: file.uid, gid: file.gid, mode: (file.mode & 0o777).toString(8).padStart(4, "0")};
};

const recordEvidence = async evidence => {
    const evidenceDirectory = process.env.LABELER_CONTAINER_INPUT_EVIDENCE_DIR;
    if (!evidenceDirectory) return;
    await mkdir(evidenceDirectory, {recursive: true, mode: 0o700});
    const serialized = `${JSON.stringify(evidence)}\n`;
    assert.equal(serialized.includes("SYNTHETIC_PASS_CANARY"), false);
    assert.equal(serialized.includes("SYNTHETIC_LEGACY_BACKUP_CANARY"), false);
    await writeFile(path.join(evidenceDirectory, evidence.fileName), serialized, {flag: "wx", mode: 0o600});
};

const stageFiles = (sourceDirectory, destinationDirectory, inputNames) => {
    const result = spawnSync(process.execPath,
        [stagingCliPath, "files", sourceDirectory, destinationDirectory, helperImage, ...inputNames],
        {encoding: "utf8", maxBuffer: 1024 * 1024});
    assert.equal(result.status, 0, "container input staging CLI should succeed");
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "");
};

test("existing-mode Node readers reject foreign-owned 0400 inputs until staging normalizes and refreshes copies", async () => {
    const fixtureDirectory = await mkdtemp(path.join(tmpdir(), "labeler-existing-container-inputs-"));
    const originalDirectory = path.join(fixtureDirectory, "original");
    const originalBackupDirectory = path.join(originalDirectory, "backup");
    const foreignDirectory = path.join(fixtureDirectory, "foreign");
    const cliSourceDirectory = path.join(fixtureDirectory, "cli-source");
    const cliSourceBackupDirectory = path.join(cliSourceDirectory, "backup");
    const originalPassfile = path.join(originalDirectory, "legacy-retirement.pgpass");
    const originalArchive = path.join(originalBackupDirectory, "legacy.dump");
    const validArchive = path.join(originalBackupDirectory, "legacy.valid.dump");
    const originalManifest = path.join(originalBackupDirectory, "legacy.manifest.json");
    let stagedBackupDirectoryOwned = false;

    try {
        await Promise.all([
            mkdir(originalBackupDirectory, {recursive: true, mode: 0o700}),
            mkdir(cliSourceBackupDirectory, {recursive: true, mode: 0o711}),
            mkdir(path.join(foreignDirectory, "passfile"), {recursive: true, mode: 0o711}),
            mkdir(path.join(foreignDirectory, "backup-directory-only"), {recursive: true, mode: 0o711}),
            mkdir(path.join(foreignDirectory, "manifest-only"), {recursive: true, mode: 0o711}),
            mkdir(path.join(foreignDirectory, "archive-only"), {recursive: true, mode: 0o711}),
        ]);
        const inventory = await readLegacyInventory();
        const archiveContent = Buffer.from("SYNTHETIC_LEGACY_BACKUP_CANARY");
        const databaseIdentity = {host: "labeling-database", port: "5432", database: "labeling_harness", user: "labeling_harness"};
        await writeFile(originalPassfile,
            "labeling-database:5432:labeling_harness:labeling_harness:SYNTHETIC_PASS_CANARY\n", {mode: 0o400});
        await writeFile(originalArchive, archiveContent, {mode: 0o400});
        await copyFile(originalArchive, validArchive);
        await writeFile(originalManifest, JSON.stringify({
            manifestVersion: 1,
            archiveFile: "legacy.dump",
            archiveSha256: createHash("sha256").update(archiveContent).digest("hex"),
            inventorySha256: inventory.inventorySha256,
            createdAt: "2026-10-20T00:00:00.000Z",
            format: "custom",
            dataOnly: true,
            database: databaseIdentity,
            tables: inventory.inventory.backup.tables,
        }), {mode: 0o400});
        for (const filePath of [originalPassfile, originalArchive, validArchive, originalManifest]) {
            await chmod(filePath, 0o400);
        }
        await copyFile(originalPassfile, path.join(cliSourceDirectory, "legacy-retirement.pgpass"));
        await copyFile(originalArchive, path.join(cliSourceBackupDirectory, "legacy.dump"));
        await copyFile(originalManifest, path.join(cliSourceBackupDirectory, "legacy.manifest.json"));
        for (const filePath of [path.join(cliSourceDirectory, "legacy-retirement.pgpass"),
            path.join(cliSourceBackupDirectory, "legacy.dump"), path.join(cliSourceBackupDirectory, "legacy.manifest.json")]) {
            await chmod(filePath, 0o400);
        }

        const foreignCopyPaths = [
            path.join(foreignDirectory, "passfile/legacy-retirement.pgpass"),
            path.join(foreignDirectory, "backup-directory-only/legacy.dump"),
            path.join(foreignDirectory, "backup-directory-only/legacy.manifest.json"),
            path.join(foreignDirectory, "manifest-only/legacy.dump"),
            path.join(foreignDirectory, "manifest-only/legacy.manifest.json"),
            path.join(foreignDirectory, "archive-only/legacy.dump"),
            path.join(foreignDirectory, "archive-only/legacy.manifest.json"),
        ];
        for (const foreignPath of foreignCopyPaths) {
            const sourceFile = foreignPath.endsWith("legacy-retirement.pgpass") ? originalPassfile
                : path.join(originalBackupDirectory, path.basename(foreignPath));
            await copyFile(sourceFile, foreignPath);
            await chmod(foreignPath, 0o400);
        }

        const foreignMetadata = [
            ...await setSyntheticInputOwner({fixtureDirectory: foreignDirectory,
                relativePaths: ["passfile/legacy-retirement.pgpass"],
                uid: 2000, gid: 2000, helperImage}),
            ...await setSyntheticInputOwner({fixtureDirectory: foreignDirectory,
                relativePaths: ["backup-directory-only/legacy.dump", "backup-directory-only/legacy.manifest.json"],
                uid: 2000, gid: 2000, helperImage}),
            ...await setSyntheticInputOwner({fixtureDirectory: foreignDirectory,
                relativePaths: ["manifest-only/legacy.dump", "archive-only/legacy.manifest.json"],
                uid: 1000, gid: 1000, helperImage}),
            ...await setSyntheticInputOwner({fixtureDirectory: foreignDirectory,
                relativePaths: ["manifest-only/legacy.manifest.json", "archive-only/legacy.dump"],
                uid: 2000, gid: 2000, helperImage}),
        ].map(metadata => ({...metadata, mode: metadata.mode.toString(8).padStart(4, "0")}));
        const cliSourceForeignMetadata = (await setSyntheticInputOwner({fixtureDirectory: cliSourceDirectory,
            relativePaths: ["legacy-retirement.pgpass", "backup/legacy.dump", "backup/legacy.manifest.json"],
            uid: 2000, gid: 2000, helperImage})).map(metadata => ({...metadata, mode: metadata.mode.toString(8).padStart(4, "0")}));

        const redPassfile = await probeLegacyBackupInputs({image, repositoryRoot,
            passfilePath: path.join(foreignDirectory, "passfile/legacy-retirement.pgpass"),
            backupDirectory: path.join(foreignDirectory, "manifest-only")});
        assert.deepEqual(
            {nodeUid: redPassfile.nodeUid, passfileReadable: redPassfile.passfileReadable, unexpectedError: redPassfile.unexpectedError},
            {nodeUid: 1000, passfileReadable: false, unexpectedError: false},
        );
        await recordEvidence({fileName: "existing-red-passfile.json", result: redPassfile, foreignMetadata});

        stageFiles(originalDirectory, fixtureDirectory, ["legacy-retirement.pgpass"]);
        const stagedPassfile = path.join(fixtureDirectory, "container-inputs/legacy-retirement.pgpass");
        const redBackupDirectory = await probeLegacyBackupInputs({image, repositoryRoot,
            passfilePath: stagedPassfile, backupDirectory: path.join(foreignDirectory, "backup-directory-only")});
        assert.equal(redBackupDirectory.passfileReadable, true);
        assert.equal(redBackupDirectory.manifestReadable, false);
        assert.equal(redBackupDirectory.unexpectedError, false);
        await recordEvidence({fileName: "existing-red-backup-directory.json", result: redBackupDirectory});

        const redManifest = await probeLegacyBackupInputs({image, repositoryRoot,
            passfilePath: stagedPassfile, backupDirectory: path.join(foreignDirectory, "manifest-only")});
        assert.equal(redManifest.passfileReadable, true);
        assert.equal(redManifest.manifestReadable, false);
        assert.equal(redManifest.unexpectedError, false);
        await recordEvidence({fileName: "existing-red-manifest.json", result: redManifest});

        const redArchive = await probeLegacyBackupInputs({image, repositoryRoot,
            passfilePath: stagedPassfile, backupDirectory: path.join(foreignDirectory, "archive-only")});
        assert.equal(redArchive.passfileReadable, true);
        assert.equal(redArchive.manifestReadable, true);
        assert.equal(redArchive.archiveReadable, false);
        assert.equal(redArchive.unexpectedError, false);
        await recordEvidence({fileName: "existing-red-archive.json", result: redArchive});

        stageFiles(cliSourceDirectory, fixtureDirectory,
            ["legacy-retirement.pgpass", "backup/legacy.dump", "backup/legacy.manifest.json"]);
        const stagedBackupDirectory = path.join(fixtureDirectory, "container-inputs/backup");
        const stagedDirectoryForeignMetadata = (await setSyntheticInputOwner({
            fixtureDirectory: path.join(fixtureDirectory, "container-inputs"), relativePaths: ["backup"],
            uid: 2000, gid: 2000, helperImage,
        })).map(metadata => ({...metadata, mode: metadata.mode.toString(8).padStart(4, "0")}));
        stagedBackupDirectoryOwned = true;
        const green = await probeLegacyBackupInputs({image, repositoryRoot,
            passfilePath: stagedPassfile, backupDirectory: stagedBackupDirectory});
        assert.deepEqual(
            {nodeUid: green.nodeUid, passfileReadable: green.passfileReadable, backupPathResolved: green.backupPathResolved,
                manifestReadable: green.manifestReadable, archiveReadable: green.archiveReadable,
                verificationPassed: green.verificationPassed, pgRestoreCalled: green.pgRestoreCalled, unexpectedError: green.unexpectedError},
            {nodeUid: 1000, passfileReadable: true, backupPathResolved: true, manifestReadable: true,
                archiveReadable: true, verificationPassed: true, pgRestoreCalled: true, unexpectedError: false},
        );

        for (const filePath of [originalPassfile, originalArchive, validArchive, originalManifest]) await access(filePath);
        const originalMetadata = await Promise.all([originalPassfile, originalBackupDirectory,
            originalArchive, originalManifest].map(fileMetadata));
        assert.deepEqual(originalMetadata.map(metadata => metadata.mode), ["0400", "0700", "0400", "0400"]);
        assert.ok(originalMetadata.every(metadata => metadata.uid === process.getuid()));
        const stagedMetadata = await Promise.all([stagedPassfile, stagedBackupDirectory,
            path.join(stagedBackupDirectory, "legacy.dump"), path.join(stagedBackupDirectory, "legacy.manifest.json")]
            .map(fileMetadata));
        assert.deepEqual(stagedMetadata, [
            {uid: 1000, gid: 1000, mode: "0400"},
            {uid: 2000, gid: 2000, mode: "0711"},
            {uid: 1000, gid: 1000, mode: "0400"},
            {uid: 1000, gid: 1000, mode: "0400"},
        ]);
        await recordEvidence({fileName: "existing-green-stage.json", result: green,
            originalHostReadable: true, originalMetadata, cliSourceForeignMetadata, stagedDirectoryForeignMetadata, stagedMetadata});
        await setSyntheticInputOwner({fixtureDirectory: path.join(fixtureDirectory, "container-inputs"),
            relativePaths: ["backup"], uid: process.getuid(), gid: process.getgid(), helperImage});
        stagedBackupDirectoryOwned = false;

        await chmod(originalArchive, 0o600);
        await writeFile(originalArchive, "SYNTHETIC_CORRUPTED_BACKUP_CANARY");
        await chmod(originalArchive, 0o400);
        stageFiles(originalDirectory, fixtureDirectory, ["backup/legacy.dump", "backup/legacy.manifest.json"]);
        const corruptedRefresh = await probeLegacyBackupInputs({image, repositoryRoot,
            passfilePath: stagedPassfile, backupDirectory: stagedBackupDirectory});
        assert.equal(corruptedRefresh.checksumMismatch, true);
        assert.equal(corruptedRefresh.archiveReadable, true);
        assert.equal(corruptedRefresh.verificationPassed, false);
        assert.equal(corruptedRefresh.unexpectedError, false);
        await recordEvidence({fileName: "existing-corrupt-refresh.json", result: corruptedRefresh});

        await chmod(originalArchive, 0o600);
        await copyFile(validArchive, originalArchive);
        await chmod(originalArchive, 0o400);
        stageFiles(originalDirectory, fixtureDirectory, ["backup/legacy.dump", "backup/legacy.manifest.json"]);
        const restoredRefresh = await probeLegacyBackupInputs({image, repositoryRoot,
            passfilePath: stagedPassfile, backupDirectory: stagedBackupDirectory});
        assert.equal(restoredRefresh.verificationPassed, true);
        assert.equal(restoredRefresh.pgRestoreCalled, true);
        assert.equal(restoredRefresh.unexpectedError, false);
        await recordEvidence({fileName: "existing-restored-refresh.json", result: restoredRefresh});

        const evidenceDirectory = process.env.LABELER_CONTAINER_INPUT_EVIDENCE_DIR;
        if (evidenceDirectory) {
            await mkdir(evidenceDirectory, {recursive: true, mode: 0o700});
            await writeFile(path.join(evidenceDirectory, "summary.md"),
                `# Existing-mode input staging runtime proof\n\nFocused command: \`LABELER_READINESS_TEST_IMAGE=${image} LABELER_CONTAINER_INPUT_EVIDENCE_DIR=${evidenceDirectory} node --test --test-name-pattern="existing-mode Node readers reject foreign-owned 0400 inputs until staging normalizes and refreshes copies" test/study-readiness-entrypoint.integration.js\`\n\nThe retained JSON contains only numeric ownership/mode metadata and reader outcome booleans. Host originals stayed readable; staged files stayed mode 0400; the backup staging directory was exercised as foreign-owned mode 0711 (search-only) and restored before host corruption/refresh checks. Corrupt and restored host archive states were each refreshed before verification.\n`,
                {flag: "wx", mode: 0o600});
        }
    } finally {
        if (stagedBackupDirectoryOwned) {
            await setSyntheticInputOwner({fixtureDirectory: path.join(fixtureDirectory, "container-inputs"),
                relativePaths: ["backup"], uid: process.getuid(), gid: process.getgid(), helperImage});
        }
        await rm(fixtureDirectory, {recursive: true, force: true});
    }
});
