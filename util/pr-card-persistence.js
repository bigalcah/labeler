import {canonicalCardContent, computeCardChecksum} from "./pr-card-checksum.js";

class CardContentConflictError extends Error {
    constructor(sourceCardId) {
        super(`Canonical content conflict for source_card_id ${sourceCardId}`);
        this.name = "CardContentConflictError";
        this.sourceCardId = sourceCardId;
    }
}

const toRecord = card => ({
    ...canonicalCardContent(card),
    content_checksum: computeCardChecksum(card),
});

const assertCompatibleCard = (existing, incoming) => {
    const persistedChecksum = computeCardChecksum({
        ...existing,
        dates: {
            created_at: existing.created_at_source,
            closed_at: existing.closed_at_source,
            merged_at: existing.merged_at_source,
        },
    });
    if (persistedChecksum !== incoming.content_checksum
        || (existing.content_checksum && existing.content_checksum !== persistedChecksum)) {
        throw new CardContentConflictError(incoming.source_card_id);
    }
};

const selectCards = async (client, sourceCardIds) => {
    const {rows} = await client.query(
        `SELECT id, source_card_id, source_pr_id, repository, pr_number, title, body, author,
                language, state, merged, html_url, created_at_source, closed_at_source,
                merged_at_source, summary, evidence, raw_payload, source_type,
                source_checksum, content_checksum
         FROM pr_cards
         WHERE source_card_id = ANY($1::TEXT[])
         FOR UPDATE`,
        [ sourceCardIds ],
    );
    return rows;
};

const insertCard = async (client, record, sourceChecksum) => client.query(
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
    [
        record.source_card_id,
        record.source_pr_id,
        record.repository,
        record.pr_number,
        record.title,
        record.body,
        record.author,
        record.language,
        record.state,
        record.merged,
        record.html_url,
        record.created_at_source,
        record.closed_at_source,
        record.merged_at_source,
        record.summary,
        record.evidence,
        record.raw_payload,
        record.source_type,
        sourceChecksum,
        record.content_checksum,
    ],
);

const persistCards = async (client, cards, sourceChecksum) => {
    const records = cards.map(toRecord);
    const existingRows = await selectCards(client, records.map(record => record.source_card_id));
    const persisted = new Map(existingRows.map(row => [ row.source_card_id, row ]));

    for (const record of records) {
        const existing = persisted.get(record.source_card_id);
        if (existing) assertCompatibleCard(existing, record);
    }

    for (const record of records) {
        const existing = persisted.get(record.source_card_id);
        if (existing) {
            if (!existing.content_checksum) {
                await client.query(
                    `UPDATE pr_cards
                     SET content_checksum = $2
                     WHERE id = $1 AND content_checksum IS NULL`,
                    [ existing.id, record.content_checksum ],
                );
                existing.content_checksum = record.content_checksum;
            }
            continue;
        }

        const {rows} = await insertCard(client, record, sourceChecksum);
        if (rows.length > 0) {
            persisted.set(record.source_card_id, rows[0]);
            continue;
        }

        const [ concurrent ] = await selectCards(client, [ record.source_card_id ]);
        assertCompatibleCard(concurrent, record);
        persisted.set(record.source_card_id, concurrent);
    }

    return records.map(record => persisted.get(record.source_card_id));
};

export {CardContentConflictError, assertCompatibleCard, persistCards};
