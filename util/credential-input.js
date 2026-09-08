import {readFile as readFileCallback} from "node:fs";
import {promisify} from "node:util";

class CredentialInputError extends Error {
    constructor() {
        super("CREDENTIAL_INPUT_INVALID");
        this.name = "CredentialInputError";
        this.code = "CREDENTIAL_INPUT_INVALID";
    }
}

const fail = () => {
    throw new CredentialInputError();
};
const readFd = promisify(readFileCallback);

const readPasswords = async (fd, expectedCount) => {
    try {
        if (!Number.isInteger(fd) || fd < 0) fail();
        const parsed = JSON.parse(await readFd(fd, "utf8"));
        if (!Array.isArray(parsed) || parsed.length !== expectedCount || parsed.some(value => typeof value !== "string")) fail();
        return parsed;
    } catch (error) {
        if (error instanceof CredentialInputError) throw error;
        fail();
    }
};

export {CredentialInputError, readPasswords};
