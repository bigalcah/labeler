import assert from "node:assert/strict";
import {mkdtemp, rm, writeFile} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {readPullRequestCards} from "../util/csv-pr-provider.js";
import {computeCardChecksum} from "../util/pr-card-checksum.js";
import {
    CardContentConflictError,
    assertCompatibleCard,
    persistCards,
} from "../util/pr-card-persistence.js";
import {assertBootstrapCards, StudyBootstrapConflictError} from "../util/study-bootstrap.js";
import {
    DEFAULT_STUDY_CONFIG,
    StudyConfigError,
    readStudyConfig,
    resolveAuthoritativeStudyConfig,
} from "../util/study-config.js";
import {withTransaction} from "../util/transaction.js";

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

const toPersistedRow = (card, id) => ({
    id,
    source_card_id: card.source_card_id,
    source_pr_id: card.source_pr_id.toString(),
    repository: card.repository,
    pr_number: card.pr_number,
    title: card.title,
    body: card.body,
    author: card.author,
    language: card.language,
    state: card.state,
    merged: card.merged,
    html_url: card.html_url,
    created_at_source: card.dates.created_at,
    closed_at_source: card.dates.closed_at,
    merged_at_source: card.dates.merged_at,
    summary: card.summary,
    evidence: card.evidence,
    raw_payload: card.raw_payload,
    source_type: card.source_type,
    source_checksum: "source-checksum",
    content_checksum: computeCardChecksum(card),
});

test("uses three deterministic participants when study config input is absent", async () => {
    const config = await readStudyConfig(undefined);

    assert.deepEqual(config, DEFAULT_STUDY_CONFIG);
});

test("reads valid study config from a JSON file when a path is supplied", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "labeler-config-"));
    const configPath = path.join(directory, "study.json");
    await writeFile(configPath, JSON.stringify({
        studyKey: "configured-study",
        expectedCardCount: 300,
        participants: [ "one", "two", "three" ],
    }));

    try {
        const config = await readStudyConfig(configPath);
        assert.equal(config.studyKey, "configured-study");
        assert.deepEqual(config.participants, [ "one", "two", "three" ]);
        assert.deepEqual(config.loginUsernames, {one: "one", two: "two", three: "three"});
    } finally {
        await rm(directory, {recursive: true});
    }
});

test("Given a validation profile When login usernames are parsed Then visible keys and exact login handles remain separate", async () => {
    const config = await readStudyConfig(JSON.stringify({
        studyKey: "pr-card-sorting-validation-30",
        expectedCardCount: 30,
        participants: [ "javier", "diego", "pablo" ],
        loginUsernames: {javier: "javier-30", diego: "diego-30", pablo: "pablo-30"},
    }));

    assert.deepEqual(config.participants, [ "javier", "diego", "pablo" ]);
    assert.deepEqual(config.loginUsernames, {javier: "javier-30", diego: "diego-30", pablo: "pablo-30"});
});

test("Given an explicit login mapping When keys, handles, or uniqueness drift Then configuration is rejected", async () => {
    const base = {
        studyKey: "pr-card-sorting-validation-30",
        expectedCardCount: 30,
        participants: [ "javier", "diego", "pablo" ],
    };
    const invalidMappings = [
        {javier: "javier-30", diego: "diego-30"},
        {javier: "javier-30", diego: "diego-30", pablo: "pablo-30", extra: "extra-30"},
        {javier: "shared-30", diego: "shared-30", pablo: "pablo-30"},
        {javier: "Javier-30", diego: "diego-30", pablo: "pablo-30"},
    ];

    for (const loginUsernames of invalidMappings) {
        await assert.rejects(
            () => readStudyConfig(JSON.stringify({...base, loginUsernames})),
            StudyConfigError,
        );
    }
});

test("rejects duplicate participant identifiers before bootstrap", async () => {
    const input = JSON.stringify({
        studyKey: "duplicate-study",
        expectedCardCount: 300,
        participants: [ "same", "same" ],
    });

    await assert.rejects(() => readStudyConfig(input), StudyConfigError);
});

test("rejects local config drift when persisted config exists", () => {
    const persisted = {studyKey: DEFAULT_STUDY_CONFIG.studyKey, expectedCardCount: 300,
        participants: [ "one", "two", "three" ]};
    const requested = {studyKey: DEFAULT_STUDY_CONFIG.studyKey, expectedCardCount: 300,
        participants: [ "one", "two", "other" ]};

    assert.throws(
        () => resolveAuthoritativeStudyConfig(requested, persisted),
        /Configuration drift/,
    );
});

test("validates all 300 unique CSV cards in strict mode", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "labeler-csv-"));
    const csvPath = path.join(directory, "cards.csv");
    const rows = Array.from({length: 300}, (_, index) =>
        `card-${index},https://github.com/example/repository/pull/${index + 1}`);
    await writeFile(csvPath, `card_id,html_url\n${rows.join("\n")}\n`);

    try {
        const result = await readPullRequestCards(csvPath, {expectedCardCount: 300});
        assert.equal(result.cards.length, 300);
        assert.deepEqual(result.errors, []);
        assert.match(result.sourceChecksum, /^[a-f0-9]{64}$/);
        assert.match(result.cards[0].content_checksum, /^[a-f0-9]{64}$/);
    } finally {
        await rm(directory, {recursive: true});
    }
});

test("reports duplicate IDs and wrong unique count before persistence", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "labeler-csv-"));
    const csvPath = path.join(directory, "cards.csv");
    await writeFile(csvPath, [
        "card_id,html_url",
        "duplicate,https://github.com/example/repository/pull/1",
        "duplicate,https://github.com/example/repository/pull/2",
    ].join("\n"));

    try {
        const {errors} = await readPullRequestCards(csvPath, {expectedCardCount: 300});
        assert.equal(errors.length, 2);
        assert.match(errors[0].message, /Duplicate source_card_id/);
        assert.match(errors[1].message, /Expected 300 unique cards, received 1/);
    } finally {
        await rm(directory, {recursive: true});
    }
});

test("reuses canonically identical persisted cards", () => {
    const card = buildCard("same-card");
    const persisted = toPersistedRow(card, "00000000-0000-0000-0000-000000000001");

    assert.doesNotThrow(() => assertCompatibleCard(persisted, {
        ...card,
        content_checksum: computeCardChecksum(card),
    }));
});

test("detects every canonical conflict before issuing a write", async () => {
    const first = buildCard("first");
    const second = buildCard("second");
    const queries = [];
    const client = {
        query: async sql => {
            queries.push(sql);
            return {
                rows: [
                    toPersistedRow(first, "00000000-0000-0000-0000-000000000001"),
                    toPersistedRow({...second, title: "Changed"}, "00000000-0000-0000-0000-000000000002"),
                ],
            };
        },
    };

    await assert.rejects(
        () => persistCards(client, [ first, second ], "source-checksum"),
        CardContentConflictError,
    );
    assert.equal(queries.length, 1);
    assert.match(queries[0], /^SELECT/);
});

test("rolls back and releases a transaction without closing the shared pool", async () => {
    const commands = [];
    let released = false;
    const client = {
        query: async sql => commands.push(sql),
        release: () => {
            released = true;
        },
    };
    const pool = {connect: async () => client};

    await assert.rejects(
        () => withTransaction(pool, async () => {
            throw new Error("operation failed");
        }),
        /operation failed/,
    );
    assert.deepEqual(commands, [ "BEGIN", "ROLLBACK" ]);
    assert.equal(released, true);
});

test("requires exactly 300 unique cards at the bootstrap boundary", () => {
    assert.throws(
        () => assertBootstrapCards([ buildCard("only-card") ], 300),
        StudyBootstrapConflictError,
    );
});
