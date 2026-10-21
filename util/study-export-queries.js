const STUDY_EXPORT_COMPARISON_ROWS_SQL = `/* study-export:comparison-rows */
         WITH promoted_metadata AS (
             SELECT DISTINCT ON (page.run_id, page.pr_card_id)
                    page.run_id, page.pr_card_id,
                    page.normalized_payload ->> 'html_url' AS promoted_html_url
             FROM github_run_page page
             WHERE page.study_id = $1 AND page.endpoint = 'metadata'
               AND page.state IN ('COMPLETE', 'COMPLETE_EMPTY')
             ORDER BY page.run_id, page.pr_card_id, page.page_ordinal DESC
         )
         SELECT participant.reviewer_id AS participant_id,
                participant.ordinal AS participant_ordinal,
                card.ordinal AS card_ordinal,
                card.source_card_id,
                source_card.html_url AS source_html_url,
                metadata.promoted_html_url,
                CASE WHEN classification.id IS NOT NULL THEN 'CLASSIFIED'
                     WHEN discard.pr_card_id IS NOT NULL THEN 'DISCARDED'
                     ELSE 'PENDING' END AS decision,
                classification.category_id,
                category.id AS valid_category_id,
                category.raw_name AS category_name,
                category.definition AS category_definition,
                classification.remarks AS classification_remarks
         FROM study_participant participant
         INNER JOIN study_card card ON card.study_id = participant.study_id
         INNER JOIN pr_cards source_card ON source_card.id = card.pr_card_id
             AND source_card.source_card_id = card.source_card_id
         LEFT JOIN pr_classification classification
             ON classification.study_id = participant.study_id
            AND classification.pr_card_id = card.pr_card_id
            AND classification.participant_id = participant.reviewer_id
         LEFT JOIN participant_category category
             ON category.id = classification.category_id
            AND category.study_id = participant.study_id
            AND category.participant_id = participant.reviewer_id
         LEFT JOIN pr_discard discard
             ON discard.study_id = participant.study_id
            AND discard.pr_card_id = card.pr_card_id
            AND discard.participant_id = participant.reviewer_id
         LEFT JOIN study_enrichment_promotion promotion ON promotion.study_id = participant.study_id
            AND promotion.source_checksum = (SELECT source_checksum FROM study WHERE id = participant.study_id)
            AND EXISTS (SELECT 1 FROM github_enrichment_run source_run WHERE source_run.id = promotion.run_id
                AND source_run.study_id = promotion.study_id AND source_run.source_checksum = promotion.source_checksum
                AND source_run.state = 'COMPLETED')
         LEFT JOIN promoted_metadata metadata
             ON metadata.run_id = promotion.run_id AND metadata.pr_card_id = card.pr_card_id
         WHERE participant.study_id = $1 AND participant.reviewer_id = ANY($2::INTEGER[])
         ORDER BY participant.ordinal, card.ordinal`;

export {STUDY_EXPORT_COMPARISON_ROWS_SQL};
