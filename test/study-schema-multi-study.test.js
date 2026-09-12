import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {randomBytes, randomUUID} from "node:crypto";
import {readFile} from "node:fs/promises";
import {after, before, test} from "node:test";
import pg from "pg";
import {createPasswordHash} from "../util/credential-policy.js";
import {StudyBootstrapConflictError, bootstrapStudy} from "../util/study-bootstrap.js";
import {DEFAULT_STUDY_CONFIG, StudyConfigError, parseStudyConfig} from "../util/study-config.js";
import {managedMigrations, runStudyMigrations} from "../util/study-schema.js";

const {Pool} = pg;
const containerName = `labeler-study-schema-${randomUUID()}`;
const password = randomBytes(24).toString("base64url");
const currentStudyKey = "pr-card-sorting-local";
const validationStudyKey = "pr-card-sorting-validation-30";
let pool;

const docker = argumentsList => {
    const result = spawnSync("docker", argumentsList, {encoding: "utf8"});
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    return result.stdout.trim();
};

const fingerprintCurrentStudy = async () => {
    const {rows: [row]} = await pool.query(
        `SELECT json_build_object(
             'study', (SELECT json_build_object('id', id, 'key', study_key, 'config', config,
                 'source_checksum', source_checksum, 'expected_card_count', expected_card_count,
                 'bootstrap_state', bootstrap_state) FROM study WHERE study_key = $1),
             'memberships', (SELECT json_build_object('count', COUNT(*),
                 'digest', md5(string_agg(source_card_id || ':' || source_checksum, ',' ORDER BY ordinal)))
                 FROM study_card WHERE study_id = (SELECT id FROM study WHERE study_key = $1)),
             'decisions', (SELECT md5(string_agg(kind || ':' || value, ',' ORDER BY kind, value)) FROM (
                 SELECT 'classification' AS kind, pr_card_id::text || ':' || participant_id || ':' || remarks AS value
                 FROM pr_classification WHERE study_id = (SELECT id FROM study WHERE study_key = $1)
                 UNION ALL
                 SELECT 'discard', pr_card_id::text || ':' || participant_id || ':' || COALESCE(reason, '')
                 FROM pr_discard WHERE study_id = (SELECT id FROM study WHERE study_key = $1)
             ) terminal),
             'categories', (SELECT md5(string_agg(id::text || ':' || participant_id || ':' || raw_name,
                 ',' ORDER BY id)) FROM participant_category
                 WHERE study_id = (SELECT id FROM study WHERE study_key = $1)),
             'accounts', (SELECT md5(string_agg(normalized_username || ':' || credential_version || ':' || md5(password_hash),
                 ',' ORDER BY normalized_username)) FROM participant_account
                 WHERE study_id = (SELECT id FROM study WHERE study_key = $1)),
             'promotion', (SELECT md5(run_id::text || ':' || source_checksum || ':' || promoted_at::text)
                 FROM study_enrichment_promotion WHERE study_id = (SELECT id FROM study WHERE study_key = $1))
         ) AS fingerprint`,
        [currentStudyKey],
    );
    return row.fingerprint;
};

const seedCurrentStudy = () => pool.query(
    `INSERT INTO study(study_key, config, source_checksum, expected_card_count, bootstrap_state)
     VALUES ('pr-card-sorting-local',
       '{"studyKey":"pr-card-sorting-local","expectedCardCount":300,"participants":["javier","diego","pablo"]}',
       'current-source-checksum', 300, 'READY');
     INSERT INTO reviewer(name) VALUES ('javier'), ('diego'), ('pablo');
     INSERT INTO study_participant(study_id, reviewer_id, participant_key, ordinal)
     SELECT study.id, reviewer.id, reviewer.name, participant.ordinal
     FROM study CROSS JOIN (VALUES ('javier', 0), ('diego', 1), ('pablo', 2)) participant(name, ordinal)
     JOIN reviewer ON reviewer.name = participant.name
     WHERE study.study_key = 'pr-card-sorting-local';
     INSERT INTO pr_cards(source_card_id, title, raw_payload, source_checksum, content_checksum)
     SELECT 'card-' || ordinal, 'Card ' || ordinal, jsonb_build_object('card_id', 'card-' || ordinal),
       'current-source-checksum', 'content-' || ordinal
     FROM generate_series(0, 299) ordinal;
     INSERT INTO study_card(study_id, pr_card_id, source_card_id, ordinal, source_checksum)
     SELECT study.id, card.id, card.source_card_id,
       substring(card.source_card_id FROM 6)::integer, card.content_checksum
     FROM study JOIN pr_cards card ON TRUE WHERE study.study_key = 'pr-card-sorting-local';
     INSERT INTO github_enrichment_run(id, study_id, source_checksum, config_fingerprint, normalizer_version, state)
     SELECT '10000000-0000-0000-0000-000000000001', id, source_checksum, 'config-v1', 'normalizer-v1', 'RUNNING'
     FROM study WHERE study_key = 'pr-card-sorting-local';
     INSERT INTO github_card_snapshot(pr_card_id, snapshot_checksum, normalizer_version, manifest)
     SELECT pr_card_id, 'snapshot-' || ordinal, 'normalizer-v1', '{}'::jsonb
     FROM study_card WHERE study_id = (SELECT id FROM study WHERE study_key = 'pr-card-sorting-local');
     INSERT INTO github_enrichment_run_card(run_id, study_id, pr_card_id, snapshot_id, snapshot_checksum, ordinal)
     SELECT run.id, run.study_id, membership.pr_card_id, snapshot.id, snapshot.snapshot_checksum, membership.ordinal
     FROM github_enrichment_run run
     JOIN study_card membership ON membership.study_id = run.study_id
     JOIN github_card_snapshot snapshot ON snapshot.pr_card_id = membership.pr_card_id
     WHERE run.id = '10000000-0000-0000-0000-000000000001';
     UPDATE github_enrichment_run SET state = 'COMPLETED', manifest_checksum = 'manifest-v1'
     WHERE id = '10000000-0000-0000-0000-000000000001';
     INSERT INTO study_enrichment_promotion(study_id, run_id, source_checksum, promoted_at)
     SELECT id, '10000000-0000-0000-0000-000000000001', source_checksum, '2026-01-01T00:00:00Z'
     FROM study WHERE study_key = 'pr-card-sorting-local';
     INSERT INTO participant_account(study_id, reviewer_id, normalized_username, password_hash, credential_version)
     SELECT participant.study_id, participant.reviewer_id, participant.participant_key,
       'sanitized-test-hash-' || participant.ordinal, participant.ordinal + 2
     FROM study_participant participant
     WHERE participant.study_id = (SELECT id FROM study WHERE study_key = 'pr-card-sorting-local');
     INSERT INTO participant_category(id, study_id, participant_id, raw_name, normalized_name)
     SELECT '20000000-0000-0000-0000-000000000001', participant.study_id, participant.reviewer_id,
       'Preserved category', 'preserved category'
     FROM study_participant participant
     WHERE participant.study_id = (SELECT id FROM study WHERE study_key = 'pr-card-sorting-local')
       AND participant.ordinal = 0;
     INSERT INTO pr_classification(pr_card_id, participant_id, category_id, remarks, study_id)
     SELECT card.pr_card_id, participant.reviewer_id, '20000000-0000-0000-0000-000000000001',
       'preserved classification', participant.study_id
     FROM study_participant participant JOIN study_card card ON card.study_id = participant.study_id
     WHERE participant.ordinal = 0 AND card.ordinal = 0;
     INSERT INTO pr_discard(pr_card_id, participant_id, reason, study_id)
     SELECT card.pr_card_id, participant.reviewer_id, 'preserved discard', participant.study_id
     FROM study_participant participant JOIN study_card card ON card.study_id = participant.study_id
     WHERE participant.ordinal = 1 AND card.ordinal = 1;`,
);

const assertRejectedCountRollsBack = async count => {
    const client = await pool.connect();
    const stagedKey = `staged-before-${count}`;
    try {
        await client.query("BEGIN");
        await client.query(
            `INSERT INTO study(study_key, config, source_checksum, expected_card_count)
             VALUES ($1, $2, 'staged-checksum', 30)`,
            [stagedKey, {studyKey: stagedKey, expectedCardCount: 30, participants: ["javier"]}],
        );
        await assert.rejects(
            () => client.query(
                `INSERT INTO study(study_key, config, source_checksum, expected_card_count)
                 VALUES ($1, $2, 'invalid-checksum', $3)`,
                [`invalid-${count}`, {studyKey: `invalid-${count}`, expectedCardCount: count, participants: ["javier"]}, count],
            ),
            error => error.code === "23514" && error.constraint === "study_expected_card_count_check",
        );
    } finally {
        await client.query("ROLLBACK");
        client.release();
    }
    const {rows: [result]} = await pool.query(
        "SELECT COUNT(*)::integer AS count FROM study WHERE study_key = ANY($1::text[])",
        [[stagedKey, `invalid-${count}`]],
    );
    assert.equal(result.count, 0);
};

before(async () => {
    docker(["run", "--rm", "--detach", "--name", containerName, "--tmpfs",
        "/var/lib/postgresql/data:rw,nosuid,nodev", "--publish", "127.0.0.1::5432",
        "--env", "POSTGRES_USER=labeler_test", "--env", `POSTGRES_PASSWORD=${password}`,
        "--env", "POSTGRES_DB=labeler_test", "postgres:17.6-alpine"]);
    const endpoint = docker(["port", containerName, "5432/tcp"]);
    pool = new Pool({host: "127.0.0.1", port: Number(endpoint.slice(endpoint.lastIndexOf(":") + 1)),
        user: "labeler_test", password, database: "labeler_test"});
    for (let attempt = 0; attempt < 60; attempt += 1) {
        try {
            await pool.query("SELECT 1");
            return;
        } catch (_error) {
            await new Promise(resolve => setTimeout(resolve, 250));
        }
    }
    throw new Error("PostgreSQL test container did not become ready");
});

after(async () => {
    if (pool) await pool.end();
    spawnSync("docker", ["rm", "--force", containerName], {encoding: "utf8"});
});

test("Given migration 011 When migration 012 is inspected Then it preflights before global username uniqueness", async () => {
    const migration = await readFile(new URL("../schema/migrations/011_multi_study_cardinality.sql", import.meta.url), "utf8");
    const usernameMigration = await readFile(new URL("../schema/migrations/012_global_normalized_username.sql", import.meta.url), "utf8");
    assert.deepEqual(managedMigrations.slice(-3).map(item => item.id), [
        "010_study_scoped_participant_categories", "011_multi_study_cardinality", "012_global_normalized_username",
    ]);
    assert.match(migration, /^BEGIN;/);
    assert.match(migration, /DROP INDEX IF EXISTS "study_ready_uidx"/);
    assert.match(migration, /CREATE INDEX IF NOT EXISTS "study_ready_idx"/);
    assert.doesNotMatch(migration, /CREATE UNIQUE INDEX[^;]*study_ready_idx/);
    assert.match(migration, /CHECK \("expected_card_count" IN \(30, 300\)\)/);
    assert.match(migration, /010_study_scoped_participant_categories must be applied before 011_multi_study_cardinality/);
    assert.doesNotMatch(migration, /\bACTIVE\b|\b(?:DELETE|TRUNCATE|DROP TABLE|DROP COLUMN|DROP VIEW|DROP TYPE)\b/i);
    assert.match(migration, /COMMIT;\s*$/);
    assert.match(usernameMigration, /^BEGIN;/);
    assert.match(usernameMigration, /GROUP BY "normalized_username"[\s\S]*HAVING COUNT\(\*\) > 1/);
    assert.match(usernameMigration, /CREATE UNIQUE INDEX "participant_account_normalized_username_uidx"/);
    assert.ok(usernameMigration.indexOf("HAVING COUNT(*) > 1")
        < usernameMigration.indexOf("CREATE UNIQUE INDEX \"participant_account_normalized_username_uidx\""));
    assert.match(usernameMigration, /011_multi_study_cardinality must be applied before 012_global_normalized_username/);
    assert.doesNotMatch(usernameMigration, /\b(?:UPDATE|DELETE|TRUNCATE|DROP|ALTER)\b/i);
    assert.match(usernameMigration, /COMMIT;\s*$/);
});

test("Given study configuration When cardinality is parsed Then only 30 and 300 are accepted", () => {
    assert.equal(parseStudyConfig({...DEFAULT_STUDY_CONFIG, expectedCardCount: 30}).expectedCardCount, 30);
    assert.equal(parseStudyConfig(DEFAULT_STUDY_CONFIG).expectedCardCount, 300);
    for (const expectedCardCount of [10, 301]) {
        assert.throws(
            () => parseStudyConfig({...DEFAULT_STUDY_CONFIG, expectedCardCount}),
            StudyConfigError,
        );
    }
});

test("Given duplicate cross-study usernames When migration 012 runs Then it fails without mutation before global uniqueness", async () => {
    await runStudyMigrations(pool, "010_study_scoped_participant_categories");
    await seedCurrentStudy();
    const originalFingerprint = await fingerprintCurrentStudy();

    await Promise.all([
        runStudyMigrations(pool, "011_multi_study_cardinality"),
        runStudyMigrations(pool, "011_multi_study_cardinality"),
    ]);
    assert.deepEqual(await fingerprintCurrentStudy(), originalFingerprint);

    await pool.query(
        `INSERT INTO study(study_key, config, source_checksum, expected_card_count, bootstrap_state)
         VALUES ($1, $2, 'validation-source-checksum', 30, 'READY')`,
        [validationStudyKey, {studyKey: validationStudyKey, expectedCardCount: 30, participants: ["javier", "diego", "pablo"]}],
    );
    await pool.query(
        `INSERT INTO study_participant(study_id, reviewer_id, participant_key, ordinal)
         SELECT study.id, reviewer.id, participant.name, participant.ordinal
         FROM study
         CROSS JOIN (VALUES ('javier', 0), ('diego', 1), ('pablo', 2)) participant(name, ordinal)
         INNER JOIN reviewer ON reviewer.name = participant.name
         WHERE study.study_key = $1`,
        [validationStudyKey],
    );
    await pool.query(
        `INSERT INTO participant_account(study_id, reviewer_id, normalized_username, password_hash)
         SELECT participant.study_id, participant.reviewer_id, participant.participant_key, 'sanitized-duplicate-fixture'
         FROM study_participant participant
         WHERE participant.study_id = (SELECT id FROM study WHERE study_key = $1)
           AND participant.participant_key = 'javier'`,
        [validationStudyKey],
    );
    const {rows: duplicateAccountsBefore} = await pool.query(
        `SELECT study_id, reviewer_id, normalized_username, password_hash, credential_version
         FROM participant_account
         WHERE normalized_username = 'javier'
         ORDER BY study_id`,
    );

    await assert.rejects(
        () => runStudyMigrations(pool),
        /Duplicate normalized usernames prevent global uniqueness/,
    );

    const {rows: duplicateAccountsAfter} = await pool.query(
        `SELECT study_id, reviewer_id, normalized_username, password_hash, credential_version
         FROM participant_account
         WHERE normalized_username = 'javier'
         ORDER BY study_id`,
    );
    const {rows: [failedMigrationState]} = await pool.query(
        `SELECT to_regclass('participant_account_normalized_username_uidx') AS index_name,
                EXISTS (SELECT 1 FROM labeler_migration WHERE migration_id = '012_global_normalized_username') AS recorded`,
    );
    assert.deepEqual(duplicateAccountsAfter, duplicateAccountsBefore);
    assert.deepEqual(failedMigrationState, {index_name: null, recorded: false});

    await pool.query(
        `DELETE FROM participant_account
         WHERE study_id = (SELECT id FROM study WHERE study_key = $1)`,
        [validationStudyKey],
    );
    await Promise.all([runStudyMigrations(pool), runStudyMigrations(pool)]);
    const {rows: [successfulMigrationState]} = await pool.query(
        `SELECT to_regclass('participant_account_normalized_username_uidx')::text AS index_name,
                EXISTS (SELECT 1 FROM labeler_migration WHERE migration_id = '012_global_normalized_username') AS recorded`,
    );
    assert.deepEqual(successfulMigrationState, {
        index_name: "participant_account_normalized_username_uidx",
        recorded: true,
    });

    await pool.query(
        `INSERT INTO participant_account(study_id, reviewer_id, normalized_username, password_hash)
         SELECT participant.study_id, participant.reviewer_id, participant.participant_key || '-30', 'sanitized-validation-fixture'
         FROM study_participant participant
         WHERE participant.study_id = (SELECT id FROM study WHERE study_key = $1)`,
        [validationStudyKey],
    );
    await assert.rejects(
        () => pool.query(
            `UPDATE participant_account
             SET normalized_username = 'javier'
             WHERE study_id = (SELECT id FROM study WHERE study_key = $1)
               AND normalized_username = 'javier-30'`,
            [validationStudyKey],
        ),
        error => error.code === "23505" && error.constraint === "participant_account_normalized_username_uidx",
    );
    const {rows: readyStudies} = await pool.query(
        `SELECT study_key, expected_card_count FROM study
         WHERE bootstrap_state = 'READY' ORDER BY expected_card_count DESC`,
    );
    assert.deepEqual(readyStudies, [
        {study_key: currentStudyKey, expected_card_count: 300},
        {study_key: validationStudyKey, expected_card_count: 30},
    ]);

    const passwordHash = await createPasswordHash(randomBytes(32).toString("base64url"));
    const credentialManifest = {
        manifestVersion: 1,
        studyKey: currentStudyKey,
        accounts: DEFAULT_STUDY_CONFIG.participants.map(participantKey => ({
            participantKey,
            normalizedUsername: participantKey,
            passwordHash,
        })),
    };
    await assert.rejects(
        () => bootstrapStudy({
            pool,
            config: DEFAULT_STUDY_CONFIG,
            cards: Array.from({length: 300}, (_, index) => ({source_card_id: `card-${index}`})),
            sourceChecksum: "changed-source-checksum",
            credentialManifest,
        }),
        error => error instanceof StudyBootstrapConflictError && /Source checksum drift/.test(error.message),
    );
    await assertRejectedCountRollsBack(10);
    await assertRejectedCountRollsBack(301);
    await assert.rejects(
        () => pool.query(
            `INSERT INTO study(study_key, config, source_checksum, expected_card_count)
             VALUES ($1, $2, 'duplicate-checksum', 30)`,
            [currentStudyKey, {studyKey: currentStudyKey, expectedCardCount: 30, participants: ["javier"]}],
        ),
        error => error.code === "23505" && error.constraint === "study_study_key_key",
    );

    assert.deepEqual(await fingerprintCurrentStudy(), originalFingerprint);
    const {rows: [finalState]} = await pool.query(
        `SELECT COUNT(*)::integer AS study_count,
                COUNT(*) FILTER (WHERE bootstrap_state = 'READY')::integer AS ready_count
         FROM study`,
    );
    assert.deepEqual(finalState, {study_count: 2, ready_count: 2});
});
