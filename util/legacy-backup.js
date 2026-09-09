import {createHash, randomUUID} from "node:crypto";
import {createReadStream, realpathSync} from "node:fs";
import {access, link, readFile, rm, stat, writeFile} from "node:fs/promises";
import path from "node:path";
import {spawn} from "node:child_process";
import {validateLegacyInventory} from "./legacy-inventory.js";
import {readSecretFile} from "./secret-file.js";

class LegacyBackupError extends Error {
    constructor(message) {
        super(message);
        this.name = "LegacyBackupError";
    }
}

const isInside = (parent, candidate) => {
    const relative = path.relative(parent, candidate);
    return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..");
};

const required = (environment, name) => {
    const value = environment[name];
    if (typeof value !== "string" || value.trim() === "") {
        throw new LegacyBackupError(`${name} is required`);
    }
    return value;
};

const resolveBackupInputs = (environment, repositoryRoot) => {
    const requestedArchivePath = required(environment, "LEGACY_BACKUP_ARCHIVE");
    const requestedManifestPath = required(environment, "LEGACY_BACKUP_MANIFEST");
    const requestedPaths = [
        [ "LEGACY_BACKUP_ARCHIVE", requestedArchivePath ],
        [ "LEGACY_BACKUP_MANIFEST", requestedManifestPath ],
    ];
    for (const [ name, value ] of requestedPaths) {
        if (!path.isAbsolute(value)) throw new LegacyBackupError(`${name} must be an absolute path`);
    }
    const archivePath = path.join(realpathSync(path.dirname(requestedArchivePath)), path.basename(requestedArchivePath));
    const manifestPath = path.join(realpathSync(path.dirname(requestedManifestPath)), path.basename(requestedManifestPath));
    const resolvedRepositoryRoot = realpathSync(repositoryRoot);
    for (const [ name, value ] of [[ "LEGACY_BACKUP_ARCHIVE", archivePath ], [ "LEGACY_BACKUP_MANIFEST", manifestPath ]]) {
        if (isInside(resolvedRepositoryRoot, value)) throw new LegacyBackupError(`${name} must be outside the repository`);
    }
    if (archivePath === manifestPath) throw new LegacyBackupError("Backup archive and manifest paths must differ");

    const credentials = {
        host: required(environment, "PGHOST"),
        port: required(environment, "PGPORT"),
        database: required(environment, "PGDATABASE"),
        user: required(environment, "PGUSER"),
    };
    if (!environment.PGPASSFILE) throw new LegacyBackupError("PGPASSFILE is required");
    try {
        readSecretFile(environment.PGPASSFILE, "PGPASSFILE");
    } catch (_error) {
        throw new LegacyBackupError("PGPASSFILE is invalid");
    }
    const {PGPASSWORD: _password, ...credentialEnvironment} = environment;
    return {archivePath, manifestPath, credentials, environment: credentialEnvironment};
};

const runCommand = (command, args, options = {}) => new Promise((resolve, reject) => {
    const child = spawn(command, args, {stdio: [ "ignore", "ignore", "pipe" ], ...options});
    let stderr = "";
    child.stderr.on("data", chunk => {
        stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", code => {
        if (code === 0) resolve();
        else reject(new Error(`${command} exited with code ${code}: ${stderr.trim()}`));
    });
});

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
        throw new LegacyBackupError(`Refusing to overwrite existing path: ${filePath}`);
    } catch (error) {
        if (error instanceof LegacyBackupError) throw error;
        if (error.code !== "ENOENT") throw error;
    }
    const directory = path.dirname(filePath);
    const directoryStat = await stat(directory);
    if (!directoryStat.isDirectory()) throw new LegacyBackupError(`Destination parent is not a directory: ${directory}`);
};

const readManifest = async manifestPath => {
    try {
        return JSON.parse(await readFile(manifestPath, "utf8"));
    } catch (error) {
        throw new LegacyBackupError(`Backup manifest is not readable JSON: ${error.message}`);
    }
};

const assertManifestContract = (manifest, archivePath, inventory) => {
    if (manifest.manifestVersion !== 1) throw new LegacyBackupError("Unsupported backup manifest version");
    if (manifest.archiveFile !== path.basename(archivePath)) {
        throw new LegacyBackupError("Backup manifest archive name mismatch");
    }
    if (manifest.inventorySha256 !== inventory.inventorySha256) {
        throw new LegacyBackupError("Backup manifest inventory hash mismatch");
    }
    if (manifest.format !== "custom" || manifest.dataOnly !== true) {
        throw new LegacyBackupError("Backup manifest format contract mismatch");
    }
    if (JSON.stringify(manifest.tables) !== JSON.stringify(inventory.inventory.backup.tables)) {
        throw new LegacyBackupError("Backup manifest table inventory mismatch");
    }
    const databaseFields = [ "host", "port", "database", "user" ];
    if (!manifest.database || databaseFields.some(field => typeof manifest.database[field] !== "string"
        || manifest.database[field] === "")) {
        throw new LegacyBackupError("Backup manifest database identity is incomplete");
    }
    if (typeof manifest.createdAt !== "string" || Number.isNaN(Date.parse(manifest.createdAt))) {
        throw new LegacyBackupError("Backup manifest timestamp is invalid");
    }
};

const verifyLegacyBackup = async options => {
    const {
        archivePath,
        manifestPath,
        inventory,
        expectedDatabase,
        runCommand: execute = runCommand,
    } = options;
    validateLegacyInventory(inventory);
    const manifest = await readManifest(manifestPath);
    assertManifestContract(manifest, archivePath, inventory);
    if (expectedDatabase && JSON.stringify(manifest.database) !== JSON.stringify(expectedDatabase)) {
        throw new LegacyBackupError("Backup manifest database identity does not match the retirement target");
    }
    const archiveSha256 = await sha256File(archivePath);
    if (manifest.archiveSha256 !== archiveSha256) {
        throw new LegacyBackupError("Backup archive checksum mismatch");
    }
    try {
        await execute("pg_restore", [ "--list", archivePath ]);
    } catch (error) {
        throw new LegacyBackupError(`Backup archive readability check failed: ${error.message}`);
    }
    return manifest;
};

const createLegacyBackup = async options => {
    const {inputs, inventory, runCommand: execute = runCommand, now = () => new Date()} = options;
    validateLegacyInventory(inventory);
    await Promise.all([
        assertDestinationAvailable(inputs.archivePath),
        assertDestinationAvailable(inputs.manifestPath),
    ]);
    const suffix = `.partial-${process.pid}-${randomUUID()}`;
    const temporaryArchive = `${inputs.archivePath}${suffix}`;
    const temporaryManifest = `${inputs.manifestPath}${suffix}`;
    let archivePublished = false;
    try {
        const tables = inventory.inventory.backup.tables;
        const args = [
            "--format=custom",
            "--data-only",
            "--no-password",
            `--host=${inputs.credentials.host}`,
            `--port=${inputs.credentials.port}`,
            `--username=${inputs.credentials.user}`,
            `--dbname=${inputs.credentials.database}`,
            `--file=${temporaryArchive}`,
            ...tables.flatMap(table => [ `--table=public.${table}` ]),
        ];
        await execute("pg_dump", args, {env: inputs.environment});
        await execute("pg_restore", [ "--list", temporaryArchive ]);
        const manifest = {
            manifestVersion: 1,
            archiveFile: path.basename(inputs.archivePath),
            archiveSha256: await sha256File(temporaryArchive),
            inventorySha256: inventory.inventorySha256,
            createdAt: now().toISOString(),
            format: "custom",
            dataOnly: true,
            database: inputs.credentials,
            tables,
        };
        await writeFile(temporaryManifest, `${JSON.stringify(manifest, null, 2)}\n`, {flag: "wx"});
        await link(temporaryArchive, inputs.archivePath);
        archivePublished = true;
        await link(temporaryManifest, inputs.manifestPath);
        return manifest;
    } catch (error) {
        if (archivePublished) await rm(inputs.archivePath, {force: true});
        if (error?.code === "EEXIST") throw new LegacyBackupError("Refusing to overwrite an existing backup path");
        if (error instanceof LegacyBackupError) throw error;
        throw new LegacyBackupError(`Legacy backup failed: ${error.message}`);
    } finally {
        await Promise.all([
            rm(temporaryArchive, {force: true}),
            rm(temporaryManifest, {force: true}),
        ]);
    }
};

export {
    LegacyBackupError,
    createLegacyBackup,
    resolveBackupInputs,
    runCommand,
    verifyLegacyBackup,
};
