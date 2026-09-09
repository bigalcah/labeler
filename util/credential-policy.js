import argon2 from "argon2";

const ARGON2ID_POLICY = Object.freeze({
    type: argon2.argon2id,
    version: 0x13,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 4,
    hashLength: 32,
});
const decodeBase64 = value => {
    if (typeof value !== "string" || !/^[A-Za-z0-9+/]+$/.test(value)) return null;
    const decoded = Buffer.from(value, "base64");
    return decoded.toString("base64").replace(/=+$/, "") === value ? decoded : null;
};

const hasCentralPolicy = value => {
    const entries = value.split(",").map(parameter => parameter.split("="));
    const parameters = new Map(entries);
    return entries.length === 3 && entries.every(([key, parameterValue, ...extra]) => extra.length === 0 && key !== undefined
        && parameterValue !== undefined && /^[mtp]$/.test(key) && /^\d+$/.test(parameterValue))
        && new Set(entries.map(([key]) => key)).size === 3 && parameters.size === 3
        && parameters.get("m") === `${ARGON2ID_POLICY.memoryCost}`
        && parameters.get("t") === `${ARGON2ID_POLICY.timeCost}`
        && parameters.get("p") === `${ARGON2ID_POLICY.parallelism}`;
};

const createPasswordHash = password => argon2.hash(password, ARGON2ID_POLICY);
const verifyPasswordHash = (passwordHash, password) => argon2.verify(passwordHash, password);
const isValidPasswordHash = passwordHash => {
    if (typeof passwordHash !== "string") return false;
    const parts = passwordHash.split("$");
    if (parts.length !== 6 || parts[0] !== "" || parts[1] !== "argon2id" || parts[2] !== "v=19"
        || !hasCentralPolicy(parts[3])) return false;
    const salt = decodeBase64(parts[4]);
    const digest = decodeBase64(parts[5]);
    return salt !== null && salt.length >= 8 && digest !== null && digest.length === ARGON2ID_POLICY.hashLength;
};

export {ARGON2ID_POLICY, createPasswordHash, isValidPasswordHash, verifyPasswordHash};
