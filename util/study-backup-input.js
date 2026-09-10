import {realpathSync} from "node:fs";
import path from "node:path";
import {readSecretFile} from "./secret-file.js";

class StudyBackupInputError extends Error {
    constructor(message) {
        super(message);
        this.name = "StudyBackupInputError";
    }
}

const required = (environment, name) => {
    const value = environment[name];
    if (typeof value !== "string" || value.trim() === "") throw new StudyBackupInputError(`${name} is required`);
    return value;
};

const resolveExternalPath = (value, name, repositoryRoot) => {
    if (!path.isAbsolute(value)) throw new StudyBackupInputError(`${name} must be an absolute path`);
    let resolved;
    try {
        resolved = path.join(realpathSync(path.dirname(value)), path.basename(value));
    } catch (_error) {
        throw new StudyBackupInputError(`${name} parent directory is invalid`);
    }
    const relative = path.relative(realpathSync(repositoryRoot), resolved);
    if (relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..")) {
        throw new StudyBackupInputError(`${name} must be outside the repository`);
    }
    return resolved;
};

const validateSecretPath = (environment, name, repositoryRoot) => {
    const filePath = required(environment, name);
    try {
        readSecretFile(filePath, name);
        const resolved = realpathSync(filePath);
        const relative = path.relative(realpathSync(repositoryRoot), resolved);
        if (relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..")) throw new Error();
    } catch (_error) {
        throw new StudyBackupInputError(`${name} is invalid`);
    }
    return filePath;
};

const resolveStudyBackupInputs = (environment, repositoryRoot) => {
    const archivePath = resolveExternalPath(required(environment, "STUDY_BACKUP_ARCHIVE"), "STUDY_BACKUP_ARCHIVE", repositoryRoot);
    const manifestPath = resolveExternalPath(required(environment, "STUDY_BACKUP_MANIFEST"), "STUDY_BACKUP_MANIFEST", repositoryRoot);
    if (archivePath === manifestPath) throw new StudyBackupInputError("Backup archive and manifest paths must differ");
    const retentionText = required(environment, "STUDY_BACKUP_RETENTION_DAYS");
    if (!/^[1-9]\d*$/.test(retentionText)) {
        throw new StudyBackupInputError("STUDY_BACKUP_RETENTION_DAYS must be a positive integer");
    }
    const database = {
        host: required(environment, "PGHOST"),
        port: required(environment, "PGPORT"),
        database: required(environment, "PGDATABASE"),
        user: required(environment, "PGUSER"),
    };
    validateSecretPath(environment, "PGPASSFILE", repositoryRoot);
    const encryptionKeyFile = validateSecretPath(environment, "STUDY_BACKUP_ENCRYPTION_KEY_FILE", repositoryRoot);
    const {
        PGPASSWORD: _password,
        STUDY_BACKUP_ENCRYPTION_PASSPHRASE: _passphrase,
        ...safeEnvironment
    } = environment;
    return {
        archivePath,
        manifestPath,
        encryptionKeyFile,
        retentionDays: Number(retentionText),
        database,
        environment: safeEnvironment,
    };
};

const resolveStudyRestoreInputs = (environment, repositoryRoot) => {
    if (environment.STUDY_RESTORE_CONFIRM !== "isolated-restore") {
        throw new StudyBackupInputError("STUDY_RESTORE_CONFIRM=isolated-restore is required");
    }
    const archivePath = resolveExternalPath(required(environment, "STUDY_BACKUP_ARCHIVE"), "STUDY_BACKUP_ARCHIVE", repositoryRoot);
    const manifestPath = resolveExternalPath(required(environment, "STUDY_BACKUP_MANIFEST"), "STUDY_BACKUP_MANIFEST", repositoryRoot);
    const encryptionKeyFile = validateSecretPath(environment, "STUDY_BACKUP_ENCRYPTION_KEY_FILE", repositoryRoot);
    const targetPassfile = validateSecretPath(environment, "STUDY_RESTORE_PGPASSFILE", repositoryRoot);
    const productionDatabase = {
        host: required(environment, "PGHOST"),
        port: required(environment, "PGPORT"),
        database: required(environment, "PGDATABASE"),
        user: required(environment, "PGUSER"),
    };
    const targetDatabase = {
        host: required(environment, "STUDY_RESTORE_PGHOST"),
        port: required(environment, "STUDY_RESTORE_PGPORT"),
        database: required(environment, "STUDY_RESTORE_PGDATABASE"),
        user: required(environment, "STUDY_RESTORE_PGUSER"),
    };
    const {
        PGPASSWORD: _password,
        STUDY_RESTORE_PGPASSWORD: _restorePassword,
        STUDY_BACKUP_ENCRYPTION_PASSPHRASE: _passphrase,
        ...safeEnvironment
    } = environment;
    return {
        archivePath,
        manifestPath,
        encryptionKeyFile,
        productionDatabase,
        targetDatabase,
        environment: {...safeEnvironment, PGPASSFILE: targetPassfile},
    };
};

export {StudyBackupInputError, resolveStudyBackupInputs, resolveStudyRestoreInputs};
