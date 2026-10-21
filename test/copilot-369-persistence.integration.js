import assert from "node:assert/strict";
import {after, before, beforeEach, test} from "node:test";
import {fileURLToPath} from "node:url";
import {readCopilot369Cards} from "../util/copilot-369-source.js";
import {
    Copilot369PersistenceError,
    persistCopilot369Cards,
    verifyCopilot369ExistingCards,
} from "../util/copilot-369-persistence.js";
import {
    closeCopilot369Database,
    startCopilot369Database,
} from "./support/copilot-369-fixture.js";

const SOURCE_PATH = fileURLToPath(new URL("../plans/copilot-369-cards.csv", import.meta.url));
let database;
let cards;
let sourceChecksum;

const withTransaction = async (pool, action) => {
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const result = await action(client);
        await client.query("COMMIT");
        return result;
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
};

const withRollbackTransaction = async (pool, action) => {
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        return await action(client);
    } finally {
        await client.query("ROLLBACK");
        client.release();
    }
};

const seedCards = () => withTransaction(database.pool,
    client => persistCopilot369Cards(client, cards, sourceChecksum));

const persistedCards = async () => {
    const {rows} = await database.pool.query(
        "SELECT to_jsonb(card) AS card FROM pr_cards card ORDER BY source_card_id",
    );
    return rows.map(row => row.card);
};

before(async () => {
    database = await startCopilot369Database();
    const source = await readCopilot369Cards(SOURCE_PATH);
    cards = source.cards;
    sourceChecksum = source.sourceChecksum;
});

beforeEach(async () => {
    await database.pool.query("DELETE FROM pr_cards");
});

after(async () => {
    if (database) await closeCopilot369Database(database);
});

test("Given an empty isolated database When the canonical batch persists Then 369 CSV cards have source and content checksums", async () => {
    const persisted = await seedCards();

    assert.equal(persisted.length, 369);
    assert.equal((await persistedCards()).length, 369);
    assert.ok(persisted.every(card => /^[a-f0-9]{64}$/.test(card.content_checksum)));
});

test("Given compatible existing cards When the read-only verifier runs Then it returns all cards without locks or writes", async () => {
    await seedCards();
    const beforeVerification = await persistedCards();
    const client = await database.pool.connect();
    const queries = [];
    try {
        const readOnlyClient = {
            query: (sql, values) => {
                queries.push(sql);
                return client.query(sql, values);
            },
        };
        const verified = await verifyCopilot369ExistingCards(readOnlyClient, cards, sourceChecksum);
        assert.equal(verified.length, 369);
        assert.ok(queries.every(sql => /^\s*SELECT\b/i.test(sql) && !/\bFOR\s+UPDATE\b/i.test(sql)));
    } finally {
        client.release();
    }
    assert.deepEqual(await persistedCards(), beforeVerification);
});

test("Given compatible existing cards When the same canonical batch persists again Then every stored field and timestamp is unchanged", async () => {
    await seedCards();
    const beforeReuse = await persistedCards();

    await seedCards();

    assert.deepEqual(await persistedCards(), beforeReuse);
});

const driftCases = [
    {field: "source type", sql: "UPDATE pr_cards SET source_type = 'GITHUB' WHERE source_card_id = $1"},
    {field: "source checksum", sql: "UPDATE pr_cards SET source_checksum = 'different-source' WHERE source_card_id = $1"},
    {field: "source PR identity", sql: "UPDATE pr_cards SET source_pr_id = source_pr_id || '-different' WHERE source_card_id = $1"},
    {field: "raw payload", sql: "UPDATE pr_cards SET raw_payload = jsonb_set(raw_payload, '{body}', to_jsonb('drifted'::text)) WHERE source_card_id = $1"},
    {field: "canonical content", sql: "UPDATE pr_cards SET title = title || ' drifted' WHERE source_card_id = $1"},
    {field: "content checksum", sql: "UPDATE pr_cards SET content_checksum = repeat('0', 64) WHERE source_card_id = $1"},
];

for (const drift of driftCases) {
    test(`Given an existing card with ${drift.field} drift When the batch is validated Then it fails before inserting any missing card`, async () => {
        await seedCards();
        const missingCard = cards[0];
        const divergentCard = cards[1];

        await withRollbackTransaction(database.pool, async client => {
            await client.query("DELETE FROM pr_cards WHERE source_card_id = $1", [missingCard.source_card_id]);
            await client.query(drift.sql, [divergentCard.source_card_id]);
            await assert.rejects(
                () => persistCopilot369Cards(client, cards, sourceChecksum),
                Copilot369PersistenceError,
            );
            const {rows} = await client.query(
                "SELECT source_card_id FROM pr_cards WHERE source_card_id = $1",
                [missingCard.source_card_id],
            );
            assert.deepEqual(rows, []);
        });
    });
}

test("Given a null pre-existing content checksum When the batch is validated Then it fails without backfilling the checksum", async () => {
    await seedCards();
    const card = cards[0];

    await withRollbackTransaction(database.pool, async client => {
        await client.query("UPDATE pr_cards SET content_checksum = NULL WHERE source_card_id = $1", [card.source_card_id]);
        await assert.rejects(
            () => persistCopilot369Cards(client, cards, sourceChecksum),
            Copilot369PersistenceError,
        );
        const {rows} = await client.query(
            "SELECT content_checksum FROM pr_cards WHERE source_card_id = $1",
            [card.source_card_id],
        );
        assert.deepEqual(rows, [{content_checksum: null}]);
    });
});

test("Given a matching card inserted after preflight When the batch insert races Then the concurrent row is verified and reused", async () => {
    await seedCards();
    const concurrentlyInsertedCard = cards[cards.length - 1];
    await database.pool.query("DELETE FROM pr_cards WHERE source_card_id = $1", [concurrentlyInsertedCard.source_card_id]);
    const client = await database.pool.connect();
    let competingInsertCompleted = false;
    try {
        await client.query("BEGIN");
        const racingClient = {
            query: async (sql, values) => {
                const result = await client.query(sql, values);
                if (!competingInsertCompleted && /^\s*SELECT\b/i.test(sql)) {
                    competingInsertCompleted = true;
                    await withTransaction(database.pool,
                        competingClient => persistCopilot369Cards(competingClient, cards, sourceChecksum));
                }
                return result;
            },
        };
        const persisted = await persistCopilot369Cards(racingClient, cards, sourceChecksum);
        await client.query("COMMIT");
        assert.equal(persisted.length, 369);
        assert.equal(competingInsertCompleted, true);
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
    const {rows} = await database.pool.query(
        "SELECT count(*)::integer AS count FROM pr_cards WHERE source_card_id = $1",
        [concurrentlyInsertedCard.source_card_id],
    );
    assert.deepEqual(rows, [{count: 1}]);
});
