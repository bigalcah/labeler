const loadParticipantCategories = async (executor, studyId, participantId) => {
    const {rows} = await executor.query(
        `SELECT id, raw_name, updated_at
         FROM participant_category
         WHERE study_id = $1
           AND participant_id = $2
         ORDER BY raw_name`,
        [ studyId, participantId ],
    );
    return rows;
};

const loadStudyProgress = async (executor, studyId, participantId) => {
    const {rows: [ progress ]} = await executor.query(
        `SELECT COUNT(study_card.pr_card_id)::INTEGER AS total,
                COUNT(classification.pr_card_id)::INTEGER AS classified,
                COUNT(discard.pr_card_id)::INTEGER AS discarded,
                (COUNT(study_card.pr_card_id) - COUNT(classification.pr_card_id) - COUNT(discard.pr_card_id))::INTEGER AS pending
         FROM study_card
         LEFT JOIN pr_classification classification
             ON classification.pr_card_id = study_card.pr_card_id
            AND classification.study_id = study_card.study_id
            AND classification.participant_id = $2
         LEFT JOIN pr_discard discard
             ON discard.pr_card_id = study_card.pr_card_id
            AND discard.study_id = study_card.study_id
            AND discard.participant_id = $2
         WHERE study_card.study_id = $1`,
        [ studyId, participantId ],
    );
    return progress;
};

const DEFAULT_PROGRESS_PAGE = 1;
const DEFAULT_PROGRESS_LIMIT = 20;
const MAX_PROGRESS_LIMIT = 100;

const parsePositiveIntegerParameter = value => {
    if (typeof value === "number") {
        return Number.isSafeInteger(value) && value > 0 ? value : null;
    }
    if (typeof value === "string" && /^\d+$/.test(value.trim())) {
        const parsed = Number(value.trim());
        return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
    }
    return null;
};

const normalizeProgressQuery = ({page, limit} = {}) => {
    const normalizedPage = parsePositiveIntegerParameter(page) ?? DEFAULT_PROGRESS_PAGE;
    const requestedLimit = parsePositiveIntegerParameter(limit) ?? DEFAULT_PROGRESS_LIMIT;
    const normalizedLimit = Math.min(requestedLimit, MAX_PROGRESS_LIMIT);
    return {page: normalizedPage, limit: normalizedLimit, offset: (normalizedPage - 1) * normalizedLimit};
};

const loadStudyCardPage = async (executor, studyId, participantId, {page, limit, offset}) => {
    const [totals, pageRows] = await Promise.all([
        executor.query(
            `SELECT COUNT(*)::INTEGER AS total
             FROM study_card
             WHERE study_card.study_id = $1`,
            [ studyId ],
        ),
        executor.query(
            `SELECT study_card.pr_card_id AS id,
                    study_card.ordinal,
                    card.title,
                    card.html_url,
                    CASE WHEN classification.id IS NOT NULL THEN 'CLASSIFIED'
                         WHEN discard.pr_card_id IS NOT NULL THEN 'DISCARDED'
                         ELSE 'PENDING' END AS status,
                    category.raw_name AS own_category,
                    discard.reason AS discard_reason
             FROM study_card
             INNER JOIN pr_cards card ON card.id = study_card.pr_card_id
             LEFT JOIN pr_classification classification
                 ON classification.pr_card_id = study_card.pr_card_id
                AND classification.study_id = study_card.study_id
                AND classification.participant_id = $2
             LEFT JOIN pr_discard discard
                 ON discard.pr_card_id = study_card.pr_card_id
                AND discard.study_id = study_card.study_id
                AND discard.participant_id = $2
             LEFT JOIN participant_category category
                 ON category.id = classification.category_id
                AND category.study_id = study_card.study_id
                AND category.participant_id = $2
             WHERE study_card.study_id = $1
             ORDER BY study_card.ordinal
             LIMIT $3 OFFSET $4`,
            [ studyId, participantId, limit, offset ],
        ),
    ]);
    const total = totals.rows[0].total;
    return {
        rows: pageRows.rows,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
    };
};

const loadParticipantCategorySummary = async (executor, studyId, participantId) => {
    const {rows} = await executor.query(
        `SELECT category.id,
                category.raw_name,
                COUNT(card.pr_card_id)::INTEGER AS total,
                COALESCE(
                    jsonb_agg(
                        jsonb_build_object(
                            'id', card.pr_card_id,
                            'ordinal', card.ordinal,
                            'title', pr_card.title,
                            'html_url', pr_card.html_url
                        ) ORDER BY card.ordinal
                    ) FILTER (WHERE card.pr_card_id IS NOT NULL),
                    '[]'::JSONB
                ) AS cards
         FROM participant_category category
         LEFT JOIN pr_classification classification
             ON classification.category_id = category.id
            AND classification.study_id = category.study_id
            AND classification.participant_id = category.participant_id
         LEFT JOIN study_card card
             ON card.pr_card_id = classification.pr_card_id
            AND card.study_id = classification.study_id
         LEFT JOIN pr_cards pr_card ON pr_card.id = card.pr_card_id
         WHERE category.study_id = $1
           AND category.participant_id = $2
         GROUP BY category.id, category.raw_name
         ORDER BY category.raw_name`,
        [ studyId, participantId ],
    );
    return rows.map(row => ({
        id: row.id,
        raw_name: row.raw_name,
        total: row.total,
        cards: row.cards,
    }));
};

const loadStudyCard = async (executor, studyId, participantId, cardId) => {
    const {rows: [ card ]} = await executor.query(
        `SELECT card.*, study_card.ordinal,
                CASE WHEN classification.id IS NOT NULL THEN 'CLASSIFIED'
                     WHEN discard.pr_card_id IS NOT NULL THEN 'DISCARDED'
                     ELSE 'PENDING' END AS status,
                classification.category_id, classification.remarks, classification.revision,
                classification.classified_at, classification.updated_at, category.raw_name AS own_category,
                discard.reason AS discard_reason, discard.discarded_at,
                promotion.run_id AS enrichment_run_id, run_card.snapshot_checksum AS enrichment_snapshot_checksum,
                page_data.pages AS enrichment_pages,
                (SELECT previous_card.pr_card_id FROM study_card previous_card
                 WHERE previous_card.study_id = study_card.study_id AND previous_card.ordinal < study_card.ordinal
                 ORDER BY previous_card.ordinal DESC LIMIT 1) AS previous_card_id,
                (SELECT next_card.pr_card_id FROM study_card next_card
                 WHERE next_card.study_id = study_card.study_id AND next_card.ordinal > study_card.ordinal
                 ORDER BY next_card.ordinal LIMIT 1) AS next_card_id
         FROM study_card
         INNER JOIN pr_cards card ON card.id = study_card.pr_card_id
         LEFT JOIN pr_classification classification
             ON classification.pr_card_id = study_card.pr_card_id
            AND classification.study_id = study_card.study_id
            AND classification.participant_id = $2
         LEFT JOIN pr_discard discard
             ON discard.pr_card_id = study_card.pr_card_id
            AND discard.study_id = study_card.study_id
            AND discard.participant_id = $2
         LEFT JOIN participant_category category
             ON category.id = classification.category_id
            AND category.study_id = study_card.study_id
            AND category.participant_id = $2
         LEFT JOIN study_enrichment_promotion promotion ON promotion.study_id = study_card.study_id
         LEFT JOIN github_enrichment_run_card run_card
             ON run_card.run_id = promotion.run_id
            AND run_card.study_id = study_card.study_id
            AND run_card.pr_card_id = study_card.pr_card_id
         LEFT JOIN github_enrichment_run run
             ON run.id = promotion.run_id
            AND run.study_id = study_card.study_id
            AND run.state = 'COMPLETED'
         LEFT JOIN LATERAL (
             SELECT jsonb_agg(jsonb_build_object('endpoint', page.endpoint, 'status', page.state,
                        'normalized_payload', page.normalized_payload) ORDER BY page.endpoint, page.page_ordinal) AS pages
             FROM github_run_page page
             WHERE page.run_id = run.id AND page.study_id = study_card.study_id
               AND page.pr_card_id = study_card.pr_card_id AND run_card.pr_card_id IS NOT NULL
         ) page_data ON TRUE
         WHERE study_card.study_id = $1 AND study_card.pr_card_id = $3`,
        [ studyId, participantId, cardId ],
    );
    return card;
};

const findFirstPendingCard = async (executor, studyId, participantId) => {
    const {rows: [ card ]} = await executor.query(
        `SELECT study_card.pr_card_id AS id
         FROM study_card
         WHERE study_card.study_id = $1
           AND NOT EXISTS (SELECT 1 FROM pr_classification classification
                           WHERE classification.pr_card_id = study_card.pr_card_id
                             AND classification.study_id = study_card.study_id AND classification.participant_id = $2)
           AND NOT EXISTS (SELECT 1 FROM pr_discard discard
                           WHERE discard.pr_card_id = study_card.pr_card_id
                             AND discard.study_id = study_card.study_id AND discard.participant_id = $2)
         ORDER BY study_card.ordinal
         LIMIT 1`,
        [ studyId, participantId ],
    );
    return card?.id || null;
};

const findNextPendingCard = async (executor, studyId, participantId, ordinal) => {
    const {rows: [ card ]} = await executor.query(
        `SELECT study_card.pr_card_id AS id
         FROM study_card
         WHERE study_card.study_id = $1
           AND NOT EXISTS (SELECT 1 FROM pr_classification classification
                           WHERE classification.pr_card_id = study_card.pr_card_id
                             AND classification.study_id = study_card.study_id AND classification.participant_id = $2)
           AND NOT EXISTS (SELECT 1 FROM pr_discard discard
                           WHERE discard.pr_card_id = study_card.pr_card_id
                             AND discard.study_id = study_card.study_id AND discard.participant_id = $2)
         ORDER BY CASE WHEN study_card.ordinal > $3 THEN 0 ELSE 1 END,
                  study_card.ordinal
         LIMIT 1`,
        [ studyId, participantId, ordinal ],
    );
    return card?.id || null;
};

export {
    findFirstPendingCard,
    findNextPendingCard,
    loadParticipantCategories,
    loadParticipantCategorySummary,
    loadStudyCard,
    loadStudyCardPage,
    loadStudyProgress,
    normalizeProgressQuery,
};
