import {readFileSync, statSync} from "node:fs";
import {timingSafeEqual} from "node:crypto";
import path from "node:path";

const IDLE_TTL_MS = 28_800_000;
const ABSOLUTE_TTL_MS = 86_400_000;
const SESSION_COOKIE = Object.freeze({
    name: "__Host-session",
    secure: true,
    httpOnly: true,
    sameSite: "lax",
    path: "/",
});

class ProductionConfigError extends Error {
    constructor(field) {
        super(`CONFIG_INVALID ${field}`);
        this.name = "ProductionConfigError";
        this.code = "CONFIG_INVALID";
        this.field = field;
    }
}

const fail = field => {
    throw new ProductionConfigError(field);
};

const assertAbsoluteFile = (value, field) => {
    if (typeof value !== "string" || !path.isAbsolute(value) || value.includes("\0")) fail(field);
    return value;
};

const validateOrigin = value => {
    if (typeof value !== "string" || value.trim() !== value) fail("APP_ORIGIN");
    let origin;
    try {
        origin = new URL(value);
    } catch (_error) {
        fail("APP_ORIGIN");
    }
    if (origin.protocol !== "https:" || origin.username || origin.password
        || origin.pathname !== "/" || origin.search || origin.hash) fail("APP_ORIGIN");
    return origin.origin;
};

const validateTrustProxyHops = value => {
    if (value !== "1") fail("TRUST_PROXY_HOPS");
    return 1;
};

const decodeSecret = (value, field) => {
    if (!Buffer.isBuffer(value) || value.length < 32) fail(field);
    return Buffer.from(value);
};

const freezePolicy = ({nodeEnv, appOrigin = null, trustProxyHops = 0, sessionSecrets = []}) => {
    const policy = {
        nodeEnv,
        appOrigin,
        trustProxyHops,
        sessionCookie: SESSION_COOKIE,
        idleTtlMs: IDLE_TTL_MS,
        absoluteTtlMs: ABSOLUTE_TTL_MS,
    };
    const secrets = sessionSecrets.map((secret, index) => decodeSecret(secret, index === 0
        ? "SESSION_SECRET_FILE"
        : "SESSION_SECRET_PREVIOUS_FILE"));
    Object.defineProperty(policy, "getSessionSecrets", {
        enumerable: false,
        value: () => secrets.map(secret => Buffer.from(secret)),
    });
    return Object.freeze(policy);
};

const validateProductionConfig = input => {
    if (!input || typeof input !== "object" || Array.isArray(input)) fail("CONFIG");
    const nodeEnv = input.nodeEnv;
    if (nodeEnv !== "production") return freezePolicy({nodeEnv});
    const appOrigin = validateOrigin(input.appOrigin);
    const trustProxyHops = validateTrustProxyHops(input.trustProxyHops);
    const sessionSecretFile = assertAbsoluteFile(input.sessionSecretFile, "SESSION_SECRET_FILE");
    const previousFile = input.sessionSecretPreviousFile;
    if (previousFile !== undefined && (typeof previousFile !== "string" || previousFile.trim() === "")) {
        fail("SESSION_SECRET_PREVIOUS_FILE");
    }
    if (previousFile !== undefined) assertAbsoluteFile(previousFile, "SESSION_SECRET_PREVIOUS_FILE");
    if (previousFile !== undefined && path.resolve(sessionSecretFile) === path.resolve(previousFile)) {
        fail("SESSION_SECRET_PREVIOUS_FILE");
    }
    const sessionSecrets = input.sessionSecrets;
    if (!Array.isArray(sessionSecrets) || sessionSecrets.length < 1 || sessionSecrets.length > 2) {
        fail("SESSION_SECRET_FILE");
    }
    if (previousFile === undefined && sessionSecrets.length !== 1) fail("SESSION_SECRET_PREVIOUS_FILE");
    if (previousFile !== undefined && sessionSecrets.length !== 2) fail("SESSION_SECRET_PREVIOUS_FILE");
    const decodedSecrets = sessionSecrets.map((secret, index) => decodeSecret(secret, index === 0
        ? "SESSION_SECRET_FILE"
        : "SESSION_SECRET_PREVIOUS_FILE"));
    if (decodedSecrets.length === 2) {
        const [currentSecret, previousSecret] = decodedSecrets;
        if (currentSecret.length === previousSecret.length && timingSafeEqual(currentSecret, previousSecret)) {
            fail("SESSION_SECRET_PREVIOUS_FILE");
        }
    }
    return freezePolicy({nodeEnv, appOrigin, trustProxyHops, sessionSecrets: decodedSecrets});
};

const readSecret = (file, field, io) => {
    assertAbsoluteFile(file, field);
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
    const withoutLineEnding = content.endsWith("\r\n")
        ? content.slice(0, -2)
        : content.endsWith("\n") ? content.slice(0, -1) : content;
    if (withoutLineEnding.includes("\n") || withoutLineEnding.includes("\r")
        || !/^[A-Za-z0-9_-]+$/.test(withoutLineEnding)) fail(field);
    const decoded = Buffer.from(withoutLineEnding, "base64url");
    if (decoded.length < 32 || decoded.toString("base64url") !== withoutLineEnding) fail(field);
    return decoded;
};

const readProductionConfig = (environment = process.env, io = {readFileSync, statSync}) => {
    const nodeEnv = environment.NODE_ENV || "development";
    if (nodeEnv !== "production") return validateProductionConfig({nodeEnv});
    const currentFile = environment.SESSION_SECRET_FILE;
    const previousFile = environment.SESSION_SECRET_PREVIOUS_FILE;
    const sessionSecrets = [readSecret(currentFile, "SESSION_SECRET_FILE", io)];
    if (previousFile !== undefined && previousFile.trim() !== "") {
        sessionSecrets.push(readSecret(previousFile, "SESSION_SECRET_PREVIOUS_FILE", io));
    }
    return validateProductionConfig({
        nodeEnv,
        appOrigin: environment.APP_ORIGIN,
        trustProxyHops: environment.TRUST_PROXY_HOPS,
        sessionSecretFile: currentFile,
        sessionSecretPreviousFile: previousFile,
        sessionSecrets,
    });
};

export {
    ProductionConfigError,
    readProductionConfig,
    validateProductionConfig,
};
