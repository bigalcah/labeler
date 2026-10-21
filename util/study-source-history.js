import {isDeepStrictEqual} from "node:util";

const appendStudySourceMembership = async (client, studyId, sourceChecksum, cards) => {
    const records = cards.map((card, ordinal) => ({pr_card_id: card.id, source_card_id: card.source_card_id,
        content_checksum: card.content_checksum, ordinal}));
    await client.query(
        `INSERT INTO public.study_card_reference(study_id,pr_card_id)
         SELECT $1,pr_card_id FROM jsonb_to_recordset($2::jsonb) AS card(pr_card_id uuid)
         ON CONFLICT DO NOTHING`, [studyId, JSON.stringify(records)]);
    await client.query(
        `INSERT INTO public.study_source_membership(study_id,source_checksum,ordinal,pr_card_id,source_card_id,content_checksum)
         SELECT $1,$2,ordinal,pr_card_id,source_card_id,content_checksum FROM jsonb_to_recordset($3::jsonb)
           AS card(pr_card_id uuid,source_card_id text,content_checksum text,ordinal integer)
         ON CONFLICT DO NOTHING`, [studyId, sourceChecksum, JSON.stringify(records)]);
    const {rows} = await client.query(
        `SELECT pr_card_id,source_card_id,content_checksum,ordinal FROM public.study_source_membership
         WHERE study_id=$1 AND source_checksum=$2 ORDER BY ordinal`, [studyId, sourceChecksum]);
    if (!isDeepStrictEqual(rows, records)) throw new Error("Study source history membership mismatch");
};

const assertStudySourceHistory = async client => {
    const {rows} = await client.query(`SELECT 'active membership' AS kind FROM public.study_card member
        JOIN public.study ON study.id=member.study_id
        WHERE NOT EXISTS (SELECT 1 FROM public.study_source_membership history
            WHERE history.study_id=member.study_id AND history.source_checksum=study.source_checksum
              AND history.pr_card_id=member.pr_card_id AND history.ordinal=member.ordinal
              AND history.source_card_id=member.source_card_id AND history.content_checksum=member.source_checksum)
        UNION ALL SELECT 'historical content' FROM public.study_source_membership history
        JOIN public.pr_cards card ON card.id=history.pr_card_id
        WHERE history.source_card_id IS DISTINCT FROM card.source_card_id
           OR history.content_checksum IS DISTINCT FROM card.content_checksum
        UNION ALL SELECT 'historical source' FROM public.study_source_membership history
        JOIN public.study ON study.id=history.study_id
        WHERE history.source_checksum<>study.source_checksum
          AND NOT (study.study_key='pr-card-sorting-local'
            AND history.source_checksum='4051c10c39a1634aa80d9018aa53b59fd6009fdc4d7f2526d5e73708b02f53ef')
        UNION ALL SELECT 'historical cardinality' FROM public.study_source_membership history
        JOIN public.study ON study.id=history.study_id
        GROUP BY history.study_id,history.source_checksum,study.source_checksum,study.expected_card_count
        HAVING min(history.ordinal)<>0 OR max(history.ordinal)<>count(*)-1
          OR count(*)<>CASE WHEN history.source_checksum=study.source_checksum THEN study.expected_card_count ELSE 300 END
        UNION ALL SELECT 'unbound run source' FROM public.github_enrichment_run run
        WHERE NOT EXISTS (SELECT 1 FROM public.study_source_membership history
            WHERE history.study_id=run.study_id AND history.source_checksum=run.source_checksum)
        UNION ALL SELECT 'incomplete terminal mapping' FROM public.github_enrichment_run run
        WHERE run.state='COMPLETED' AND
            (SELECT count(*) FROM public.github_enrichment_run_card mapping WHERE mapping.run_id=run.id)
            <> (SELECT count(*) FROM public.study_source_membership history
                WHERE history.study_id=run.study_id AND history.source_checksum=run.source_checksum)
        UNION ALL SELECT 'promotion source' FROM public.study_enrichment_promotion promotion
        JOIN public.github_enrichment_run run ON run.id=promotion.run_id
        WHERE run.study_id<>promotion.study_id OR run.source_checksum<>promotion.source_checksum OR run.state<>'COMPLETED'
        UNION ALL SELECT 'page source' FROM public.github_run_page page JOIN public.github_enrichment_run run ON run.id=page.run_id
        WHERE NOT EXISTS (SELECT 1 FROM public.study_source_membership history
            WHERE history.study_id=page.study_id AND history.source_checksum=run.source_checksum AND history.pr_card_id=page.pr_card_id)
        UNION ALL SELECT 'mapping source' FROM public.github_enrichment_run_card mapping
        JOIN public.github_enrichment_run run ON run.id=mapping.run_id
        WHERE NOT EXISTS (SELECT 1 FROM public.study_source_membership history
            WHERE history.study_id=mapping.study_id AND history.source_checksum=run.source_checksum
              AND history.pr_card_id=mapping.pr_card_id AND history.ordinal=mapping.ordinal)
        UNION ALL SELECT 'unbound reference' FROM public.study_card_reference reference
        WHERE NOT EXISTS (SELECT 1 FROM public.study_source_membership history
            WHERE history.study_id=reference.study_id AND history.pr_card_id=reference.pr_card_id)
        LIMIT 1`);
    if (rows.length) throw new Error(`Invalid study source history: ${rows[0].kind}`);
};

export {appendStudySourceMembership, assertStudySourceHistory};
