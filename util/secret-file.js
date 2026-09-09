import {readFileSync, statSync} from "node:fs";
import path from "node:path";

class SecretFileError extends Error {
    constructor(field) {
        super(`SECRET_FILE_INVALID ${field}`);
        this.name = "SecretFileError";
        this.code = "SECRET_FILE_INVALID";
        this.field = field;
    }
}

const fail = field => {
    throw new SecretFileError(field);
};

const readSecretFile = (file, field, io = {readFileSync, statSync}) => {
    if (typeof file !== "string" || !path.isAbsolute(file) || file.includes("\0")) fail(field);
    let metadata;
    try {
        metadata = io.statSync(file);
    } catch (_error) {
        fail(field);
    }
    if (!metadata.isFile() || ![0o400, 0o600].includes(metadata.mode & 0o777)) fail(field);
    let content;
    try {
        content = io.readFileSync(file, "utf8");
    } catch (_error) {
        fail(field);
    }
    const secret = content.endsWith("\r\n")
        ? content.slice(0, -2)
        : content.endsWith("\n") ? content.slice(0, -1) : content;
    if (secret === "" || secret.includes("\n") || secret.includes("\r")) fail(field);
    return secret;
};

export {SecretFileError, readSecretFile};
