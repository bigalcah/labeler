import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {randomBytes, randomUUID} from "node:crypto";
import {after, before, test} from "node:test";
import pg from "pg";
import {
    loadParticipantCategorySummary,
    loadStudyCardPage,
    normalizeProgressQuery,
} from "../util/study-read-repository.js";
import {runStudyMigrations} from "../util/study-schema.js";

const {Pool} = pg;
const containerName = `labeler-study-read-repository-${randomUUID()}`;
const password = randomBytes(24).toString("base64url");
const study300Id = "11111111-1111-4111-8111-111111111111";
const study30Id = "22222222-2222-4222-8222-222222222222";
const alphaCategoryId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const betaCategoryId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const zeroCategoryId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3";
const bobCategoryId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
const thirtyCategoryId = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";
let pool;
let aliceId;
let bobId;

const docker = argumentsList => {
    const result = spawnSync("docker", argumentsList, {encoding: "utf8"});
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    return result.stdout.trim();
};

const seedStudyData = () => pool.query(
    `INSERT INTO study(id, study_key, config, source_checksum, expected_card_count, bootstrap_state)
     VALUES
       ('${study300Id}', 'study-300',
        '{"studyKey":"study-300","expectedCardCount":300,"participants":["alice","bob"]}', 'sum-300', 300, 'READY'),
       ('${study30Id}', 'study-30',
        '{"studyKey":"study-30","expectedCardCount":30,"participants":["alice"]}', 'sum-30', 30, 'READY');

     INSERT INTO reviewer(name) VALUES ('alice'), ('bob');

     INSERT INTO study_participant(study_id, reviewer_id, participant_key, ordinal)
     SELECT '${study300Id}', reviewer.id, participant.name, participant.ordinal
     FROM (VALUES ('alice', 0), ('bob', 1)) participant(name, ordinal)
     JOIN reviewer ON reviewer.name = participant.name;

     INSERT INTO study_participant(study_id, reviewer_id, participant_key, ordinal)
     SELECT '${study30Id}', reviewer.id, 'alice', 0
     FROM reviewer WHERE name = 'alice';

     INSERT INTO pr_cards(source_card_id, title, raw_payload, source_checksum, content_checksum, html_url)
     SELECT 's300-card-' || ordinal, 'Study 300 card ' || ordinal,
            jsonb_build_object('card_id', 's300-card-' || ordinal), 'sum-300', 'content-300-' || ordinal,
            'https://example.test/study-300/pr/' || ordinal
     FROM generate_series(0, 299) ordinal;

     INSERT INTO pr_cards(source_card_id, title, raw_payload, source_checksum, content_checksum, html_url)
     SELECT 's30-card-' || ordinal, 'Study 30 card ' || ordinal,
            jsonb_build_object('card_id', 's30-card-' || ordinal), 'sum-30', 'content-30-' || ordinal,
            'https://example.test/study-30/pr/' || ordinal
     FROM generate_series(0, 29) ordinal;

     INSERT INTO study_card(study_id, pr_card_id, source_card_id, ordinal, source_checksum)
     SELECT '${study300Id}', card.id, card.source_card_id,
            substring(card.source_card_id FROM 11)::integer, card.content_checksum
     FROM pr_cards card WHERE card.source_card_id LIKE 's300-card-%';

     INSERT INTO study_card(study_id, pr_card_id, source_card_id, ordinal, source_checksum)
     SELECT '${study30Id}', card.id, card.source_card_id,
            substring(card.source_card_id FROM 10)::integer, card.content_checksum
     FROM pr_cards card WHERE card.source_card_id LIKE 's30-card-%';

     INSERT INTO participant_category(id, study_id, participant_id, raw_name, normalized_name)
     SELECT category.id::uuid, '${study300Id}', reviewer.id, category.raw_name, category.normalized_name
     FROM (VALUES
       ('${alphaCategoryId}', 'alice', 'Alpha', 'alpha'),
       ('${betaCategoryId}', 'alice', 'Beta', 'beta'),
       ('${zeroCategoryId}', 'alice', 'Zero', 'zero'),
       ('${bobCategoryId}', 'bob', 'Bob only', 'bob only')
     ) category(id, participant_key, raw_name, normalized_name)
     JOIN reviewer ON reviewer.name = category.participant_key;

     INSERT INTO participant_category(id, study_id, participant_id, raw_name, normalized_name)
     SELECT '${thirtyCategoryId}', '${study30Id}', reviewer.id, 'Thirty', 'thirty'
     FROM reviewer WHERE name = 'alice';

     INSERT INTO pr_classification(pr_card_id, participant_id, category_id, remarks, study_id)
     SELECT card.pr_card_id, reviewer.id, mapping.category_id::uuid, mapping.remarks, card.study_id
     FROM (VALUES
       (0, 'alice', '${alphaCategoryId}', 'alpha first'),
       (5, 'alice', '${alphaCategoryId}', 'alpha second'),
       (2, 'alice', '${betaCategoryId}', 'beta only'),
       (0, 'bob', '${bobCategoryId}', 'bob first')
     ) mapping(ordinal, participant_key, category_id, remarks)
     JOIN reviewer ON reviewer.name = mapping.participant_key
     JOIN study_card card
       ON card.study_id = '${study300Id}' AND card.ordinal = mapping.ordinal;

     INSERT INTO pr_classification(pr_card_id, participant_id, category_id, remarks, study_id)
     SELECT card.pr_card_id, reviewer.id, '${thirtyCategoryId}', 'thirty first', card.study_id
     FROM reviewer
     JOIN study_card card
       ON card.study_id = '${study30Id}' AND card.ordinal = 0
     WHERE reviewer.name = 'alice';

     INSERT INTO pr_discard(pr_card_id, participant_id, reason, study_id)
     SELECT card.pr_card_id, reviewer.id, 'duplicate', card.study_id
     FROM reviewer
     JOIN study_card card
       ON card.study_id = '${study300Id}' AND card.ordinal = 7
     WHERE reviewer.name = 'alice';`,
);

const createRecordingExecutor = executor => {
    const calls = [];
    return {
        calls,
        query: (sql, parameters) => {
            calls.push({sql, parameters});
            return executor.query(sql, parameters);
        },
    };
};

const ordinalsOf = rows => rows.map(row => row.ordinal);

const loadPage = (executor, studyId, participantId, query) =>
    loadStudyCardPage(executor, studyId, participantId, normalizeProgressQuery(query));

const decisionCounts = async () => {
    const {rows: [counts]} = await pool.query(
        `SELECT (SELECT COUNT(*) FROM pr_classification)::integer AS classifications,
                (SELECT COUNT(*) FROM pr_discard)::integer AS discards`,
    );
    return counts;
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
            break;
        } catch (_error) {
            await new Promise(resolve => setTimeout(resolve, 250));
        }
        if (attempt === 59) throw new Error("PostgreSQL test container did not become ready");
    }
    await runStudyMigrations(pool);
    await seedStudyData();
    const {rows: participants} = await pool.query("SELECT id, name FROM reviewer ORDER BY name");
    aliceId = participants.find(participant => participant.name === "alice").id;
    bobId = participants.find(participant => participant.name === "bob").id;
});

after(async () => {
    if (pool) await pool.end();
    spawnSync("docker", ["rm", "--force", containerName], {encoding: "utf8"});
});

test("normalizes progress queries with defaults, page offset, and the 100 limit cap", () => {
    assert.deepEqual(normalizeProgressQuery(), {page: 1, limit: 20, offset: 0});
    assert.deepEqual(normalizeProgressQuery({}), {page: 1, limit: 20, offset: 0});
    assert.deepEqual(normalizeProgressQuery({page: "2", limit: "1000"}), {page: 2, limit: 100, offset: 100});
    assert.deepEqual(normalizeProgressQuery({page: 3, limit: 20}), {page: 3, limit: 20, offset: 40});
    assert.deepEqual(normalizeProgressQuery({page: 4, limit: 100}), {page: 4, limit: 100, offset: 300});
    assert.deepEqual(normalizeProgressQuery({page: 4, limit: 101}), {page: 4, limit: 100, offset: 300});
    for (const invalid of [
        {page: "0", limit: "-5"},
        {page: "abc", limit: "1.5"},
        {page: "", limit: null},
        {page: "1e3", limit: "Infinity"},
        {page: undefined, limit: ""},
        {page: ["1", "2"], limit: {}},
    ]) {
        assert.deepEqual(normalizeProgressQuery(invalid), {page: 1, limit: 20, offset: 0});
    }
});

test("reads an ordered page scoped by study and participant with bound parameters and total metadata", async () => {
    const executor = createRecordingExecutor(pool);
    const firstPage = await loadPage(executor, study300Id, aliceId, {});

    assert.equal(firstPage.total, 300);
    assert.equal(firstPage.page, 1);
    assert.equal(firstPage.limit, 20);
    assert.equal(firstPage.totalPages, 15);
    assert.deepEqual(ordinalsOf(firstPage.rows), Array.from({length: 20}, (_value, index) => index));

    const pageQuery = executor.calls.find(call => call.sql.includes("LIMIT $3"));
    const totalQuery = executor.calls.find(call => call.sql.includes("COUNT(*)::INTEGER AS total"));
    assert.ok(pageQuery, "page query must bind an explicit limit");
    assert.ok(totalQuery, "total query must count membership for the page metadata");
    assert.deepEqual(pageQuery.parameters, [study300Id, aliceId, 20, 0]);
    assert.deepEqual(totalQuery.parameters, [study300Id]);
    assert.match(pageQuery.sql, /WHERE study_card\.study_id = \$1/);
    assert.match(pageQuery.sql, /classification\.participant_id = \$2/);
    assert.match(pageQuery.sql, /discard\.participant_id = \$2/);
    assert.match(pageQuery.sql, /ORDER BY study_card\.ordinal/);
    assert.match(pageQuery.sql, /LIMIT \$3 OFFSET \$4/);
    assert.match(pageQuery.sql, /category\.definition AS own_category_definition/);
    assert.match(pageQuery.sql, /category\.color_slot AS own_category_color_slot/);
    assert.ok(!pageQuery.sql.includes(study300Id), "study id must not be interpolated into SQL");

    const secondPage = await loadPage(executor, study300Id, aliceId, {page: 2});
    assert.deepEqual(ordinalsOf(secondPage.rows), Array.from({length: 20}, (_value, index) => index + 20));
    assert.equal(secondPage.total, 300);
    const twoPageIds = new Set([...firstPage.rows, ...secondPage.rows].map(row => row.id));
    assert.equal(twoPageIds.size, 40, "pages must not skip or duplicate cards");

    const cappedPage = await loadPage(executor, study300Id, aliceId, {page: 2, limit: 1000});
    assert.equal(cappedPage.limit, 100);
    assert.equal(cappedPage.rows.length, 100);
    assert.equal(ordinalsOf(cappedPage.rows)[0], 100);
    const cappedQuery = executor.calls.find(call => call.parameters?.[2] === 100 && call.parameters?.[3] === 100);
    assert.ok(cappedQuery, "the capped limit and derived offset must reach the repository as bound parameters");

    const lastPage = await loadPage(executor, study300Id, aliceId, {page: 15});
    assert.deepEqual(ordinalsOf(lastPage.rows), Array.from({length: 20}, (_value, index) => index + 280));

    const outOfRange = await loadPage(executor, study300Id, aliceId, {page: 16});
    assert.deepEqual(outOfRange.rows, []);
    assert.equal(outOfRange.total, 300);
    assert.equal(outOfRange.page, 16);
    assert.equal(outOfRange.totalPages, 15);

    const smallStudy = await loadPage(executor, study30Id, aliceId, {});
    assert.equal(smallStudy.total, 30);
    assert.equal(smallStudy.totalPages, 2);
    assert.deepEqual(ordinalsOf(smallStudy.rows), Array.from({length: 20}, (_value, index) => index));
    const smallSecondPage = await loadPage(executor, study30Id, aliceId, {page: 2});
    assert.deepEqual(ordinalsOf(smallSecondPage.rows), Array.from({length: 10}, (_value, index) => index + 20));

    const foreign = await loadPage(executor, "99999999-9999-4999-8999-999999999999", aliceId, {});
    assert.deepEqual(foreign.rows, []);
    assert.equal(foreign.total, 0);

    const nonMember = await loadPage(executor, study30Id, bobId, {});
    assert.equal(nonMember.total, 30);
    assert.ok(nonMember.rows.every(row => row.status === "PENDING"), "a non-member sees only the study membership, never another participant's decisions");

    assert.deepEqual(executor.calls.filter(({sql}) => /^\s*(INSERT|UPDATE|DELETE)/i.test(sql)), []);
});

test("projects private terminal states for the session participant without foreign decisions", async () => {
    const alicePage = await loadPage(createRecordingExecutor(pool), study300Id, aliceId, {limit: 100});
    const aliceByOrdinal = new Map(alicePage.rows.map(row => [row.ordinal, row]));
    assert.equal(aliceByOrdinal.get(0).status, "CLASSIFIED");
    assert.equal(aliceByOrdinal.get(0).own_category, "Alpha");
    assert.equal(aliceByOrdinal.get(0).discard_reason, null);
    assert.equal(aliceByOrdinal.get(2).status, "CLASSIFIED");
    assert.equal(aliceByOrdinal.get(2).own_category, "Beta");
    assert.equal(aliceByOrdinal.get(3).status, "PENDING");
    assert.equal(aliceByOrdinal.get(3).own_category, null);
    assert.equal(aliceByOrdinal.get(3).discard_reason, null);
    assert.equal(aliceByOrdinal.get(7).status, "DISCARDED");
    assert.equal(aliceByOrdinal.get(7).own_category, null);
    assert.equal(aliceByOrdinal.get(7).discard_reason, "duplicate");

    const bobPage = await loadPage(createRecordingExecutor(pool), study300Id, bobId, {limit: 100});
    const bobByOrdinal = new Map(bobPage.rows.map(row => [row.ordinal, row]));
    assert.equal(bobPage.total, 300);
    assert.equal(bobByOrdinal.get(0).status, "CLASSIFIED");
    assert.equal(bobByOrdinal.get(0).own_category, "Bob only");
    assert.equal(bobByOrdinal.get(2).status, "PENDING");
    assert.equal(bobByOrdinal.get(7).status, "PENDING");
    assert.equal(alicePage.total, 300);
});

test("reads every category group over the full membership, independent of page and limit", async () => {
    const executor = createRecordingExecutor(pool);
    const summary = await loadParticipantCategorySummary(executor, study300Id, aliceId);
    assert.deepEqual(summary.map(group => group.raw_name), ["Alpha", "Beta", "Zero"]);
    assert.deepEqual(summary.map(group => group.total), [2, 1, 0]);
    assert.deepEqual(summary.map(group => group.id), [alphaCategoryId, betaCategoryId, zeroCategoryId]);

    const alpha = summary.find(group => group.raw_name === "Alpha");
    const beta = summary.find(group => group.raw_name === "Beta");
    const zero = summary.find(group => group.raw_name === "Zero");
    assert.deepEqual(alpha.cards.map(card => card.ordinal), [0, 5]);
    assert.deepEqual(beta.cards.map(card => card.ordinal), [2]);
    assert.deepEqual(zero.cards, []);
    assert.equal(zero.total, 0, "an unused category must still produce a zero-count group");
    assert.equal(alpha.cards[0].title, "Study 300 card 0");
    assert.equal(alpha.cards[0].html_url, "https://example.test/study-300/pr/0");
    const groupedIds = summary.flatMap(group => group.cards.map(card => card.id));
    assert.equal(new Set(groupedIds).size, groupedIds.length, "each classified card appears once");

    const summaryQuery = executor.calls.find(call => call.sql.includes("FROM participant_category category"));
    assert.deepEqual(summaryQuery.parameters, [study300Id, aliceId]);
    assert.match(summaryQuery.sql, /ORDER BY card\.ordinal/);
    assert.match(summaryQuery.sql, /category\.participant_id = \$2/);
    assert.ok(
        summary.every(group => Object.hasOwn(group, "definition") && Object.hasOwn(group, "color_slot")),
        "every category group must expose its own definition and color slot",
    );
    assert.deepEqual(summary.map(group => group.definition), [ null, null, null ], "seeded categories must not invent definitions");
    assert.ok(
        summary.every(group => Number.isInteger(group.color_slot) && group.color_slot >= 0 && group.color_slot < 12),
        "every category group must expose a slot inside the palette contract",
    );

    await loadPage(executor, study300Id, aliceId, {page: 99, limit: 20});
    const summaryAfterOutOfRangePage = await loadParticipantCategorySummary(executor, study300Id, aliceId);
    assert.deepEqual(summaryAfterOutOfRangePage, summary);

    const bobSummary = await loadParticipantCategorySummary(executor, study300Id, bobId);
    assert.deepEqual(bobSummary.map(group => group.raw_name), ["Bob only"]);
    assert.deepEqual(bobSummary.map(group => group.total), [1]);
    assert.deepEqual(bobSummary[0].cards.map(card => card.ordinal), [0]);

    const smallSummary = await loadParticipantCategorySummary(executor, study30Id, aliceId);
    assert.deepEqual(smallSummary.map(group => group.raw_name), ["Thirty"]);
    assert.deepEqual(smallSummary.map(group => group.total), [1]);
    assert.deepEqual(smallSummary[0].cards.map(card => card.ordinal), [0]);

    const smallNonMemberSummary = await loadParticipantCategorySummary(executor, study30Id, bobId);
    assert.deepEqual(smallNonMemberSummary, []);

    assert.deepEqual(executor.calls.filter(({sql}) => /^\s*(INSERT|UPDATE|DELETE)/i.test(sql)), []);
});

test("isolation reads leave Alice and Bob decisions unmutated", async () => {
    const beforeCounts = await decisionCounts();
    const executor = createRecordingExecutor(pool);
    await loadPage(executor, study300Id, aliceId, {page: 1, limit: 100});
    await loadPage(executor, study300Id, bobId, {page: 1, limit: 100});
    await loadParticipantCategorySummary(executor, study300Id, aliceId);
    await loadParticipantCategorySummary(executor, study300Id, bobId);
    const afterCounts = await decisionCounts();
    assert.deepEqual(afterCounts, beforeCounts);
    assert.deepEqual(executor.calls.filter(({sql}) => /^\s*(INSERT|UPDATE|DELETE)/i.test(sql)), []);
});
