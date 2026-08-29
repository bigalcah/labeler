import HTTPStatus from "./http-status.js";
import {StudyRuntimeError} from "./study-runtime.js";

const parseExpectedRevision = value => {
    const isInteger = typeof value === "number"
        ? Number.isSafeInteger(value) && value >= 0
        : typeof value === "string" && /^\d+$/.test(value);
    if (!isInteger) {
        throw new StudyRuntimeError(HTTPStatus.BAD_REQUEST, "A valid expected revision is required");
    }
    const revision = Number(value);
    if (!Number.isSafeInteger(revision) || revision < 0) {
        throw new StudyRuntimeError(HTTPStatus.BAD_REQUEST, "A valid expected revision is required");
    }
    return revision;
};

const normalizeDiscardReason = value => {
    if (value === undefined || value === null) return null;
    if (typeof value !== "string") {
        throw new StudyRuntimeError(HTTPStatus.UNPROCESSABLE_ENTITY, "Discard reason must be text");
    }
    const reason = value.trim();
    return reason || null;
};

const normalizeRemarks = value => {
    if (value === undefined || value === null) return null;
    if (typeof value !== "string") return null;
    const remarks = value.trim();
    return remarks || null;
};

const lockStudyCard = async (executor, studyId, cardId) => {
    const {rows: [ card ]} = await executor.query(
        `SELECT study_card.pr_card_id, study_card.ordinal,
                promotion.run_id AS promotion_run_id,
                run.state AS promotion_state,
                run_card.pr_card_id AS mapped_card_id
         FROM study_card
         LEFT JOIN study_enrichment_promotion promotion
             ON promotion.study_id = study_card.study_id
         LEFT JOIN github_enrichment_run run
             ON run.id = promotion.run_id
            AND run.study_id = study_card.study_id
         LEFT JOIN github_enrichment_run_card run_card
             ON run_card.run_id = promotion.run_id
            AND run_card.study_id = study_card.study_id
            AND run_card.pr_card_id = study_card.pr_card_id
         WHERE study_card.study_id = $1
           AND study_card.pr_card_id = $2
          FOR UPDATE OF study_card`,
        [ studyId, cardId ],
    );
    if (!card) {
        throw new StudyRuntimeError(HTTPStatus.NOT_FOUND, "Card is not part of the READY study");
    }
    if (card.promotion_run_id && (card.promotion_state !== "COMPLETED" || !card.mapped_card_id)) {
        throw new StudyRuntimeError(HTTPStatus.CONFLICT, "The study enrichment promotion is not available for this card");
    }
    return {...card, enrichment_run_id: card.promotion_run_id || null};
};

const readLockedCardState = async (executor, studyId, participantId, cardId) => {
    const {rows: [ state ]} = await executor.query(
        `SELECT classification.id AS classification_id,
                classification.category_id,
                classification.remarks,
                classification.revision,
                discard.pr_card_id AS discard_card_id,
                discard.reason AS discard_reason
         FROM study_card
         LEFT JOIN pr_classification classification
             ON classification.pr_card_id = study_card.pr_card_id
            AND classification.study_id = study_card.study_id
            AND classification.participant_id = $2
         LEFT JOIN pr_discard discard
             ON discard.pr_card_id = study_card.pr_card_id
            AND discard.study_id = study_card.study_id
            AND discard.participant_id = $2
         WHERE study_card.study_id = $1
           AND study_card.pr_card_id = $3`,
        [ studyId, participantId, cardId ],
    );
    return state || {
        classification_id: null,
        category_id: null,
        remarks: null,
        revision: null,
        discard_card_id: null,
        discard_reason: null,
    };
};

const assertParticipantCategory = async (executor, participantId, categoryId) => {
    const {rows: [ category ]} = await executor.query(
        `SELECT id
         FROM participant_category
         WHERE id = $1
           AND participant_id = $2`,
        [ categoryId, participantId ],
    );
    if (!category) {
        throw new StudyRuntimeError(HTTPStatus.NOT_FOUND, "Category is not owned by the participant");
    }
    return category;
};

export {
    assertParticipantCategory,
    lockStudyCard,
    normalizeDiscardReason,
    normalizeRemarks,
    parseExpectedRevision,
    readLockedCardState,
};
