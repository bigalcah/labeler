import assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtemp, readFile, stat, writeFile} from "node:fs/promises";
import {promisify} from "node:util";
import {tmpdir} from "node:os";
import test from "node:test";
import {ProductionConfigError, readProductionConfig, validateProductionConfig} from "../util/production-config.js";

const run = promisify(execFile);
const validSecret = Buffer.alloc(32, 1).toString("base64url");
const previousSecret = Buffer.alloc(32, 2).toString("base64url");

const productionInput = overrides => ({
    nodeEnv: "production",
    appOrigin: "https://study.example",
    trustProxyHops: "1",
    sessionSecretFile: "/run/secrets/session-current",
    sessionSecretPreviousFile: "/run/secrets/session-previous",
    ...overrides,
});

test("production config returns an immutable public policy and ordered secret closure", () => {
    const config = validateProductionConfig({
        ...productionInput(),
        sessionSecrets: [Buffer.from(validSecret, "base64url"), Buffer.from(previousSecret, "base64url")],
    });

    assert.equal(config.appOrigin, "https://study.example");
    assert.equal(config.trustProxyHops, 1);
    assert.deepEqual(config.sessionCookie, {
        name: "__Host-session",
        secure: true,
        httpOnly: true,
        sameSite: "lax",
        path: "/",
    });
    assert.equal(config.idleTtlMs, 28_800_000);
    assert.equal(config.absoluteTtlMs, 86_400_000);
    assert.equal(Object.isFrozen(config), true);
    assert.equal(Object.keys(config).includes("getSessionSecrets"), false);
    assert.deepEqual(config.getSessionSecrets(), [
        Buffer.from(validSecret, "base64url"),
        Buffer.from(previousSecret, "base64url"),
    ]);
});

test("production config rejects unsafe origin, proxy, paths, and weak secret policy", () => {
    for (const overrides of [
        {appOrigin: "http://study.example"},
        {appOrigin: "https://user:password@study.example"},
        {appOrigin: "https://study.example/path"},
        {trustProxyHops: "01"},
        {sessionSecretFile: "relative-secret"},
        {sessionSecretPreviousFile: "/run/secrets/session-current"},
        {sessionSecrets: [Buffer.from("short")]},
    ]) {
        assert.throws(() => validateProductionConfig({...productionInput(), sessionSecrets: [Buffer.from(validSecret, "base64url")], ...overrides}), error => {
            assert.equal(error.code, "CONFIG_INVALID");
            assert.equal(error.message.includes("study.example"), false);
            assert.equal(error.cause, undefined);
            return true;
        });
    }
});

test("readProductionConfig validates secret file permissions and canonical content", async () => {
    const directory = await mkdtemp(`${tmpdir()}/labeler-config-`);
    const current = `${directory}/current`;
    const previous = `${directory}/previous`;
    await writeFile(current, `${validSecret}\n`, {mode: 0o400});
    await writeFile(previous, `${previousSecret}\r\n`, {mode: 0o600});
    const config = readProductionConfig({
        NODE_ENV: "production",
        APP_ORIGIN: "https://study.example",
        TRUST_PROXY_HOPS: "1",
        SESSION_SECRET_FILE: current,
        SESSION_SECRET_PREVIOUS_FILE: previous,
    });

    assert.equal(config.getSessionSecrets()[0].length >= 32, true);
    assert.equal((await stat(current)).mode & 0o777, 0o400);
});

test("readProductionConfig rejects permissive modes and noncanonical secret files", async () => {
    const cases = [
        {mode: 0o644, content: `${validSecret}\n`, suffix: "permissive-mode"},
        {mode: 0o400, content: `${validSecret}=\n`, suffix: "padded-content"},
        {mode: 0o600, content: `${validSecret}*\n`, suffix: "invalid-alphabet"},
        {mode: 0o400, content: `${validSecret} \n`, suffix: "whitespace-content"},
    ];

    for (const {mode, content, suffix} of cases) {
        const directory = await mkdtemp(`${tmpdir()}/labeler-secret-${suffix}-`);
        const file = `${directory}/${suffix}-sentinel-path`;
        await writeFile(file, content, {mode});

        assert.throws(() => readProductionConfig({
            NODE_ENV: "production",
            APP_ORIGIN: "https://study.example",
            TRUST_PROXY_HOPS: "1",
            SESSION_SECRET_FILE: file,
        }), error => {
            assert.equal(error instanceof ProductionConfigError, true);
            assert.equal(error.code, "CONFIG_INVALID");
            assert.equal(error.message, "CONFIG_INVALID SESSION_SECRET_FILE");
            assert.doesNotMatch(error.message, new RegExp(validSecret));
            assert.doesNotMatch(error.message, /sentinel-path/);
            assert.equal(error.cause, undefined);
            return true;
        });
    }
});

test("readProductionConfig rejects duplicate secret material in different files", async () => {
    const directory = await mkdtemp(`${tmpdir()}/labeler-rotation-`);
    const current = `${directory}/current-sentinel-path`;
    const previous = `${directory}/previous-sentinel-path`;
    const sentinel = validSecret;
    await writeFile(current, `${sentinel}\n`, {mode: 0o400});
    await writeFile(previous, `${sentinel}\n`, {mode: 0o400});

    assert.throws(() => readProductionConfig({
        NODE_ENV: "production",
        APP_ORIGIN: "https://study.example",
        TRUST_PROXY_HOPS: "1",
        SESSION_SECRET_FILE: current,
        SESSION_SECRET_PREVIOUS_FILE: previous,
    }), error => {
        assert.equal(error.code, "CONFIG_INVALID");
        assert.equal(error.message, "CONFIG_INVALID SESSION_SECRET_PREVIOUS_FILE");
        assert.doesNotMatch(error.message, new RegExp(sentinel));
        assert.doesNotMatch(error.message, /current-sentinel-path|previous-sentinel-path/);
        assert.equal(error.cause, undefined);
        return true;
    });
});

test("production startup reports only a stable configuration code and creates no logs", async () => {
    const cwd = await mkdtemp(`${tmpdir()}/labeler-startup-`);
    const sentinel = `${cwd}/sentinel-secret-path`;
    const sentinelSecret = "sentinel-secret-content";
    await writeFile(sentinel, `${sentinelSecret}\n`, {mode: 0o400});
    let result;
    let resolved = false;
    try {
        result = await run(process.execPath, [new URL("../index.js", import.meta.url).pathname], {
            cwd,
            env: {
                ...process.env,
                NODE_ENV: "production",
                APP_ORIGIN: "https://study.example",
                TRUST_PROXY_HOPS: "1",
                SESSION_SECRET_FILE: sentinel,
            },
        });
        resolved = true;
    } catch (error) {
        result = error;
    }

    assert.equal(resolved, false, "production startup unexpectedly succeeded");
    assert.equal(result.code, 1);
    assert.equal(`${result.stdout}${result.stderr}`.includes(sentinel), false);
    assert.equal(`${result.stdout}${result.stderr}`.includes(sentinelSecret), false);
    assert.equal(`${result.stdout}${result.stderr}`.includes("sentinel-secret-path"), false);
    assert.match(result.stderr, /^CONFIG_INVALID SESSION_SECRET_FILE\n$/);
    await assert.rejects(readFile(`${cwd}/logs`));
});
