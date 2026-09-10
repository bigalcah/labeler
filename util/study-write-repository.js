const createParticipantCategory = async (executor, studyId, participantId, rawName, normalizedName) => {
    const {rows: [ category ]} = await executor.query(
        `INSERT INTO participant_category(study_id, participant_id, raw_name, normalized_name)
         VALUES ($1, $2, $3, $4) RETURNING id, raw_name, updated_at`,
        [ studyId, participantId, rawName, normalizedName ],
    );
    return category;
};

const lockParticipantCategory = async (executor, studyId, participantId, categoryId) => {
    const {rows: [ category ]} = await executor.query(
        `SELECT id, updated_at FROM participant_category
         WHERE id = $1 AND study_id = $2 AND participant_id = $3 FOR UPDATE`,
        [ categoryId, studyId, participantId ],
    );
    return category;
};

const updateParticipantCategory = async (executor, studyId, participantId, categoryId, rawName, normalizedName, expectedUpdatedAt) => {
    const {rows: [ category ]} = await executor.query(
        `UPDATE participant_category SET raw_name = $4, normalized_name = $5, updated_at = clock_timestamp()
         WHERE id = $1 AND study_id = $2 AND participant_id = $3
           AND ($6::timestamptz IS NULL OR updated_at = $6::timestamptz)
         RETURNING id, raw_name, updated_at`,
        [ categoryId, studyId, participantId, rawName, normalizedName, expectedUpdatedAt ],
    );
    return category;
};

const lockStudyCard = async (executor, studyId, cardId) => {
    const {rows: [ card ]} = await executor.query(
        `SELECT study_card.pr_card_id, study_card.ordinal, promotion.run_id AS promotion_run_id,
                run.state AS promotion_state, run_card.pr_card_id AS mapped_card_id
         FROM study_card
         LEFT JOIN study_enrichment_promotion promotion ON promotion.study_id = study_card.study_id
         LEFT JOIN github_enrichment_run run ON run.id = promotion.run_id AND run.study_id = study_card.study_id
         LEFT JOIN github_enrichment_run_card run_card
             ON run_card.run_id = promotion.run_id AND run_card.study_id = study_card.study_id
            AND run_card.pr_card_id = study_card.pr_card_id
         WHERE study_card.study_id = $1 AND study_card.pr_card_id = $2 FOR UPDATE OF study_card`,
        [ studyId, cardId ],
    );
    return card;
};

const loadLockedCardState = async (executor, studyId, participantId, cardId) => {
    const {rows: [ state ]} = await executor.query(
        `SELECT classification.id AS classification_id, classification.category_id, classification.remarks,
                classification.revision, discard.pr_card_id AS discard_card_id, discard.reason AS discard_reason
         FROM study_card
         LEFT JOIN pr_classification classification
             ON classification.pr_card_id = study_card.pr_card_id AND classification.study_id = study_card.study_id
            AND classification.participant_id = $2
         LEFT JOIN pr_discard discard
             ON discard.pr_card_id = study_card.pr_card_id AND discard.study_id = study_card.study_id
            AND discard.participant_id = $2
         WHERE study_card.study_id = $1 AND study_card.pr_card_id = $3`,
        [ studyId, participantId, cardId ],
    );
    return state;
};

const findParticipantCategory = async (executor, studyId, participantId, categoryId) => {
    const {rows: [ category ]} = await executor.query(
        "SELECT id FROM participant_category WHERE id = $1 AND study_id = $2 AND participant_id = $3",
        [ categoryId, studyId, participantId ],
    );
    return category;
};

const updateStudyClassification = (executor, studyId, participantId, cardId, categoryId, remarks, expectedRevision, enrichmentRunId) => executor.query(
    `UPDATE pr_classification SET category_id = $3, remarks = $4, revision = revision + 1, updated_at = NOW(),
         study_id = $6, enrichment_run_id = $7
     WHERE pr_card_id = $1 AND participant_id = $2 AND study_id = $6 AND revision = $5`,
    [ cardId, participantId, categoryId, remarks, expectedRevision, studyId, enrichmentRunId ],
);

const createStudyClassification = (executor, studyId, participantId, cardId, categoryId, remarks, enrichmentRunId) => executor.query(
    `INSERT INTO pr_classification(pr_card_id, participant_id, category_id, remarks, revision, study_id, enrichment_run_id)
     VALUES ($1, $2, $3, $4, 1, $5, $6)`,
    [ cardId, participantId, categoryId, remarks, studyId, enrichmentRunId ],
);

const createStudyDiscard = (executor, studyId, participantId, cardId, reason, enrichmentRunId) => executor.query(
    "INSERT INTO pr_discard(pr_card_id, participant_id, reason, study_id, enrichment_run_id) VALUES ($1, $2, $3, $4, $5)",
    [ cardId, participantId, reason, studyId, enrichmentRunId ],
);

export {
    createParticipantCategory, createStudyClassification, createStudyDiscard, findParticipantCategory,
    loadLockedCardState, lockParticipantCategory, lockStudyCard, updateParticipantCategory, updateStudyClassification,
};
