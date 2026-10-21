import assert from "node:assert/strict";
import test from "node:test";
import {randomBytes} from "node:crypto";
import {fileURLToPath} from "node:url";
import {createPasswordHash} from "../util/credential-policy.js";
import {COPILOT_369_SOURCE_CHECKSUM, readCopilot369Cards} from "../util/copilot-369-source.js";
import {StudyExistingValidationError} from "../util/study-existing-validation.js";
import {DEFAULT_STUDY_CONFIG} from "../util/study-config.js";
import {managedMigrations} from "../util/study-schema.js";
import {bootstrapStudy} from "../util/study-bootstrap.js";

const {cards} = await readCopilot369Cards(fileURLToPath(new URL("../plans/copilot-369-cards.csv", import.meta.url)));
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
    const state = {accounts: [], cards: new Map(), classifications: [], study: null, studyCards: [], participants: [], reviewers: new Map()};
    const queries = [];
    let nextCardId = 1;
    let nextParticipantId = 1;
    let writeTransactionOpen = false;
    let readyPendingCommit = false;
    const query = async (sql, parameters = []) => {
        queries.push(sql);
        if (sql.startsWith("SELECT migration_id")) {
            return {rows: managedMigrations.map(({id}) => ({migration_id: id}))};
        }
        if (sql === "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY"
            || sql.startsWith("SELECT pg_advisory_xact_lock")) return {rows: []};
        if (sql === "BEGIN") {
            writeTransactionOpen = true;
            return {rows: []};
        }
        if (sql === "COMMIT") {
            if (writeTransactionOpen && readyPendingCommit) state.study.bootstrap_state = "READY";
            writeTransactionOpen = false;
            readyPendingCommit = false;
            return {rows: []};
        }
        if (sql === "ROLLBACK") {
            writeTransactionOpen = false;
            readyPendingCommit = false;
            return {rows: []};
        }
        if (sql.includes("FROM study\n") && sql.includes("FOR UPDATE")) {
            return {rows: state.study ? [ state.study ] : []};
        }
        if (sql.includes("FROM study\n") && sql.includes("WHERE study_key = $1")) {
            return {rows: state.study ? [ state.study ] : []};
        }
        if (sql.startsWith("INSERT INTO study(")) {
            state.study = {
                id: "study-id",
                study_key: parameters[0],
                config: parameters[1],
                source_checksum: parameters[2],
                expected_card_count: parameters[3],
                bootstrap_state: "PENDING",
            };
            return {rows: [ state.study ]};
        }
        if (sql.includes("FROM study_participant participant") && sql.includes("reviewer_name")) {
            return {rows: state.participants.map(participant => {
                const account = state.accounts.find(item => item.reviewer_id === participant.reviewer_id);
                return {
                    participant_key: participant.participant_key,
                    ordinal: participant.ordinal,
                    reviewer_name: state.reviewers.get(participant.reviewer_id)?.name,
                    normalized_username: account?.normalized_username,
                    password_hash: account?.password_hash,
                    enabled: account?.enabled,
                    credential_version: account?.credential_version,
                };
            })};
        }
        if (sql.startsWith("SELECT participant_key, ordinal")) {
            return {rows: state.participants};
        }
        if (sql.startsWith("INSERT INTO reviewer")) {
            const reviewer = {id: nextParticipantId++, name: parameters[0]};
            state.reviewers.set(reviewer.id, reviewer);
            return {rows: [ {id: reviewer.id} ]};
        }
        if (sql.startsWith("INSERT INTO study_participant")) {
            state.participants.push({study_id: parameters[0], reviewer_id: parameters[1], participant_key: parameters[2], ordinal: parameters[3]});
            return {rows: []};
        }
        if (sql.includes("SELECT reviewer_id, participant_key")) {
            return {rows: state.participants};
        }
        if (sql.startsWith("INSERT INTO participant_account")) {
            if (!state.accounts.some(account => account.reviewer_id === parameters[1])) {
                state.accounts.push({
                    study_id: parameters[0], reviewer_id: parameters[1], normalized_username: parameters[2],
                    password_hash: parameters[3], enabled: true, credential_version: 1,
                });
            }
            return {rows: []};
        }
        if (sql.includes("FROM participant_account account")) {
            return {rows: state.accounts.map(account => ({
                ...account,
                participant_key: state.participants.find(participant => participant.reviewer_id === account.reviewer_id).participant_key,
            }))};
        }
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
        if (sql.startsWith("SELECT membership.pr_card_id")) {
            return {rows: state.studyCards.map(membership => ({
                ...state.cards.get(membership.source_card_id),
                pr_card_id: membership.pr_card_id,
                membership_checksum: membership.source_checksum,
                ordinal: membership.ordinal,
            }))};
        }
        if (sql.startsWith("SELECT source_card_id, source_checksum")) return {rows: state.studyCards};
        if (sql.startsWith("INSERT INTO study_card")) {
            state.studyCards.push({
                study_id: parameters[0], pr_card_id: parameters[1], source_card_id: parameters[2],
                ordinal: parameters[3], source_checksum: parameters[4],
            });
            return {rows: []};
        }
        if (sql.startsWith("UPDATE study")) {
            readyPendingCommit = true;
            return {rows: []};
        }
        throw new Error(`Unexpected fake bootstrap query: ${sql}`);
    };
    return {queries, state, query, connect: async () => ({query, release: () => {}})};
};

test("bootstrap persists exactly 369 canonical cards and read-only reimport preserves state", async () => {
    const pool = createBootstrapPool();
    const config = DEFAULT_STUDY_CONFIG;
    const credentialManifest = await buildCredentialManifest(config);
    await bootstrapStudy({pool, config, cards, sourceChecksum: COPILOT_369_SOURCE_CHECKSUM, credentialManifest});
    const before = pool.state.studyCards.map(row => ({...row}));
    pool.state.accounts[0].credential_version = 7;
    pool.state.classifications.push({card_id: "card-id-1", participant_key: config.participants[0]});
    const accountsBeforeRerun = pool.state.accounts.map(account => ({...account}));
    const cardsBeforeRerun = Array.from(pool.state.cards.values(), card => ({...card}));
    const classificationsBeforeRerun = pool.state.classifications.map(classification => ({...classification}));
    const rerunQueryStart = pool.queries.length;
    await bootstrapStudy({pool, config, cards, sourceChecksum: COPILOT_369_SOURCE_CHECKSUM, credentialManifest});
    const rerunQueries = pool.queries.slice(rerunQueryStart);
    assert.equal(pool.state.study.bootstrap_state, "READY");
    assert.equal(pool.state.studyCards.length, 369);
    assert.equal(pool.state.cards.size, 369);
    assert.equal(pool.state.accounts.length, 3);
    assert.deepEqual(pool.state.studyCards, before);
    assert.deepEqual(pool.state.accounts, accountsBeforeRerun);
    assert.deepEqual(Array.from(pool.state.cards.values()), cardsBeforeRerun);
    assert.deepEqual(pool.state.classifications, classificationsBeforeRerun);
    assert.equal(pool.state.study.source_checksum, COPILOT_369_SOURCE_CHECKSUM);
    assert.ok(rerunQueries.includes("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY"));
    assert.ok(rerunQueries.every(sql => /^\s*SELECT\b/i.test(sql)
        || sql === "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY" || sql === "COMMIT"));
});

test("bootstrap rejects membership checksum drift without changing the persisted membership", async () => {
    const pool = createBootstrapPool();
    const config = DEFAULT_STUDY_CONFIG;
    const credentialManifest = await buildCredentialManifest(config);
    await bootstrapStudy({pool, config, cards, sourceChecksum: COPILOT_369_SOURCE_CHECKSUM, credentialManifest});
    const originalMembership = pool.state.studyCards.map(row => ({...row}));
    pool.state.studyCards[17].source_checksum = "different-checksum";
    const driftedMembership = pool.state.studyCards.map(row => ({...row}));
    const studyBeforeRerun = {...pool.state.study};
    const accountsBeforeRerun = pool.state.accounts.map(account => ({...account}));
    const cardsBeforeRerun = Array.from(pool.state.cards.values(), card => ({...card}));
    const classificationsBeforeRerun = pool.state.classifications.map(classification => ({...classification}));
    assert.notDeepEqual(driftedMembership, originalMembership);
    const rerunQueryStart = pool.queries.length;
    await assert.rejects(
        () => bootstrapStudy({pool, config, cards, sourceChecksum: COPILOT_369_SOURCE_CHECKSUM, credentialManifest}),
        error => error instanceof StudyExistingValidationError
            && error.message === "Existing study card content or ordered membership differs from its protected CSV.",
    );
    const failureQueries = pool.queries.slice(rerunQueryStart);
    assert.equal(pool.state.studyCards.length, 369);
    assert.deepEqual(pool.state.study, studyBeforeRerun);
    assert.deepEqual(pool.state.studyCards, driftedMembership);
    assert.deepEqual(pool.state.accounts, accountsBeforeRerun);
    assert.deepEqual(Array.from(pool.state.cards.values()), cardsBeforeRerun);
    assert.deepEqual(pool.state.classifications, classificationsBeforeRerun);
    assert.ok(failureQueries.includes("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY"));
    assert.ok(failureQueries.every(sql => /^\s*SELECT\b/i.test(sql)
        || sql === "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY" || sql === "ROLLBACK"));
});

test("bootstrap commits READY only after memberships and accounts are complete", async () => {
    const pool = createBootstrapPool();
    const config = DEFAULT_STUDY_CONFIG;
    const credentialManifest = await buildCredentialManifest(config);

    await bootstrapStudy({pool, config, cards, sourceChecksum: COPILOT_369_SOURCE_CHECKSUM, credentialManifest});

    const readOnlyBegin = pool.queries.findIndex(sql => sql === "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const readOnlyCommit = pool.queries.findIndex((sql, index) => index > readOnlyBegin && sql === "COMMIT");
    const firstAccount = pool.queries.findIndex(sql => sql.startsWith("INSERT INTO participant_account"));
    const lastCardMembership = pool.queries.findLastIndex(sql => sql.startsWith("INSERT INTO study_card"));
    const ready = pool.queries.findIndex(sql => sql.startsWith("UPDATE study"));
    const writeCommit = pool.queries.findLastIndex(sql => sql === "COMMIT");

    assert.ok(readOnlyBegin < readOnlyCommit);
    assert.ok(readOnlyCommit < firstAccount);
    assert.ok(lastCardMembership < firstAccount);
    assert.ok(firstAccount < ready);
    assert.ok(ready < writeCommit);
    assert.equal(pool.state.study.bootstrap_state, "READY");
});
