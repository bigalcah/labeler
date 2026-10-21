import {isDeepStrictEqual} from "node:util";
import {canonicalCardContent, computeCardChecksum} from "./pr-card-checksum.js";
import {COPILOT_369_SOURCE_CHECKSUM} from "./copilot-369-source.js";

const COPILOT_369_CARD_COUNT = 369;
const CARD_COLUMNS = `id, source_card_id, source_pr_id, repository, pr_number, title, body, author,
    language, state, merged, html_url, created_at_source, closed_at_source, merged_at_source,
    summary, evidence, raw_payload, source_type, source_checksum, content_checksum`;

class Copilot369PersistenceError extends Error {
    constructor(message, sourceCardId = null) {
        super(message);
        this.name = "Copilot369PersistenceError";
        this.sourceCardId = sourceCardId;
    }
}

const prepareRecords = (cards, sourceChecksum) => {
    if (sourceChecksum !== COPILOT_369_SOURCE_CHECKSUM) {
        throw new Copilot369PersistenceError("Source checksum is not the canonical Copilot369 checksum");
    }
    if (cards.length !== COPILOT_369_CARD_COUNT) {
        throw new Copilot369PersistenceError(`Expected ${COPILOT_369_CARD_COUNT} Copilot369 cards; received ${cards.length}`);
    }

    const seenIds = new Set();
    return cards.map(card => {
        if (card.source_type !== "CSV" || card.source_card_id !== card.source_pr_id) {
            throw new Copilot369PersistenceError("Copilot369 cards require matching CSV source identities", card.source_card_id);
        }
        if (seenIds.has(card.source_card_id)) {
            throw new Copilot369PersistenceError("Duplicate Copilot369 source_card_id", card.source_card_id);
        }
        seenIds.add(card.source_card_id);
        return {
            ...canonicalCardContent(card),
            source_checksum: sourceChecksum,
            content_checksum: computeCardChecksum(card),
        };
    });
};

const selectExistingCards = async (client, sourceCardIds) => {
    const {rows} = await client.query(
        `SELECT ${CARD_COLUMNS}
         FROM pr_cards
         WHERE source_card_id = ANY($1::TEXT[])`,
        [sourceCardIds],
    );
    return rows;
};

const assertExistingCardCompatible = (existing, incoming, sourceChecksum) => {
    if (existing.source_type !== "CSV"
        || existing.source_checksum !== sourceChecksum
        || existing.source_pr_id !== incoming.source_pr_id
        || existing.content_checksum === null
        || existing.content_checksum !== incoming.content_checksum
        || !isDeepStrictEqual(canonicalCardContent(existing), canonicalCardContent(incoming))) {
        throw new Copilot369PersistenceError("Pre-existing Copilot369 card differs from the canonical source", incoming.source_card_id);
    }
};

const validateExistingRecords = async (client, records, sourceChecksum) => {
    const rows = await selectExistingCards(client, records.map(record => record.source_card_id));
    const persisted = new Map(rows.map(row => [row.source_card_id, row]));
    for (const record of records) {
        const existing = persisted.get(record.source_card_id);
        if (existing) assertExistingCardCompatible(existing, record, sourceChecksum);
    }
    return persisted;
};

const verifyCopilot369ExistingCards = async (client, cards, sourceChecksum) => {
    const records = prepareRecords(cards, sourceChecksum);
    const persisted = await validateExistingRecords(client, records, sourceChecksum);
    return records.flatMap(record => {
        const existing = persisted.get(record.source_card_id);
        return existing ? [{id: existing.id, source_card_id: existing.source_card_id,
            content_checksum: existing.content_checksum}] : [];
    });
};

const insertCard = async (client, record) => {
    const {rows} = await client.query(
        `INSERT INTO pr_cards(
            source_card_id, source_pr_id, repository, pr_number, title, body, author,
            language, state, merged, html_url, created_at_source, closed_at_source,
            merged_at_source, summary, evidence, raw_payload, source_type,
            source_checksum, content_checksum
        ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
            $11, $12, $13, $14, $15, $16, $17, $18, $19, $20
        )
        ON CONFLICT (source_card_id) DO NOTHING
        RETURNING id, source_card_id, content_checksum`,
        [record.source_card_id, record.source_pr_id, record.repository, record.pr_number,
            record.title, record.body, record.author, record.language, record.state, record.merged,
            record.html_url, record.created_at_source, record.closed_at_source, record.merged_at_source,
            record.summary, record.evidence, record.raw_payload, record.source_type,
            record.source_checksum, record.content_checksum],
    );
    return rows[0] ?? null;
};

const persistCopilot369Cards = async (client, cards, sourceChecksum) => {
    const records = prepareRecords(cards, sourceChecksum);
    const persisted = await validateExistingRecords(client, records, sourceChecksum);

    for (const record of records) {
        if (persisted.has(record.source_card_id)) continue;
        let existing = await insertCard(client, record);
        if (!existing) {
            [existing] = await selectExistingCards(client, [record.source_card_id]);
            if (existing) assertExistingCardCompatible(existing, record, sourceChecksum);
            if (!existing) {
                throw new Copilot369PersistenceError("Concurrent Copilot369 insert disappeared before verification", record.source_card_id);
            }
        }
        persisted.set(record.source_card_id, existing);
    }

    return records.map(record => {
        const existing = persisted.get(record.source_card_id);
        return {id: existing.id, source_card_id: existing.source_card_id,
            content_checksum: existing.content_checksum};
    });
};

export {Copilot369PersistenceError, persistCopilot369Cards, verifyCopilot369ExistingCards};
