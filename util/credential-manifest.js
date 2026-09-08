import {fstat as fstatCallback, readFile as readFileCallback} from "node:fs";
import {link, open, unlink} from "node:fs/promises";
import {isAbsolute, dirname, join} from "node:path";
import {randomUUID} from "node:crypto";
import {promisify} from "node:util";
import {isValidPasswordHash} from "./credential-policy.js";

class CredentialManifestError extends Error {
    constructor() {
        super("CREDENTIAL_MANIFEST_INVALID");
        this.name = "CredentialManifestError";
        this.code = "CREDENTIAL_MANIFEST_INVALID";
    }
}

const fail = () => {
    throw new CredentialManifestError();
};
const fstat = promisify(fstatCallback);
const readFd = promisify(readFileCallback);

const removeTemporary = async temporary => {
    try {
        await unlink(temporary);
    } catch (error) {
        if (error && typeof error === "object" && error.code === "ENOENT") return;
        fail();
    }
};

const removeCommittedTemporary = async temporary => {
    try {
        await unlink(temporary);
    } catch (error) {
        if (error && typeof error === "object" && error.code === "ENOENT") return;
    }
};

const normalizeUsername = value => {
    if (typeof value !== "string" || value.trim() !== value || !/^[a-z0-9][a-z0-9._-]{0,127}$/.test(value)) fail();
    return value;
};

const validateCredentialManifest = (value, config) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) fail();
    if (Object.keys(value).length !== 3 || value.manifestVersion !== 1 || value.studyKey !== config.studyKey
        || !Array.isArray(value.accounts)) fail();
    const expectedParticipants = config.participants;
    if (value.accounts.length !== expectedParticipants.length) fail();
    const accounts = value.accounts.map(account => {
        if (!account || typeof account !== "object" || Array.isArray(account)
            || Object.keys(account).length !== 3) fail();
        const {participantKey, normalizedUsername, passwordHash} = account;
        if (typeof participantKey !== "string" || !isValidPasswordHash(passwordHash)) fail();
        return Object.freeze({participantKey, normalizedUsername: normalizeUsername(normalizedUsername), passwordHash});
    });
    if (new Set(accounts.map(account => account.participantKey)).size !== accounts.length
        || new Set(accounts.map(account => account.normalizedUsername)).size !== accounts.length
        || accounts.some((account, index) => account.participantKey !== expectedParticipants[index])) fail();
    return Object.freeze({
        manifestVersion: 1,
        studyKey: config.studyKey,
        accounts: Object.freeze(accounts),
    });
};

const assertProtectedMetadata = metadata => {
    if (!metadata.isFile() || (metadata.mode & 0o777) !== 0o400) fail();
};

const parseManifest = (content, config) => {
    try {
        return validateCredentialManifest(JSON.parse(content), config);
    } catch (_error) {
        fail();
    }
};

const readCredentialManifest = async ({file, fd}, config) => {
    try {
        if (file !== undefined) {
            if (typeof file !== "string" || !isAbsolute(file) || file.includes("\0") || fd !== undefined) fail();
            const handle = await open(file, "r");
            try {
                assertProtectedMetadata(await handle.stat());
                return parseManifest(await handle.readFile("utf8"), config);
            } finally {
                await handle.close();
            }
        }
        if (!Number.isInteger(fd) || fd < 0) fail();
        assertProtectedMetadata(await fstat(fd));
        return parseManifest(await readFd(fd, "utf8"), config);
    } catch (error) {
        if (error instanceof CredentialManifestError) throw error;
        fail();
    }
};

const writeCredentialManifest = async (file, manifest, config) => {
    if (typeof file !== "string" || !isAbsolute(file) || file.includes("\0")) fail();
    const validated = validateCredentialManifest(manifest, config);
    const temporary = join(dirname(file), `.${randomUUID()}.tmp`);
    let handle;
    try {
        handle = await open(temporary, "wx", 0o600);
        await handle.writeFile(`${JSON.stringify(validated)}\n`, "utf8");
        await handle.sync();
        await handle.chmod(0o400);
        await handle.close();
        handle = undefined;
        await link(temporary, file);
        await removeCommittedTemporary(temporary);
    } catch (error) {
        if (handle) await handle.close();
        await removeTemporary(temporary);
        if (error instanceof CredentialManifestError) throw error;
        fail();
    }
};

export {
    CredentialManifestError,
    normalizeUsername,
    readCredentialManifest,
    validateCredentialManifest,
    writeCredentialManifest,
};
