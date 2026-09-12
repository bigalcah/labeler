import {existsSync, realpathSync, statSync} from "node:fs";
import path from "node:path";
import {readSecretFile} from "./secret-file.js";

class StudyExportInputError extends Error {
    constructor(message) {
        super(message);
        this.name = "StudyExportInputError";
    }
}

const isInside = (parent, candidate) => {
    const relative = path.relative(parent, candidate);
    return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..");
};

const parseOptions = argumentsList => {
    const options = {};
    for (let index = 0; index < argumentsList.length; index += 2) {
        const name = argumentsList[index];
        const value = argumentsList[index + 1];
        if (!["--study-key", "--output"].includes(name) || !value || value.startsWith("--") || options[name]) {
            throw new StudyExportInputError("Usage: export:study -- --study-key <key> --output <external-directory>");
        }
        options[name] = value;
    }
    if (Object.keys(options).length !== 2) {
        throw new StudyExportInputError("Usage: export:study -- --study-key <key> --output <external-directory>");
    }
    return options;
};

const resolveStudyExportInputs = (argumentsList, environment, repositoryRoot) => {
    const options = parseOptions(argumentsList);
    const studyKey = options["--study-key"].trim();
    if (!studyKey || studyKey.includes("\0")) throw new StudyExportInputError("--study-key is invalid");
    const requestedDestination = options["--output"];
    if (!path.isAbsolute(requestedDestination) || requestedDestination.includes("\0")) {
        throw new StudyExportInputError("--output must be an absolute path");
    }
    let destination;
    try {
        const parent = realpathSync(path.dirname(requestedDestination));
        if (!statSync(parent).isDirectory()) throw new Error();
        destination = path.join(parent, path.basename(requestedDestination));
    } catch (_error) {
        throw new StudyExportInputError("--output parent directory is invalid");
    }
    if (isInside(realpathSync(repositoryRoot), destination)) {
        throw new StudyExportInputError("--output must be outside the repository");
    }
    if (existsSync(destination)) throw new StudyExportInputError("--output destination must not exist");

    const secretFile = environment.STUDY_EXPORT_HMAC_SECRET_FILE;
    let hmacSecret;
    try {
        if (typeof secretFile !== "string" || isInside(realpathSync(repositoryRoot), realpathSync(secretFile))) throw new Error();
        hmacSecret = readSecretFile(secretFile, "STUDY_EXPORT_HMAC_SECRET_FILE");
    } catch (_error) {
        throw new StudyExportInputError("STUDY_EXPORT_HMAC_SECRET_FILE is invalid");
    }
    if (Buffer.byteLength(hmacSecret, "utf8") < 32) {
        throw new StudyExportInputError("STUDY_EXPORT_HMAC_SECRET_FILE is invalid");
    }
    return Object.freeze({studyKey, destination, hmacSecret});
};

export {StudyExportInputError, resolveStudyExportInputs};
