import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {randomBytes, randomUUID} from "node:crypto";
import {after, before, test} from "node:test";
import pg from "pg";
import {
    createRunningRun,
    finalizeRun,
    markRunFailed,
    persistCheckpoint,
    promoteRun,
    recordRunCard,
    REQUIRED_ENDPOINTS,
    stagePage,
    upsertSnapshot,
} from "../util/github-pr-persistence.js";
import {runStudyMigrations} from "../util/study-schema.js";

const {Pool} = pg;
const containerName = `labeler-github-multi-study-${randomUUID()}`;
const password = randomBytes(24).toString("base64url");
let pool;

const docker = argumentsList => {
    const result = spawnSync("docker", argumentsList, {encoding: "utf8"});
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    return result.stdout.trim();
};

const seedStudy = async expectedCardCount => {
    const studyKey = `github-study-${expectedCardCount}`;
    const sourceChecksum = `source-${expectedCardCount}`;
    const {rows: [study]} = await pool.query(
        `INSERT INTO study(study_key, config, source_checksum, expected_card_count, bootstrap_state)
         VALUES ($1, $2, $3, $4, 'READY')
         RETURNING id, study_key, source_checksum, expected_card_count`,
        [studyKey, {studyKey, expectedCardCount, participants: ["participant"]}, sourceChecksum, expectedCardCount],
    );
    await pool.query(
        `INSERT INTO pr_cards(source_card_id, title, raw_payload, source_checksum, content_checksum, repository, pr_number)
         SELECT $1 || ordinal, 'Card ' || ordinal, jsonb_build_object('card_id', $1 || ordinal),
                $2, 'content-' || $1 || ordinal, 'owner/repository', ordinal + 1
         FROM generate_series(0, $3 - 1) ordinal`,
        [`card-${expectedCardCount}-`, sourceChecksum, expectedCardCount],
    );
    await pool.query(
        `INSERT INTO study_card(study_id, pr_card_id, source_card_id, ordinal, source_checksum)
         SELECT $1, id, source_card_id, substring(source_card_id FROM '[0-9]+$')::integer, content_checksum
         FROM pr_cards WHERE source_checksum = $2`,
        [study.id, sourceChecksum],
    );
    return study;
};

const createRun = study => createRunningRun({
    pool,
    studyId: study.id,
    sourceChecksum: study.source_checksum,
    configFingerprint: `config-${study.expected_card_count}`,
    normalizerVersion: "1",
    expectedCardCount: study.expected_card_count,
});

const persistCompleteEvidence = async (study, run) => {
    for (const card of run.cards) {
        for (const endpoint of REQUIRED_ENDPOINTS) {
            await stagePage(pool, {
                runId: run.id,
                studyId: study.id,
                prCardId: card.pr_card_id,
                endpoint,
                pageOrdinal: 0,
                requestFingerprint: `${card.ordinal}-${endpoint}`,
                apiVersion: "test",
                accept: "application/json",
                state: endpoint === "metadata" ? "COMPLETE" : "COMPLETE_EMPTY",
                normalizedPayload: endpoint === "metadata" ? {title: `Card ${card.ordinal}`} : [],
            });
        }
        const snapshotChecksum = `snapshot-${study.expected_card_count}-${card.ordinal}`;
        const {snapshot} = await upsertSnapshot(pool, {
            prCardId: card.pr_card_id,
            snapshotChecksum,
            normalizerVersion: "1",
            manifest: {pages: []},
        });
        await recordRunCard(pool, {
            runId: run.id,
            studyId: study.id,
            prCardId: card.pr_card_id,
            snapshotId: snapshot.id,
            snapshotChecksum,
            ordinal: card.ordinal,
        });
    }
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
            await runStudyMigrations(pool);
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

test("persisted 30/300 studies enforce scoped completion, pause, failure, and promotion", async () => {
    const study30 = await seedStudy(30);
    const study300 = await seedStudy(300);
    const {rows: [csvOnly]} = await pool.query(
        `SELECT (SELECT COUNT(*)::integer FROM github_enrichment_run) AS run_count,
                (SELECT COUNT(*)::integer FROM study_enrichment_promotion) AS promotion_count`,
    );
    assert.deepEqual(csvOnly, {run_count: 0, promotion_count: 0});

    await assert.rejects(
        () => createRunningRun({pool, studyId: study30.id, sourceChecksum: "wrong", configFingerprint: "x", normalizerVersion: "1", expectedCardCount: 30}),
        error => error.code === "STUDY_CHECKSUM_MISMATCH",
    );
    await assert.rejects(
        () => createRunningRun({pool, studyId: study30.id, sourceChecksum: study30.source_checksum, configFingerprint: "x", normalizerVersion: "1", expectedCardCount: 300}),
        error => error.code === "STUDY_CHECKSUM_MISMATCH",
    );

    const run30 = await createRun(study30);
    await pool.query("UPDATE github_enrichment_run SET attempt_telemetry_version = NULL WHERE id = $1", [run30.id]);
    await assert.rejects(
        () => persistCheckpoint(pool, {
            runId: run30.id,
            studyId: study300.id,
            checkpoint: {cardOrdinal: 4},
            quota: {remaining: 0},
        }),
        error => error.code === "RUN_SCOPE_MISMATCH",
    );
    await persistCheckpoint(pool, {
        runId: run30.id,
        studyId: study30.id,
        checkpoint: {cardOrdinal: 4, endpoint: "files", pageOrdinal: 1},
        quota: {remaining: 0, retryAt: Date.now() + 60_000, concurrency: 1},
    });
    const {rows: [paused]} = await pool.query(
        "SELECT study_id, state, checkpoint, next_resume_at IS NOT NULL AS paused FROM github_enrichment_run WHERE id = $1",
        [run30.id],
    );
    assert.equal(paused.study_id, study30.id);
    assert.equal(paused.state, "RUNNING");
    assert.equal(paused.paused, true);
    assert.equal(paused.checkpoint.cardOrdinal, 4);

    await persistCompleteEvidence(study30, run30);
    await pool.query("UPDATE github_enrichment_run SET source_checksum = 'wrong' WHERE id = $1", [run30.id]);
    await assert.rejects(
        () => finalizeRun({pool, runId: run30.id}),
        error => error.code === "STUDY_CHECKSUM_MISMATCH",
    );
    await pool.query("UPDATE github_enrichment_run SET source_checksum = $2 WHERE id = $1", [run30.id, study30.source_checksum]);
    const completed30 = await finalizeRun({pool, runId: run30.id});
    assert.equal(completed30.state, "COMPLETED");
    await assert.rejects(
        () => promoteRun({pool, studyId: study300.id, runId: run30.id, sourceChecksum: study300.source_checksum}),
        error => error.code === "RUN_SCOPE_MISMATCH",
    );
    const promotion30 = await promoteRun({pool, studyId: study30.id, runId: run30.id, sourceChecksum: study30.source_checksum});
    assert.equal(promotion30.study_id, study30.id);

    const run300 = await createRun(study300);
    await pool.query("UPDATE github_enrichment_run SET attempt_telemetry_version = NULL WHERE id = $1", [run300.id]);
    await assert.rejects(
        () => promoteRun({pool, studyId: study300.id, runId: run300.id, sourceChecksum: study300.source_checksum}),
        error => error.code === "RUN_NOT_COMPLETED",
    );
    await assert.rejects(
        () => finalizeRun({pool, runId: run300.id}),
        error => error.code === "REQUIRED_ENDPOINT_INCOMPLETE",
    );
    const failed300 = await markRunFailed(pool, run300.id, study300.id);
    assert.equal(failed300.state, "FAILED");
    const {rows: [promotionCounts]} = await pool.query(
        `SELECT COUNT(*) FILTER (WHERE study_id = $1)::integer AS promoted_30,
                COUNT(*) FILTER (WHERE study_id = $2)::integer AS promoted_300
         FROM study_enrichment_promotion`,
        [study30.id, study300.id],
    );
    assert.deepEqual(promotionCounts, {promoted_30: 1, promoted_300: 0});
});
