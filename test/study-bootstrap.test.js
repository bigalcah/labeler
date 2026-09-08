import assert from "node:assert/strict";
import test from "node:test";
import {randomBytes} from "node:crypto";
import {createPasswordHash} from "../util/credential-policy.js";
import {
    bootstrapStudy,
} from "../util/study-bootstrap.js";

const buildCard = (sourceCardId, title = "Card title") => ({
    source_type: "CSV",
    source_card_id: sourceCardId,
    source_pr_id: 42,
    repository: "example/repository",
    pr_number: 7,
    title,
    body: null,
    author: "author",
    language: "JavaScript",
    state: "closed",
    merged: true,
    html_url: "https://github.com/example/repository/pull/7",
    dates: {created_at: null, closed_at: null, merged_at: null},
    summary: {},
    evidence: {},
    raw_payload: {card_id: sourceCardId},
});

const buildBootstrapCards = () => Array.from({length: 300}, (_, index) => buildCard(`card-${index}`, `Title ${index}`));
const buildCredentialManifest = async config => ({
    manifestVersion: 1,
    studyKey: config.studyKey,
    accounts: await Promise.all(config.participants.map(async participantKey => ({
        participantKey,
        normalizedUsername: participantKey,
        passwordHash: await createPasswordHash(randomBytes(32).toString("base64url")),
    }))),
});

const createBootstrapPool = () => {
    const state = {accounts: [], cards: new Map(), study: null, studyCards: [], participants: []};
    let nextCardId = 1;
    let nextParticipantId = 1;
    const query = async (sql, parameters = []) => {
        if (sql.startsWith("SELECT migration_id")) {
            return {rows: [
                {migration_id: "001_study_foundation"},
                {migration_id: "003_private_pr_discard"},
                {migration_id: "004_github_pr_api_enrichment"},
                {migration_id: "005_github_enrichment_checkpoints"},
                {migration_id: "006_github_api_telemetry"},
                {migration_id: "007_local_accounts_sessions"},
            ]};
        }
        if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK"
            || sql.startsWith("SELECT pg_advisory_xact_lock")) return {rows: []};
        if (sql.includes("FROM study\n") && sql.includes("FOR UPDATE")) {
            return {rows: state.study ? [ state.study ] : []};
        }
        if (sql.startsWith("INSERT INTO study(")) {
            state.study = {
                id: "study-id",
                config: parameters[1],
                source_checksum: parameters[2],
                bootstrap_state: "PENDING",
            };
            return {rows: [ state.study ]};
        }
        if (sql.includes("FROM study_participant") && !sql.includes("reviewer_id, participant_key")) {
            return {rows: state.participants};
        }
        if (sql.startsWith("INSERT INTO reviewer")) return {rows: [ {id: nextParticipantId++} ]};
        if (sql.startsWith("INSERT INTO study_participant")) {
            state.participants.push({reviewer_id: parameters[1], participant_key: parameters[2], ordinal: parameters[3]});
            return {rows: []};
        }
        if (sql.includes("FROM study_participant") && sql.includes("reviewer_id, participant_key")) {
            return {rows: state.participants};
        }
        if (sql.startsWith("INSERT INTO participant_account")) {
            if (!state.accounts.some(account => account.reviewer_id === parameters[1])) {
                state.accounts.push({
                    reviewer_id: parameters[1], participant_key: state.participants.find(participant => participant.reviewer_id === parameters[1]).participant_key,
                    normalized_username: parameters[2], password_hash: parameters[3], enabled: true, credential_version: 1,
                });
            }
            return {rows: []};
        }
        if (sql.includes("FROM participant_account account")) return {rows: state.accounts};
        if (sql.startsWith("SELECT id, source_card_id")) {
            return {rows: parameters[0].map(sourceCardId => state.cards.get(sourceCardId)).filter(Boolean)};
        }
        if (sql.startsWith("INSERT INTO pr_cards")) {
            const card = {
                source_card_id: parameters[0], source_pr_id: parameters[1], repository: parameters[2],
                pr_number: parameters[3], title: parameters[4], body: parameters[5], author: parameters[6],
                language: parameters[7], state: parameters[8], merged: parameters[9], html_url: parameters[10],
                created_at_source: parameters[11], closed_at_source: parameters[12], merged_at_source: parameters[13],
                summary: parameters[14], evidence: parameters[15], raw_payload: parameters[16],
                source_type: parameters[17], source_checksum: parameters[18], content_checksum: parameters[19],
                id: `card-id-${nextCardId++}`,
            };
            state.cards.set(card.source_card_id, card);
            return {rows: [ card ]};
        }
        if (sql.startsWith("SELECT source_card_id, source_checksum")) return {rows: state.studyCards};
        if (sql.startsWith("INSERT INTO study_card")) {
            state.studyCards.push({source_card_id: parameters[2], source_checksum: parameters[4], ordinal: parameters[3]});
            return {rows: []};
        }
        if (sql.startsWith("UPDATE study")) {
            state.study.bootstrap_state = "READY";
            return {rows: []};
        }
        throw new Error(`Unexpected fake bootstrap query: ${sql}`);
    };
    return {state, query, connect: async () => ({query, release: () => {}})};
};

test("bootstrap persists exactly 300 cards and reimport preserves membership and checksum", async () => {
    const pool = createBootstrapPool();
    const config = {studyKey: "study-key", expectedCardCount: 300, participants: [ "one", "two", "three" ]};
    const cards = buildBootstrapCards();
    const credentialManifest = await buildCredentialManifest(config);
    await bootstrapStudy({pool, config, cards, sourceChecksum: "csv-checksum", credentialManifest});
    const before = pool.state.studyCards.map(row => ({...row}));
    await bootstrapStudy({pool, config, cards, sourceChecksum: "csv-checksum", credentialManifest});
    assert.equal(pool.state.study.bootstrap_state, "READY");
    assert.equal(pool.state.studyCards.length, 300);
    assert.equal(pool.state.accounts.length, 3);
    assert.deepEqual(pool.state.studyCards, before);
    assert.equal(pool.state.study.source_checksum, "csv-checksum");
});

test("bootstrap rejects membership checksum drift without changing the persisted membership", async () => {
    const pool = createBootstrapPool();
    const config = {studyKey: "study-key", expectedCardCount: 300, participants: [ "one", "two", "three" ]};
    const cards = buildBootstrapCards();
    const credentialManifest = await buildCredentialManifest(config);
    await bootstrapStudy({pool, config, cards, sourceChecksum: "csv-checksum", credentialManifest});
    const before = pool.state.studyCards.map(row => ({...row}));
    pool.state.studyCards[17].source_checksum = "different-checksum";
    await assert.rejects(
        () => bootstrapStudy({pool, config, cards, sourceChecksum: "csv-checksum", credentialManifest}),
        /Card membership drift/,
    );
    assert.equal(pool.state.studyCards.length, 300);
    assert.equal(pool.state.studyCards[17].source_checksum, "different-checksum");
    assert.notDeepEqual(pool.state.studyCards, before);
});
