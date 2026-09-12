import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {createHmac, randomUUID} from "node:crypto";
import {once} from "node:events";
import {after, before, test} from "node:test";
import express from "express";
import pg from "pg";
import {createApp} from "../app.js";
import {resetParticipantCredential} from "../util/credential-accounts.js";
import {createPasswordHash} from "../util/credential-policy.js";
import {authenticateLogin} from "../util/login-authentication.js";
import {createSessionMiddleware} from "../util/session-middleware.js";
import {runStudyMigrations} from "../util/study-schema.js";

const {Pool} = pg;
const containerName = `labeler-multi-study-auth-${randomUUID()}`;
const now = new Date("2026-01-01T12:00:00.000Z");
const signingSecret = Buffer.alloc(32, 9);
const sessionPolicy = {
    sessionCookie: {name: "__Host-session", secure: true, httpOnly: true, sameSite: "lax", path: "/"},
    idleTtlMs: 28_800_000,
    absoluteTtlMs: 86_400_000,
    getSessionSecrets: () => [signingSecret],
};
let pool;

const docker = argumentsList => {
    const result = spawnSync("docker", argumentsList, {encoding: "utf8"});
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    return result.stdout.trim();
};

const signedCookie = sessionId => `${sessionId}.${createHmac("sha256", signingSecret)
    .update(sessionId, "ascii").digest("base64url")}`;

const readSessionContext = async sessionId => {
    const app = express();
    app.use(createSessionMiddleware({pool, clock: () => now, policy: sessionPolicy}));
    app.get("/context", (request, response) => response.json(request.sessionContext));
    const server = app.listen(0);
    await once(server, "listening");
    try {
        const response = await fetch(`http://127.0.0.1:${server.address().port}/context`, {
            headers: {cookie: `__Host-session=${signedCookie(sessionId)}`},
        });
        return response.json();
    } finally {
        await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
};

const logoutThroughHttp = async sessionId => {
    const {rows: [session]} = await pool.query(
        "SELECT csrf_token FROM app_session WHERE session_id = $1",
        [sessionId],
    );
    const app = await createApp({pool, clock: () => now, sessionPolicy});
    const server = app.listen(0);
    await once(server, "listening");
    try {
        return await fetch(`http://127.0.0.1:${server.address().port}/logout`, {
            method: "POST",
            headers: {
                cookie: `__Host-session=${signedCookie(sessionId)}`,
                origin: "http://127.0.0.1",
                "content-type": "application/x-www-form-urlencoded",
            },
            body: `csrf_token=${session.csrf_token}`,
            redirect: "manual",
        });
    } finally {
        await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
};

before(async () => {
    docker(["run", "--rm", "--detach", "--name", containerName, "--tmpfs",
        "/var/lib/postgresql/data:rw,nosuid,nodev", "--publish", "127.0.0.1::5432",
        "--env", "POSTGRES_HOST_AUTH_METHOD=trust", "--env", "POSTGRES_USER=labeler_test",
        "--env", "POSTGRES_DB=labeler_test", "postgres:17.6-alpine"]);
    const endpoint = docker(["port", containerName, "5432/tcp"]);
    pool = new Pool({host: "127.0.0.1", port: Number(endpoint.slice(endpoint.lastIndexOf(":") + 1)),
        user: "labeler_test", database: "labeler_test"});
    for (let attempt = 0; attempt < 60; attempt += 1) {
        try {
            await pool.query("SELECT 1");
            await runStudyMigrations(pool);
            return;
        } catch (error) {
            if (attempt === 59) throw error;
            await new Promise(resolve => setTimeout(resolve, 250));
        }
    }
});

after(async () => {
    if (pool) await pool.end();
    spawnSync("docker", ["rm", "--force", containerName], {encoding: "utf8"});
});

test("Given two real study accounts When login, reset, and logout run Then sessions remain bound to persisted account studies", async () => {
    const currentHash = await createPasswordHash("current-password-value-for-integration");
    const validationHash = await createPasswordHash("validation-password-value-for-integration");
    const participants = [ "javier", "diego", "pablo" ];
    await pool.query(
        `INSERT INTO study(study_key, config, source_checksum, expected_card_count, bootstrap_state)
         VALUES
           ('pr-card-sorting-local', $1, 'current-checksum', 300, 'READY'),
           ('pr-card-sorting-validation-30', $2, 'validation-checksum', 30, 'READY')`,
        [
            {studyKey: "pr-card-sorting-local", expectedCardCount: 300, participants,
                loginUsernames: {javier: "javier", diego: "diego", pablo: "pablo"}},
            {studyKey: "pr-card-sorting-validation-30", expectedCardCount: 30, participants,
                loginUsernames: {javier: "javier-30", diego: "diego-30", pablo: "pablo-30"}},
        ],
    );
    await pool.query("INSERT INTO reviewer(name) SELECT unnest($1::text[])", [participants]);
    await pool.query(
        `INSERT INTO study_participant(study_id, reviewer_id, participant_key, ordinal)
         SELECT study.id, reviewer.id, participant.name, participant.ordinal
         FROM study
         CROSS JOIN unnest($1::text[]) WITH ORDINALITY participant(name, ordinal)
         INNER JOIN reviewer ON reviewer.name = participant.name`,
        [participants],
    );
    await pool.query(
        `INSERT INTO participant_account(study_id, reviewer_id, normalized_username, password_hash)
         SELECT participant.study_id, participant.reviewer_id,
           CASE WHEN study.study_key = 'pr-card-sorting-local'
             THEN participant.participant_key ELSE participant.participant_key || '-30' END,
           CASE WHEN study.study_key = 'pr-card-sorting-local' THEN $1 ELSE $2 END
         FROM study_participant participant
         INNER JOIN study ON study.id = participant.study_id`,
        [currentHash, validationHash],
    );
    const currentSessionId = "a".repeat(43);
    const validationSessionId = "b".repeat(43);
    const currentLogin = await authenticateLogin({pool, username: "javier",
        password: "current-password-value-for-integration", clientIp: "127.0.0.1",
        clock: () => now, createSessionId: () => currentSessionId});
    const validationLogin = await authenticateLogin({pool, username: "javier-30",
        password: "validation-password-value-for-integration", clientIp: "127.0.0.1",
        clock: () => now, createSessionId: () => validationSessionId});

    assert.equal(currentLogin.kind, "authenticated");
    assert.equal(validationLogin.kind, "authenticated");
    const currentContext = await readSessionContext(currentSessionId);
    const validationContext = await readSessionContext(validationSessionId);
    assert.equal(currentContext.participantKey, "javier");
    assert.equal(validationContext.participantKey, "javier");
    assert.notEqual(currentContext.studyId, validationContext.studyId);

    await resetParticipantCredential({pool, studyKey: "pr-card-sorting-validation-30",
        participantKey: "javier", password: "replacement-password-value-for-integration"});
    assert.equal((await readSessionContext(validationSessionId)), null);
    assert.deepEqual(await readSessionContext(currentSessionId), currentContext);
    const {rows: versions} = await pool.query(
        `SELECT study.study_key, account.credential_version
         FROM participant_account account
         INNER JOIN study ON study.id = account.study_id
         WHERE account.normalized_username IN ('javier', 'javier-30')
         ORDER BY study.study_key`,
    );
    assert.deepEqual(versions, [
        {study_key: "pr-card-sorting-local", credential_version: 1},
        {study_key: "pr-card-sorting-validation-30", credential_version: 2},
    ]);

    const logout = await logoutThroughHttp(currentSessionId);
    assert.equal(logout.status, 302);
    assert.equal(logout.headers.get("location"), "/login");
    assert.match(logout.headers.get("set-cookie") || "", /^__Host-session=; Path=\/; Expires=/);
    assert.equal((await readSessionContext(currentSessionId)), null);
});
