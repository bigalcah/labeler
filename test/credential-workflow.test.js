import assert from "node:assert/strict";
import {randomBytes} from "node:crypto";
import {spawn} from "node:child_process";
import {chmod, mkdtemp, open, readFile, stat, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import test from "node:test";
import argon2 from "argon2";
import {
    ARGON2ID_POLICY,
    createPasswordHash,
    isValidPasswordHash,
} from "../util/credential-policy.js";
import {
    CredentialManifestError,
    readCredentialManifest,
    validateCredentialManifest,
    writeCredentialManifest,
} from "../util/credential-manifest.js";
import {provisionParticipantAccounts, resetParticipantCredential} from "../util/credential-accounts.js";
import {CredentialCliError, parseCredentialOptions} from "../util/credential-cli.js";

const password = () => randomBytes(32).toString("base64url");
const config = Object.freeze({
    studyKey: "credential-study",
    expectedCardCount: 300,
    participants: Object.freeze([ "one", "two", "three" ]),
});

const createManifest = async () => ({
    manifestVersion: 1,
    studyKey: config.studyKey,
    accounts: await Promise.all(config.participants.map(async participantKey => ({
        participantKey,
        normalizedUsername: participantKey,
        passwordHash: await createPasswordHash(password()),
    }))),
});

const runGenerator = async ({argumentsList, input}) => {
    const child = spawn(process.execPath, [ "scripts/generate-credential-manifest.js", ...argumentsList ], {
        cwd: process.cwd(),
        stdio: [ "pipe", "pipe", "pipe" ],
    });
    const output = [];
    const errors = [];
    child.stdout.on("data", chunk => output.push(chunk));
    child.stderr.on("data", chunk => errors.push(chunk));
    child.stdin.end(input);
    const exitCode = await new Promise(resolve => child.on("close", resolve));
    return {exitCode, output: Buffer.concat(output).toString(), errors: Buffer.concat(errors).toString()};
};

test("Given an exact account manifest When it is validated Then it preserves only configured members and Argon2id hashes", async () => {
    const manifest = await createManifest();

    const validated = validateCredentialManifest(manifest, config);

    assert.deepEqual(validated.accounts.map(account => account.participantKey), config.participants);
    assert.equal(validated.accounts.every(account => isValidPasswordHash(account.passwordHash)), true);
    assert.deepEqual(ARGON2ID_POLICY, {
        type: argon2.argon2id,
        version: 0x13,
        memoryCost: 65536,
        timeCost: 3,
        parallelism: 4,
        hashLength: 32,
    });
});

test("Given malformed policy-shaped PHC strings When they are checked Then invalid salt and digest encodings are rejected", async () => {
    const passwordHash = await createPasswordHash(password());
    const parts = passwordHash.split("$");
    const oneCharacterSalt = [...parts];
    oneCharacterSalt[4] = "A";
    const malformedDigest = [...parts];
    malformedDigest[5] = `${malformedDigest[5]}A`;
    const duplicateParameter = [...parts];
    duplicateParameter[3] = `${duplicateParameter[3]},m=65536`;
    const malformedParameter = [...parts];
    malformedParameter[3] = malformedParameter[3].replace("m=65536", "m=65536=x");

    assert.equal(isValidPasswordHash(oneCharacterSalt.join("$")), false);
    assert.equal(isValidPasswordHash(malformedDigest.join("$")), false);
    assert.equal(isValidPasswordHash(duplicateParameter.join("$")), false);
    assert.equal(isValidPasswordHash(malformedParameter.join("$")), false);
    await assert.rejects(() => argon2.verify(oneCharacterSalt.join("$"), password()));
    await assert.rejects(() => argon2.verify(malformedParameter.join("$"), password()));
});

test("Given a manifest with a plaintext account field When it is validated Then it fails without exposing its content", async () => {
    const manifest = await createManifest();
    manifest.accounts[0].password = password();

    await assert.rejects(
        async () => validateCredentialManifest(manifest, config),
        error => error instanceof CredentialManifestError && error.code === "CREDENTIAL_MANIFEST_INVALID"
            && !error.message.includes(manifest.accounts[0].password),
    );
});

test("Given a valid manifest When it is written and read as a protected file Then the hash-only contract survives atomically", async () => {
    const manifest = await createManifest();
    const directory = await mkdtemp(path.join(tmpdir(), "labeler-credentials-"));
    const output = path.join(directory, "accounts.json");

    await writeCredentialManifest(output, manifest, config);
    const restored = await readCredentialManifest({file: output}, config);

    assert.equal((await stat(output)).mode & 0o777, 0o400);
    assert.deepEqual(restored, validateCredentialManifest(manifest, config));
    assert.equal((await readFile(output, "utf8")).includes("password\""), false);
    await assert.rejects(() => writeCredentialManifest(output, manifest, config), CredentialManifestError);
});

test("Given a writable manifest file or descriptor When it is read Then the source is rejected", async () => {
    const manifest = await createManifest();
    const directory = await mkdtemp(path.join(tmpdir(), "labeler-credentials-"));
    const output = path.join(directory, "accounts.json");
    await writeCredentialManifest(output, manifest, config);
    await chmod(output, 0o600);

    await assert.rejects(() => readCredentialManifest({file: output}, config), CredentialManifestError);
    const handle = await open(output, "r");
    try {
        await assert.rejects(() => readCredentialManifest({fd: handle.fd}, config), CredentialManifestError);
    } finally {
        await handle.close();
    }
});

test("Given a readonly manifest descriptor When it is read Then it is accepted without a path", async () => {
    const manifest = await createManifest();
    const directory = await mkdtemp(path.join(tmpdir(), "labeler-credentials-"));
    const output = path.join(directory, "accounts.json");
    await writeCredentialManifest(output, manifest, config);
    const handle = await open(output, "r");
    try {
        assert.deepEqual(await readCredentialManifest({fd: handle.fd}, config), validateCredentialManifest(manifest, config));
    } finally {
        await handle.close();
    }
});

test("Given credential command arguments When they include unknown, duplicate, or secret-bearing options Then strict parsing rejects them", () => {
    const options = {required: [ "--study-key", "--participant-key" ], optional: [ "--password-fd" ]};

    assert.throws(() => parseCredentialOptions([ "--study-key", "study", "--participant-key", "one", "--password", password() ], options), CredentialCliError);
    assert.throws(() => parseCredentialOptions([ "--study-key", "study", "--study-key", "other", "--participant-key", "one" ], options), CredentialCliError);
    assert.throws(() => parseCredentialOptions([ "--study-key", "study", "--participant-key", "--bad" ], options), CredentialCliError);
});

test("Given valid generator input plus an unknown option When the generator runs Then it rejects without exposing stdin data", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "labeler-credentials-"));
    const configFile = path.join(directory, "config.json");
    const output = path.join(directory, "accounts.json");
    await writeFile(configFile, JSON.stringify(config));
    const input = JSON.stringify(config.participants.map(() => password()));

    const result = await runGenerator({
        argumentsList: [ "--study-config", configFile, "--output", output, "--unexpected", "value" ],
        input,
    });

    assert.equal(result.exitCode, 1);
    assert.equal(result.output, "");
    assert.equal(result.errors, "CREDENTIAL_MANIFEST_FAILED\n");
    assert.equal(result.errors.includes(input), false);
});

test("Given memberships and an exact manifest When accounts are provisioned Then missing accounts are inserted and compatible accounts remain unchanged", async () => {
    const manifest = await createManifest();
    const accounts = [];
    const memberships = config.participants.map((participant_key, index) => ({participant_key, reviewer_id: index + 1}));
    const client = {query: async (sql, parameters = []) => {
        if (sql.includes("FROM study_participant") && sql.includes("reviewer_id, participant_key")) return {rows: memberships};
        if (sql.startsWith("INSERT INTO participant_account")) {
            if (!accounts.some(account => account.reviewer_id === parameters[1])) {
                accounts.push({...manifest.accounts[parameters[1] - 1], reviewer_id: parameters[1], enabled: true, credential_version: 1,
                    participant_key: memberships[parameters[1] - 1].participant_key, normalized_username: parameters[2], password_hash: parameters[3]});
            }
            return {rows: []};
        }
        if (sql.includes("FROM participant_account account")) return {rows: accounts};
        throw new Error("unexpected query");
    }};

    await provisionParticipantAccounts({client, studyId: "study-id", config, manifest});
    const before = accounts.map(account => ({...account}));
    await provisionParticipantAccounts({client, studyId: "study-id", config, manifest});

    assert.equal(accounts.length, config.participants.length);
    assert.deepEqual(accounts, before);
});

test("Given a selected local account When its credential is reset Then its version advances once and only its sessions are revoked", async () => {
    const passwordValue = password();
    const calls = [];
    const client = {query: async (sql, parameters = []) => {
        calls.push({sql, parameters});
        if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") return {rows: []};
        if (sql.includes("FROM participant_account account")) return {rows: [{id: "account-id"}]};
        return {rows: []};
    }};
    const pool = {connect: async () => ({...client, release: () => {}})};

    await resetParticipantCredential({pool, studyKey: config.studyKey, participantKey: config.participants[0], password: passwordValue});

    const transactionSteps = calls.map(call => call.sql === "BEGIN" || call.sql === "COMMIT"
        ? call.sql
        : call.sql.includes("FROM participant_account account") ? "SELECT"
            : call.sql.startsWith("UPDATE participant_account") ? "UPDATE"
                : call.sql.startsWith("DELETE FROM app_session") ? "DELETE" : "OTHER");
    assert.deepEqual(transactionSteps, [ "BEGIN", "SELECT", "UPDATE", "DELETE", "COMMIT" ]);
    assert.equal(calls.some(call => JSON.stringify(call).includes(passwordValue)), false);
});

test("Given a missing reset account When reset is requested Then the transaction rolls back before session revocation", async () => {
    const calls = [];
    const client = {query: async sql => {
        calls.push(sql);
        if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") return {rows: []};
        return {rows: []};
    }};
    const pool = {connect: async () => ({...client, release: () => {}})};

    await assert.rejects(
        () => resetParticipantCredential({pool, studyKey: config.studyKey, participantKey: config.participants[0], password: password()}),
    );

    assert.deepEqual(calls.filter(sql => [ "BEGIN", "COMMIT", "ROLLBACK" ].includes(sql)), [ "BEGIN", "ROLLBACK" ]);
    assert.equal(calls.some(sql => sql.startsWith("DELETE FROM app_session")), false);
});
