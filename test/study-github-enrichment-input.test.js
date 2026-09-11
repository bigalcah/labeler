import assert from "node:assert/strict";
import test from "node:test";
import {prepareStudyGithubEnrichment} from "../util/study-github-enrichment-input.js";

const githubConfig = Object.freeze({enabled: true});

const fixture = expectedCardCount => {
    const study = {
        id: `study-${expectedCardCount}`,
        study_key: `study-key-${expectedCardCount}`,
        source_checksum: `checksum-${expectedCardCount}`,
        expected_card_count: expectedCardCount,
        bootstrap_state: "READY",
    };
    const membership = Array.from({length: expectedCardCount}, (_value, ordinal) => ({
        pr_card_id: `internal-${expectedCardCount}-${ordinal}`,
        source_card_id: `card-${expectedCardCount}-${ordinal}`,
        ordinal,
        repository: "owner/repository",
        pr_number: ordinal + 1,
    }));
    const pool = {query: async (sql, parameters) => {
        if (sql.includes("FROM study\n")) {
            assert.deepEqual(parameters, [study.study_key]);
            return {rows: [study]};
        }
        if (sql.includes("FROM study_card")) {
            assert.deepEqual(parameters, [study.id]);
            return {rows: membership};
        }
        throw new Error(`Unexpected SQL: ${sql}`);
    }};
    return {study, membership, pool};
};

for (const expectedCardCount of [30, 300]) {
    test(`enabled preparation uses persisted ${expectedCardCount}-card identity and ordered membership`, async () => {
        const {study, membership, pool} = fixture(expectedCardCount);
        let parserOptions;
        let received;
        const result = await prepareStudyGithubEnrichment({
            pool,
            csvPath: `/mounted/${expectedCardCount}.csv`,
            requestedStudy: {studyKey: study.study_key, expectedCardCount},
            githubConfig,
            readCards: async (_path, options) => {
                parserOptions = options;
                return {
                    cards: membership.map(card => ({source_card_id: card.source_card_id})),
                    errors: [],
                    sourceChecksum: study.source_checksum,
                };
            },
            createClient: () => ({fetchPullRequest: async () => {}}),
            enrich: async options => {
                received = options;
                return {status: "PROMOTED"};
            },
        });

        assert.deepEqual(parserOptions, {expectedCardCount});
        assert.equal(received.study, study);
        assert.deepEqual(await received.loadCards(), membership);
        assert.equal(result.status, "PROMOTED");
    });
}

test("disabled preparation needs no database, credential, run, or promotion", async () => {
    let touched = false;
    const result = await prepareStudyGithubEnrichment({
        pool: {query: async () => { touched = true; throw new Error("database must stay untouched"); }},
        csvPath: "/mounted/cards.csv",
        requestedStudy: {studyKey: "csv-only", expectedCardCount: 30},
        githubConfig: {enabled: false},
        readCards: async () => { touched = true; throw new Error("CSV must stay untouched"); },
        createClient: () => { touched = true; throw new Error("credential must stay untouched"); },
        enrich: async () => { touched = true; throw new Error("run must not start"); },
    });

    assert.deepEqual(result, {status: "DISABLED"});
    assert.equal(touched, false);
});

test("enabled preparation rejects requested count, checksum, and ordered-membership drift", async () => {
    const {study, membership, pool} = fixture(30);
    const invoke = (requestedStudy, cards, sourceChecksum = study.source_checksum) => prepareStudyGithubEnrichment({
        pool,
        csvPath: "/mounted/cards.csv",
        requestedStudy,
        githubConfig,
        readCards: async () => ({cards, errors: [], sourceChecksum}),
        createClient: () => ({fetchPullRequest: async () => {}}),
        enrich: async () => { throw new Error("must not enrich drifted input"); },
    });

    const cards = membership.map(card => ({source_card_id: card.source_card_id}));
    await assert.rejects(() => invoke({...study, studyKey: study.study_key, expectedCardCount: 300}, cards), /card count/i);
    await assert.rejects(() => invoke({studyKey: study.study_key, expectedCardCount: 30}, cards, "wrong"), /checksum/i);
    await assert.rejects(() => invoke({studyKey: study.study_key, expectedCardCount: 30}, [...cards].reverse()), /membership/i);
});
