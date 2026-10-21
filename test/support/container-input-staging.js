import {chmod, mkdir} from "node:fs/promises";
import {spawnSync} from "node:child_process";
import path from "node:path";
import {fileURLToPath} from "node:url";

const stageNodeContainerInputs = async ({sourceDirectory, destinationDirectory, inputMappings, helperImage}) => {
    const sourceRoot = path.resolve(sourceDirectory);
    const stageRoot = path.join(path.resolve(destinationDirectory), "container-inputs");
    await mkdir(stageRoot, {recursive: true, mode: 0o700});

    const mounts = [];
    for (const [index, mapping] of inputMappings.entries()) {
        for (const relativePath of [mapping.source, mapping.destination]) {
            if (path.isAbsolute(relativePath) || relativePath.split(path.sep).includes("..")) {
                throw new Error("Container input staging paths must remain relative to their roots");
            }
        }
        const destinationPath = path.join(stageRoot, mapping.destination);
        const parentDirectory = path.dirname(destinationPath);
        if (parentDirectory !== stageRoot) {
            await mkdir(parentDirectory, {recursive: true, mode: 0o711});
            await chmod(parentDirectory, 0o711);
        }
        mounts.push("--mount", `type=bind,src=${path.join(sourceRoot, mapping.source)},dst=/source/${index},readonly`);
    }

    const script = `import json,os,shutil,sys
from pathlib import Path
stage=Path("/stage")
mappings=json.loads(sys.argv[1])
for index,mapping in enumerate(mappings):
    source=Path("/source")/str(index)
    destination=stage/mapping["destination"]
    if destination.exists():
        destination.unlink()
    shutil.copyfile(source,destination)
    os.chmod(destination,0o400)
    os.chown(destination,1000,1000)`;
    const result = spawnSync("docker", [
        "run", "--rm", "--network", "none", "--read-only", "--user", "0",
        "--cap-drop", "ALL", "--cap-add", "CHOWN", "--cap-add", "DAC_OVERRIDE",
        "--mount", `type=bind,src=${stageRoot},dst=/stage`,
        ...mounts,
        helperImage, "python3", "-B", "-c", script, JSON.stringify(inputMappings),
    ], {encoding: "utf8", maxBuffer: 1024 * 1024});
    if (result.error || result.status !== 0) throw new Error("Container input staging failed");
    return stageRoot;
};

const probeLegacyBackupInputs = ({image, repositoryRoot, passfilePath, backupDirectory}) => {
    const probe = `import {readSecretFile} from "./util/secret-file.js";
import {resolveBackupInputs, verifyLegacyBackup} from "./util/legacy-backup.js";
import {readLegacyInventory} from "./util/legacy-inventory.js";

const result = {nodeUid: process.getuid(), nodeGid: process.getgid(), passfileReadable: false,
    backupPathResolved: false, manifestReadable: false, archiveReadable: false,
    checksumMismatch: false, verificationPassed: false, pgRestoreCalled: false, unexpectedError: false};
try {
    readSecretFile(process.env.PGPASSFILE, "PGPASSFILE");
    result.passfileReadable = true;
    const inputs = resolveBackupInputs(process.env, process.cwd());
    result.backupPathResolved = true;
    const inventory = await readLegacyInventory();
    try {
        await verifyLegacyBackup({...inputs, inventory, expectedDatabase: inputs.credentials, runCommand: async (command, args) => {
            result.pgRestoreCalled = command === "pg_restore" && args[0] === "--list";
        }});
        result.manifestReadable = true;
        result.archiveReadable = true;
        result.verificationPassed = true;
    } catch (error) {
        if (error.message.startsWith("Backup manifest is not readable JSON:")) {
            result.manifestReadable = false;
        } else if (error.message === "Backup archive checksum mismatch") {
            result.manifestReadable = true;
            result.archiveReadable = true;
            result.checksumMismatch = true;
        } else if (error.code === "EACCES") {
            result.manifestReadable = true;
            result.archiveReadable = false;
        } else {
            result.unexpectedError = true;
        }
    }
} catch (error) {
    if (error.code === "SECRET_FILE_INVALID" && error.field === "PGPASSFILE") result.passfileReadable = false;
    else if (error.code === "EACCES") result.backupPathResolved = false;
    else result.unexpectedError = true;
}
process.stdout.write(JSON.stringify(result) + "\\n");`;
    const result = spawnSync("docker", [
        "run", "--rm", "--network", "none", "--read-only", "--user", "node",
        "--mount", `type=bind,src=${path.join(repositoryRoot, "util")},dst=/labeling/util,readonly`,
        "--mount", `type=bind,src=${path.join(repositoryRoot, "schema/migrations")},dst=/labeling/schema/migrations,readonly`,
        "--mount", `type=bind,src=${passfilePath},dst=/run/secrets/legacy-retirement.pgpass,readonly`,
        "--mount", `type=bind,src=${backupDirectory},dst=/legacy-backup,readonly`,
        "-e", "PGPASSFILE=/run/secrets/legacy-retirement.pgpass",
        "-e", "LEGACY_BACKUP_ARCHIVE=/legacy-backup/legacy.dump",
        "-e", "LEGACY_BACKUP_MANIFEST=/legacy-backup/legacy.manifest.json",
        "-e", "PGHOST=labeling-database", "-e", "PGPORT=5432",
        "-e", "PGDATABASE=labeling_harness", "-e", "PGUSER=labeling_harness",
        "--entrypoint", "node", image, "--input-type=module", "--eval", probe,
    ], {encoding: "utf8", maxBuffer: 1024 * 1024});
    if (result.error || result.status !== 0 || result.stderr !== "") {
        throw new Error("Node container input probe failed");
    }
    return JSON.parse(result.stdout);
};

const setSyntheticInputOwner = async ({fixtureDirectory, relativePaths, uid, gid, helperImage}) => {
    const script = `import json,os,stat,sys
from pathlib import Path
root=Path("/fixture")
relative_paths=json.loads(sys.argv[1])
for relative in relative_paths:
    os.chown(root/relative,int(sys.argv[2]),int(sys.argv[3]))
print(json.dumps([{"path":relative,"uid":(root/relative).stat().st_uid,"gid":(root/relative).stat().st_gid,"mode":stat.S_IMODE((root/relative).stat().st_mode)} for relative in relative_paths]))`;
    const result = spawnSync("docker", [
        "run", "--rm", "--network", "none", "--read-only", "--user", "0",
        "--cap-drop", "ALL", "--cap-add", "CHOWN", "--cap-add", "DAC_OVERRIDE",
        "--mount", `type=bind,src=${fixtureDirectory},dst=/fixture`,
        helperImage, "python3", "-B", "-c", script, JSON.stringify(relativePaths), String(uid), String(gid),
    ], {encoding: "utf8", maxBuffer: 1024 * 1024});
    if (result.error || result.status !== 0 || result.stderr !== "") throw new Error("Synthetic ownership setup failed");
    return JSON.parse(result.stdout);
};

export {probeLegacyBackupInputs, setSyntheticInputOwner, stageNodeContainerInputs};

const main = async () => {
    const [mode, sourceDirectory, destinationDirectory, helperImage, ...inputNames] = process.argv.slice(2);
    if (mode !== "files" || inputNames.length === 0) throw new Error("Invalid container input staging request");
    const inputMappings = inputNames.map(name => ({source: name, destination: name}));
    await stageNodeContainerInputs({sourceDirectory, destinationDirectory, inputMappings, helperImage});
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main().catch(() => {
        process.stderr.write("CONTAINER_INPUT_STAGING_FAILED\n");
        process.exitCode = 1;
    });
}
