import assert from "node:assert/strict";
import {randomBytes, randomUUID} from "node:crypto";
import {afterEach, beforeEach, test} from "node:test";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {fingerprintPersistentStudy} from "./support/study-state-fingerprint.js";
import {closeCopilot369Database, seedHistoricalCopilot369Studies, startCopilot369Database} from "./support/copilot-369-fixture.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const studyKey = "pr-card-sorting-validation-30";
const sourceArtifacts = [
    path.join(root, "plans/validation-30-cards.csv"),
    path.join(root, "plans/validation-30-cards.manifest.json"),
];
let database;
let validationStudyId;

const fingerprint = () => fingerprintPersistentStudy({pool: database.pool, studyKey, artifactPaths: sourceArtifacts});

beforeEach(async () => {
    database = await startCopilot369Database();
    const studies = await seedHistoricalCopilot369Studies({pool: database.pool});
    validationStudyId = studies.validationStudyId;
});

afterEach(async () => {
    if (database) await closeCopilot369Database(database);
});

test("Given the complete persistent validation study When it is fingerprinted repeatedly Then the digest is stable and opaque", async () => {
    const first = await fingerprint();
    const second = await fingerprint();

    assert.match(first, /^[a-f0-9]{64}$/);
    assert.equal(second, first);
});

test("Given a persistent account hash, version, and timestamp When any changes Then the study fingerprint changes", async () => {
    const before = await fingerprint();
    await database.pool.query(
        `UPDATE participant_account SET password_hash = $1, credential_version = credential_version + 1,
             updated_at = updated_at + INTERVAL '1 second'
         WHERE study_id = $2 AND normalized_username = 'javier-30'`,
        [`synthetic-account-revision-${randomUUID()}`, validationStudyId],
    );

    assert.notEqual(await fingerprint(), before);
});

test("Given authentication-only state When sessions, CSRF contexts, or IP throttles change Then the persistent study fingerprint stays equal", async () => {
    const before = await fingerprint();
    const {rows: [account]} = await database.pool.query(
        "SELECT id, reviewer_id, credential_version FROM participant_account WHERE study_id = $1 AND normalized_username = 'javier-30'",
        [validationStudyId],
    );
    const sessionId = randomBytes(32).toString("base64url");
    await database.pool.query(
        `INSERT INTO app_session(session_id, account_id, study_id, reviewer_id, credential_version, csrf_token,
            expires_at, absolute_expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW() + INTERVAL '1 hour', NOW() + INTERVAL '2 hours')`,
        [sessionId, account.id, validationStudyId, account.reviewer_id, account.credential_version, randomBytes(32).toString("base64url")],
    );
    await database.pool.query(
        "INSERT INTO login_csrf_context(context_id, token, expires_at) VALUES ($1, $2, NOW() + INTERVAL '5 minutes')",
        [randomUUID(), randomBytes(32).toString("base64url")],
    );
    await database.pool.query(
        "INSERT INTO login_ip_attempt(ip_address, attempt_count, window_started_at) VALUES ('192.0.2.17', 1, NOW())",
    );

    assert.equal(await fingerprint(), before);
});
