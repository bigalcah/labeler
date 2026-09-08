class CredentialCliError extends Error {
    constructor() {
        super("CREDENTIAL_ARGUMENTS_INVALID");
        this.name = "CredentialCliError";
        this.code = "CREDENTIAL_ARGUMENTS_INVALID";
    }
}

const fail = () => {
    throw new CredentialCliError();
};

const parseCredentialOptions = (argumentsList, {required, optional = []}) => {
    if (!Array.isArray(argumentsList) || argumentsList.length % 2 !== 0) fail();
    const allowed = new Set([ ...required, ...optional ]);
    const parsed = {};
    for (let index = 0; index < argumentsList.length; index += 2) {
        const option = argumentsList[index];
        const value = argumentsList[index + 1];
        if (!allowed.has(option) || Object.hasOwn(parsed, option) || typeof value !== "string" || value.startsWith("-")) fail();
        parsed[option] = value;
    }
    if (required.some(option => !Object.hasOwn(parsed, option))) fail();
    return Object.freeze(parsed);
};

export {CredentialCliError, parseCredentialOptions};
