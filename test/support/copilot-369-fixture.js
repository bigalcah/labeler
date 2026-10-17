import assert from "node:assert/strict";
import {createHash, randomUUID} from "node:crypto";
import {spawnSync} from "node:child_process";
import {readFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {isDeepStrictEqual} from "node:util";
import pg from "pg";
import {readPullRequestCards} from "../../util/csv-pr-provider.js";
import {canonicalCardContent, computeCardChecksum} from "../../util/pr-card-checksum.js";
import {runStudyMigrations} from "../../util/study-schema.js";

const {Pool} = pg;
const REPOSITORY_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const PRIMARY_CSV_PATH = path.join(REPOSITORY_ROOT, "plans/merged_after_rework_cards_seed_20260510.csv");
const VALIDATION_CSV_PATH = path.join(REPOSITORY_ROOT, "plans/validation-30-cards.csv");
const VALIDATION_MANIFEST_PATH = path.join(REPOSITORY_ROOT, "plans/validation-30-cards.manifest.json");
const PRIMARY_CSV_CHECKSUM = "4051c10c39a1634aa80d9018aa53b59fd6009fdc4d7f2526d5e73708b02f53ef";
const VALIDATION_CSV_CHECKSUM = "1607cfe84cb687a2cc7b4c56d3e0abf106b1a1044810d7390663ef1d691b63ab";
const PARTICIPANTS = ["javier", "diego", "pablo"];
const FIXTURE_TIMESTAMP = "2026-10-15T12:00:00.000Z";

const docker = argumentsList => {
    const result = spawnSync("docker", argumentsList, {encoding: "utf8"});
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    return result.stdout.trim();
};

const startCopilot369Database = async ({throughMigration = "014_copilot_369_cardinality"} = {}) => {
    const containerName = `labeler-copilot-369-${randomUUID()}`;
    let pool;
    try {
        docker(["run", "--detach", "--name", containerName, "--tmpfs",
            "/var/lib/postgresql/data:rw,nosuid,nodev", "--publish", "127.0.0.1::5432",
            "--env", "POSTGRES_HOST_AUTH_METHOD=trust", "--env", "POSTGRES_USER=labeler_test",
            "--env", "POSTGRES_DB=labeler_test", "postgres:17.6-alpine"]);
        const endpoint = docker(["port", containerName, "5432/tcp"]);
        pool = new Pool({host: "127.0.0.1", port: Number(endpoint.slice(endpoint.lastIndexOf(":") + 1)),
            user: "labeler_test", database: "labeler_test", password: "copilot369-isolated-test-only",
            connectionTimeoutMillis: 2_000});
        for (let attempt = 0; attempt < 60; attempt += 1) {
            try {
                await pool.query("SELECT 1");
                break;
            } catch (error) {
                if (attempt === 59) throw error;
                await new Promise(resolve => setTimeout(resolve, 250));
            }
        }
        await runStudyMigrations(pool, throughMigration);
        return {containerName, pool};
    } catch (error) {
        if (pool) await pool.end();
        spawnSync("docker", ["rm", "--force", containerName], {encoding: "utf8"});
        throw error;
    }
};

const closeCopilot369Database = async ({containerName, pool}) => {
    await pool.end();
    docker(["rm", "--force", containerName]);
};

const syntheticAccountManifest = (studyKey, suffix) => ({
    manifestVersion: 1,
    studyKey,
    accounts: PARTICIPANTS.map((participantKey, index) => ({
        participantKey,
        role: "participant",
        normalizedUsername: `${participantKey}${suffix}`,
        passwordHash: `synthetic-argon2id$${createHash("sha256").update(`${studyKey}\0${participantKey}`).digest("hex")}`,
        credentialVersion: index + 1,
    })),
});

const studyConfig = (studyKey, expectedCardCount, accounts) => ({
    studyKey,
    expectedCardCount,
    participants: PARTICIPANTS,
    loginUsernames: Object.fromEntries(accounts.map(account => [account.participantKey, account.normalizedUsername])),
});

const seedCards = async (client, cards, sourceChecksum) => {
    const records = cards.map(card => ({...canonicalCardContent(card), source_checksum: sourceChecksum, content_checksum: computeCardChecksum(card)}));
    await client.query(
        `INSERT INTO pr_cards(
            source_card_id, source_pr_id, repository, pr_number, title, body, author, language, state, merged,
            html_url, created_at_source, closed_at_source, merged_at_source, summary, evidence, raw_payload,
            source_type, source_checksum, content_checksum
        )
        SELECT source_card_id, source_pr_id, repository, pr_number, title, body, author,
            language, state, merged, html_url, created_at_source, closed_at_source, merged_at_source,
            summary, evidence, raw_payload, source_type, source_checksum, content_checksum
        FROM jsonb_to_recordset($1::jsonb) AS card(
            source_card_id TEXT, source_pr_id TEXT, repository TEXT, pr_number INTEGER, title TEXT,
            body TEXT, author TEXT, language TEXT, state TEXT, merged BOOLEAN, html_url TEXT,
            created_at_source TEXT, closed_at_source TEXT, merged_at_source TEXT, summary JSONB,
            evidence JSONB, raw_payload JSONB, source_type TEXT, source_checksum TEXT, content_checksum TEXT
        )`,
        [JSON.stringify(records)],
    );
};

const insertStudy = async (client, {studyKey, expectedCardCount, sourceChecksum, accounts}) => {
    const {rows: [study]} = await client.query(
        `INSERT INTO study(study_key, config, source_checksum, expected_card_count, bootstrap_state, created_at, updated_at)
         VALUES ($1, $2::jsonb, $3, $4, 'READY', $5, $5)
         RETURNING id`,
        [studyKey, JSON.stringify(studyConfig(studyKey, expectedCardCount, accounts)), sourceChecksum, expectedCardCount, FIXTURE_TIMESTAMP],
    );
    await client.query(
        `INSERT INTO study_participant(study_id, reviewer_id, participant_key, ordinal, created_at)
         SELECT $1, reviewer.id, participant.participant_key, participant.ordinality - 1, $3
         FROM unnest($2::text[]) WITH ORDINALITY AS participant(participant_key, ordinality)
         JOIN reviewer ON reviewer.name = participant.participant_key`,
        [study.id, PARTICIPANTS, FIXTURE_TIMESTAMP],
    );
    await client.query(
        `INSERT INTO participant_account(study_id, reviewer_id, normalized_username, password_hash, credential_version, created_at, updated_at)
         SELECT $1, reviewer.id, account.normalized_username, account.password_hash, account.credential_version, $3, $3
         FROM jsonb_to_recordset($2::jsonb) AS account(participant_key TEXT, normalized_username TEXT, password_hash TEXT, credential_version INTEGER)
         JOIN reviewer ON reviewer.name = account.participant_key`,
        [study.id, JSON.stringify(accounts.map(account => ({
            participant_key: account.participantKey,
            normalized_username: account.normalizedUsername,
            password_hash: account.passwordHash,
            credential_version: account.credentialVersion,
        }))), FIXTURE_TIMESTAMP],
    );
    return study.id;
};

const seedStudyCards = async (client, {studyId, cards}) => {
    await client.query(
        `INSERT INTO study_card(study_id, pr_card_id, source_card_id, ordinal, source_checksum)
         SELECT $1, pr_cards.id, member.source_card_id, member.ordinality - 1, pr_cards.content_checksum
         FROM unnest($2::text[]) WITH ORDINALITY AS member(source_card_id, ordinality)
         JOIN pr_cards ON pr_cards.source_card_id = member.source_card_id`,
        [studyId, cards.map(card => card.source_card_id)],
    );
};

const seedProtectedValidationState = async (client, studyId) => {
    await client.query(
        `INSERT INTO participant_category(study_id, participant_id, raw_name, normalized_name, definition, color_slot, created_at, updated_at)
         SELECT $1, participant.reviewer_id, 'Synthetic category ' || participant.ordinal,
            'synthetic-category-' || participant.ordinal, 'Fixture-only category', participant.ordinal, $2, $2
         FROM study_participant participant WHERE participant.study_id = $1`,
        [studyId, FIXTURE_TIMESTAMP],
    );
    await client.query(
        `INSERT INTO pr_classification(pr_card_id, participant_id, category_id, remarks, classified_at, updated_at, study_id)
         SELECT card.pr_card_id, participant.reviewer_id, category.id, 'synthetic protected decision', $2, $2, $1
         FROM study_card card
         JOIN study_participant participant ON participant.study_id = card.study_id AND participant.ordinal = 0
         JOIN participant_category category ON category.study_id = participant.study_id AND category.participant_id = participant.reviewer_id
         WHERE card.study_id = $1 AND card.ordinal = 0`,
        [studyId, FIXTURE_TIMESTAMP],
    );
    await client.query(
        `INSERT INTO pr_discard(pr_card_id, participant_id, reason, discarded_at, study_id)
         SELECT card.pr_card_id, participant.reviewer_id, 'synthetic protected discard', $2, $1
         FROM study_card card
         JOIN study_participant participant ON participant.study_id = card.study_id AND participant.ordinal = 1
         WHERE card.study_id = $1 AND card.ordinal = 1`,
        [studyId, FIXTURE_TIMESTAMP],
    );
    await client.query(
        `INSERT INTO github_card_snapshot(pr_card_id, snapshot_checksum, normalizer_version, manifest, created_at)
         SELECT card.pr_card_id, 'synthetic-snapshot-' || card.source_card_id, 'fixture-v1',
            jsonb_build_object('source_card_id', card.source_card_id, 'fixture', true), $2
         FROM study_card card WHERE card.study_id = $1`,
        [studyId, FIXTURE_TIMESTAMP],
    );
};

const seedHistoricalCopilot369Studies = async ({pool}) => {
    const [primaryResult, validationResult, validationManifestBytes] = await Promise.all([
        readPullRequestCards(PRIMARY_CSV_PATH, {expectedCardCount: 300}),
        readPullRequestCards(VALIDATION_CSV_PATH, {expectedCardCount: 30}),
        readFile(VALIDATION_MANIFEST_PATH),
    ]);
    assert.deepEqual(primaryResult.errors, []);
    assert.deepEqual(validationResult.errors, []);
    assert.equal(primaryResult.sourceChecksum, PRIMARY_CSV_CHECKSUM);
    assert.equal(validationResult.sourceChecksum, VALIDATION_CSV_CHECKSUM);
    const validationManifest = JSON.parse(validationManifestBytes.toString("utf8"));
    assert.equal(validationManifest.source.sha256, primaryResult.sourceChecksum);
    assert.equal(validationManifest.subset.sha256, validationResult.sourceChecksum);
    assert.deepEqual(validationResult.cards.map(card => card.source_card_id), validationManifest.orderedCardIds);
    const primaryCardsById = new Map(primaryResult.cards.map(card => [card.source_card_id, card]));
    for (const validationCard of validationResult.cards) {
        assert.ok(isDeepStrictEqual(canonicalCardContent(primaryCardsById.get(validationCard.source_card_id)),
            canonicalCardContent(validationCard)), `Protected card ${validationCard.source_card_id} differs from the historical primary CSV`);
    }

    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        await client.query("INSERT INTO reviewer(name) SELECT unnest($1::text[])", [PARTICIPANTS]);
        await seedCards(client, primaryResult.cards, primaryResult.sourceChecksum);
        const primaryAccounts = syntheticAccountManifest("pr-card-sorting-local", "").accounts;
        const validationAccounts = syntheticAccountManifest("pr-card-sorting-validation-30", "-30").accounts;
        const primaryStudyId = await insertStudy(client, {studyKey: "pr-card-sorting-local", expectedCardCount: 300,
            sourceChecksum: primaryResult.sourceChecksum, accounts: primaryAccounts});
        const validationStudyId = await insertStudy(client, {studyKey: "pr-card-sorting-validation-30", expectedCardCount: 30,
            sourceChecksum: validationResult.sourceChecksum, accounts: validationAccounts});
        await seedStudyCards(client, {studyId: primaryStudyId, cards: primaryResult.cards});
        await seedStudyCards(client, {studyId: validationStudyId, cards: validationResult.cards});
        await seedProtectedValidationState(client, validationStudyId);
        await client.query("COMMIT");
        return {primaryStudyId, validationStudyId};
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
};

const fingerprintProtectedCopilot369State = async (pool, studyId) => {
    const {rows: [row]} = await pool.query(
        `SELECT jsonb_build_object(
            'study', (SELECT to_jsonb(study) FROM study WHERE id = $1),
            'reviewers', (SELECT COALESCE(jsonb_agg(to_jsonb(reviewer) ORDER BY reviewer.id), '[]'::jsonb) FROM reviewer JOIN study_participant participant ON participant.reviewer_id = reviewer.id WHERE participant.study_id = $1),
            'participants', (SELECT COALESCE(jsonb_agg(to_jsonb(participant) ORDER BY participant.ordinal), '[]'::jsonb) FROM study_participant participant WHERE participant.study_id = $1),
            'accounts', (SELECT COALESCE(jsonb_agg(to_jsonb(account) ORDER BY account.reviewer_id), '[]'::jsonb) FROM participant_account account WHERE account.study_id = $1),
            'memberships', (SELECT COALESCE(jsonb_agg(to_jsonb(member) ORDER BY member.ordinal), '[]'::jsonb) FROM study_card member WHERE member.study_id = $1),
            'sharedCards', (SELECT COALESCE(jsonb_agg(to_jsonb(card) ORDER BY card.source_card_id), '[]'::jsonb) FROM pr_cards card JOIN study_card member ON member.pr_card_id = card.id WHERE member.study_id = $1),
            'snapshots', (SELECT COALESCE(jsonb_agg(to_jsonb(snapshot) ORDER BY snapshot.pr_card_id, snapshot.id), '[]'::jsonb) FROM github_card_snapshot snapshot JOIN study_card member ON member.pr_card_id = snapshot.pr_card_id WHERE member.study_id = $1),
            'runs', (SELECT COALESCE(jsonb_agg(to_jsonb(run) ORDER BY run.id), '[]'::jsonb) FROM github_enrichment_run run WHERE run.study_id = $1),
            'runPages', (SELECT COALESCE(jsonb_agg(to_jsonb(page) ORDER BY page.run_id, page.pr_card_id, page.endpoint, page.page_ordinal), '[]'::jsonb) FROM github_run_page page WHERE page.study_id = $1),
            'runCards', (SELECT COALESCE(jsonb_agg(to_jsonb(mapping) ORDER BY mapping.run_id, mapping.pr_card_id), '[]'::jsonb) FROM github_enrichment_run_card mapping WHERE mapping.study_id = $1),
            'promotions', (SELECT COALESCE(jsonb_agg(to_jsonb(promotion) ORDER BY promotion.study_id), '[]'::jsonb) FROM study_enrichment_promotion promotion WHERE promotion.study_id = $1),
            'classifications', (SELECT COALESCE(jsonb_agg(to_jsonb(classification) ORDER BY classification.pr_card_id, classification.participant_id), '[]'::jsonb) FROM pr_classification classification WHERE classification.study_id = $1),
            'discards', (SELECT COALESCE(jsonb_agg(to_jsonb(discard) ORDER BY discard.pr_card_id, discard.participant_id), '[]'::jsonb) FROM pr_discard discard WHERE discard.study_id = $1),
            'categories', (SELECT COALESCE(jsonb_agg(to_jsonb(category) ORDER BY category.participant_id, category.id), '[]'::jsonb) FROM participant_category category WHERE category.study_id = $1),
            'telemetry', (SELECT COALESCE(jsonb_agg(to_jsonb(event) ORDER BY event.recorded_at, event.event_id), '[]'::jsonb) FROM github_api_telemetry_event event WHERE event.study_id = $1)
        ) AS state`,
        [studyId],
    );
    const [primaryCsv, validationCsv, validationManifestBytes] = await Promise.all([
        readFile(PRIMARY_CSV_PATH), readFile(VALIDATION_CSV_PATH), readFile(VALIDATION_MANIFEST_PATH),
    ]);
    const accounts = syntheticAccountManifest("pr-card-sorting-validation-30", "-30");
    const artifacts = {
        primaryCsvSha256: createHash("sha256").update(primaryCsv).digest("hex"),
        validationCsvSha256: createHash("sha256").update(validationCsv).digest("hex"),
        validationManifestSha256: createHash("sha256").update(validationManifestBytes).digest("hex"),
        syntheticAccountManifest: accounts,
    };
    const fingerprint = createHash("sha256").update(JSON.stringify({state: row.state, artifacts})).digest("hex");
    return {fingerprint, state: row.state, artifacts};
};

export {
    closeCopilot369Database,
    fingerprintProtectedCopilot369State,
    seedHistoricalCopilot369Studies,
    startCopilot369Database,
};
