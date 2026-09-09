import HTTPStatus from "./http-status.js";
import {projectCardV2, projectEnrichedCard} from "./study-card-projection.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

class StudyRuntimeError extends Error {
    constructor(status, message) {
        super(message);
        this.name = "StudyRuntimeError";
        this.status = status;
    }
}

const isUuid = value => typeof value === "string" && UUID_PATTERN.test(value);

const requireStudySession = (req, res) => {
    const context = req.sessionContext;
    if (!context || context.studyId === undefined || context.participantId === undefined) {
        res.status(HTTPStatus.UNAUTHORIZED).end();
        return null;
    }
    return context;
};

const sessionParticipant = context => ({name: context.participantKey || "Participant"});

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
                (
                    COUNT(study_card.pr_card_id)
                    - COUNT(classification.pr_card_id)
                    - COUNT(discard.pr_card_id)
                )::INTEGER AS pending
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
    return {
        total: progress?.total || 0,
        classified: progress?.classified || 0,
        discarded: progress?.discarded || 0,
        pending: progress?.pending || 0,
        completed: (progress?.classified || 0) + (progress?.discarded || 0),
    };
};

const cardSelect = `
    SELECT card.*,
           study_card.ordinal,
           CASE
               WHEN classification.id IS NOT NULL THEN 'CLASSIFIED'
               WHEN discard.pr_card_id IS NOT NULL THEN 'DISCARDED'
               ELSE 'PENDING'
           END AS status,
           classification.category_id,
           classification.remarks,
           classification.revision,
           classification.classified_at,
           classification.updated_at,
           category.raw_name AS own_category,
           discard.reason AS discard_reason,
           discard.discarded_at,
           promotion.run_id AS enrichment_run_id,
           run_card.snapshot_checksum AS enrichment_snapshot_checksum,
           page_data.pages AS enrichment_pages,
           (
               SELECT previous_card.pr_card_id
               FROM study_card previous_card
               WHERE previous_card.study_id = study_card.study_id
                 AND previous_card.ordinal < study_card.ordinal
               ORDER BY previous_card.ordinal DESC
               LIMIT 1
           ) AS previous_card_id,
           (
               SELECT next_card.pr_card_id
               FROM study_card next_card
               WHERE next_card.study_id = study_card.study_id
                 AND next_card.ordinal > study_card.ordinal
               ORDER BY next_card.ordinal
               LIMIT 1
           ) AS next_card_id
    FROM study_card
    INNER JOIN pr_cards card
        ON card.id = study_card.pr_card_id
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
    LEFT JOIN study_enrichment_promotion promotion
        ON promotion.study_id = study_card.study_id
    LEFT JOIN github_enrichment_run_card run_card
        ON run_card.run_id = promotion.run_id
       AND run_card.study_id = study_card.study_id
       AND run_card.pr_card_id = study_card.pr_card_id
    LEFT JOIN github_enrichment_run run
        ON run.id = promotion.run_id
       AND run.study_id = study_card.study_id
       AND run.state = 'COMPLETED'
    LEFT JOIN LATERAL (
        SELECT jsonb_agg(jsonb_build_object(
                   'endpoint', page.endpoint,
                   'status', page.state,
                   'normalized_payload', page.normalized_payload
               ) ORDER BY page.endpoint, page.page_ordinal) AS pages
        FROM github_run_page page
        WHERE page.run_id = run.id
          AND page.study_id = study_card.study_id
          AND page.pr_card_id = study_card.pr_card_id
          AND run_card.pr_card_id IS NOT NULL
    ) page_data ON TRUE
    WHERE study_card.study_id = $1
      AND study_card.pr_card_id = $3`;

const loadStudyCard = async (executor, studyId, participantId, cardId) => {
    const {rows: [ card ]} = await executor.query(cardSelect, [ studyId, participantId, cardId ]);
    if (!card) {
        throw new StudyRuntimeError(HTTPStatus.NOT_FOUND, "Card is not part of the READY study");
    }
    const enrichment = card.enrichment_run_id && card.enrichment_pages ? {
        run_id: card.enrichment_run_id,
        snapshot_checksum: card.enrichment_snapshot_checksum,
        pages: card.enrichment_pages,
    } : null;
    const projected = projectEnrichedCard(card, enrichment);
    return Object.hasOwn(card, "title") ? {...projected, card_v2: projectCardV2(card, enrichment)} : projected;
};

const findFirstPendingCard = async (executor, studyId, participantId) => {
    const {rows: [ card ]} = await executor.query(
        `SELECT study_card.pr_card_id AS id
         FROM study_card
         WHERE study_card.study_id = $1
           AND NOT EXISTS (
               SELECT 1
               FROM pr_classification classification
               WHERE classification.pr_card_id = study_card.pr_card_id
                 AND classification.study_id = study_card.study_id
                 AND classification.participant_id = $2
           )
           AND NOT EXISTS (
               SELECT 1
               FROM pr_discard discard
               WHERE discard.pr_card_id = study_card.pr_card_id
                 AND discard.study_id = study_card.study_id
                 AND discard.participant_id = $2
           )
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
           AND NOT EXISTS (
               SELECT 1
               FROM pr_classification classification
               WHERE classification.pr_card_id = study_card.pr_card_id
                 AND classification.study_id = study_card.study_id
                 AND classification.participant_id = $2
           )
           AND NOT EXISTS (
               SELECT 1
               FROM pr_discard discard
               WHERE discard.pr_card_id = study_card.pr_card_id
                 AND discard.study_id = study_card.study_id
                 AND discard.participant_id = $2
           )
         ORDER BY CASE WHEN study_card.ordinal > $3 THEN 0 ELSE 1 END,
                  study_card.ordinal
         LIMIT 1`,
        [ studyId, participantId, ordinal ],
    );
    return card?.id || null;
};

const addCardDates = card => ({
    ...card,
    dates: card.dates || {
        created_at: card.created_at_source,
        closed_at: card.closed_at_source,
        merged_at: card.merged_at_source,
    },
});

const respondWithStudyRuntimeError = (res, error) => {
    if (!(error instanceof StudyRuntimeError)) return false;
    res.status(error.status).end();
    return true;
};

export {
    StudyRuntimeError,
    addCardDates,
    findFirstPendingCard,
    findNextPendingCard,
    isUuid,
    loadParticipantCategories,
    loadStudyCard,
    loadStudyProgress,
    requireStudySession,
    respondWithStudyRuntimeError,
    sessionParticipant,
};
