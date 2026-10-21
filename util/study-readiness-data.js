import {isDeepStrictEqual} from "node:util";
import {canonicalCardContent, computeCardChecksum} from "./pr-card-checksum.js";
import {readHistoricalReadinessSource} from "./study-readiness-legacy.js";

const identifier = name => `"${name.replaceAll("\"", "\"\"")}"`;

const assertReadinessDataIntegrity = async (client, legacyCsvPath) => {
    const {rows: constraints} = await client.query(`SELECT c.conname, child.relname AS child, parent.relname AS parent,
        ARRAY(SELECT a.attname::text FROM unnest(c.conkey) WITH ORDINALITY key(attnum, ordinal)
            JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = key.attnum ORDER BY key.ordinal) AS child_columns,
        ARRAY(SELECT a.attname::text FROM unnest(c.confkey) WITH ORDINALITY key(attnum, ordinal)
            JOIN pg_attribute a ON a.attrelid = c.confrelid AND a.attnum = key.attnum ORDER BY key.ordinal) AS parent_columns
        FROM pg_constraint c JOIN pg_class child ON child.oid = c.conrelid
        JOIN pg_class parent ON parent.oid = c.confrelid
        JOIN pg_namespace n ON n.oid = child.relnamespace WHERE n.nspname = 'public' AND c.contype = 'f'
        ORDER BY child.relname, c.conname`);
    for (const constraint of constraints) {
        const nonnull = constraint.child_columns.map(column => `child.${identifier(column)} IS NOT NULL`).join(" AND ");
        const join = constraint.child_columns.map((column, index) =>
            `child.${identifier(column)} = parent.${identifier(constraint.parent_columns[index])}`).join(" AND ");
        const {rows} = await client.query(`SELECT 1 FROM public.${identifier(constraint.child)} child
            WHERE ${nonnull} AND NOT EXISTS (SELECT 1 FROM public.${identifier(constraint.parent)} parent WHERE ${join}) LIMIT 1`);
        if (rows.length) throw new Error(`Orphan study data at ${constraint.conname}`);
    }
    const {rows: invalid} = await client.query(`SELECT 'category' AS kind FROM public.participant_category category
        WHERE NOT EXISTS (SELECT 1 FROM public.reviewer WHERE id = category.participant_id)
        UNION ALL SELECT 'classification' FROM public.pr_classification decision
        WHERE NOT EXISTS (SELECT 1 FROM public.study_card card
            WHERE card.study_id = decision.study_id AND card.pr_card_id = decision.pr_card_id)
        OR NOT EXISTS (SELECT 1 FROM public.study_participant participant
            WHERE participant.study_id = decision.study_id AND participant.reviewer_id = decision.participant_id)
        OR NOT EXISTS (SELECT 1 FROM public.participant_category category WHERE category.id = decision.category_id
            AND category.study_id = decision.study_id AND category.participant_id = decision.participant_id)
        UNION ALL SELECT 'discard' FROM public.pr_discard decision
        WHERE NOT EXISTS (SELECT 1 FROM public.study_card card
            WHERE card.study_id = decision.study_id AND card.pr_card_id = decision.pr_card_id)
        OR NOT EXISTS (SELECT 1 FROM public.study_participant participant
            WHERE participant.study_id = decision.study_id AND participant.reviewer_id = decision.participant_id)
        UNION ALL SELECT 'overlap' FROM public.pr_classification classification JOIN public.pr_discard discard
            USING (study_id, pr_card_id, participant_id)
        UNION ALL SELECT 'reviewer' FROM public.reviewer reviewer WHERE NOT EXISTS
            (SELECT 1 FROM public.study_participant participant WHERE participant.reviewer_id = reviewer.id)
        LIMIT 1`);
    if (invalid.length) throw new Error(`Orphan or invalid study decisions/data: ${invalid[0].kind}`);
    const {rows: retained} = await client.query(`SELECT card.* FROM public.pr_cards card
        WHERE NOT EXISTS (SELECT 1 FROM public.study_card member WHERE member.pr_card_id = card.id)`);
    if (retained.length) {
        const legacy = await readHistoricalReadinessSource(legacyCsvPath);
        const known = new Map(legacy.cards.map(card => [card.source_card_id, card]));
        for (const row of retained) {
            const expected = known.get(row.source_card_id);
            if (!expected || row.content_checksum !== computeCardChecksum(expected)
                || row.source_checksum !== legacy.sourceChecksum
                || !isDeepStrictEqual(canonicalCardContent(row), canonicalCardContent(expected))) {
                throw new Error("Unknown retained card outside approved study membership");
            }
        }
    }
};

export {assertReadinessDataIntegrity};
