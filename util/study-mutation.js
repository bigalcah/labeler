import HTTPStatus from "./http-status.js";
import {StudyRuntimeError} from "./study-runtime.js";
import {
    createStudyClassification,
    createStudyDiscard,
    findParticipantCategory,
    loadLockedCardState,
    lockStudyCard as lockStudyCardInRepository,
    updateStudyClassification,
} from "./study-write-repository.js";

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
    const card = await lockStudyCardInRepository(executor, studyId, cardId);
    if (!card) {
        throw new StudyRuntimeError(HTTPStatus.NOT_FOUND, "Card is not part of the READY study");
    }
    if (card.promotion_run_id && (card.promotion_state !== "COMPLETED" || !card.mapped_card_id)) {
        throw new StudyRuntimeError(HTTPStatus.CONFLICT, "The study enrichment promotion is not available for this card");
    }
    return {...card, enrichment_run_id: card.promotion_run_id || null};
};

const readLockedCardState = async (executor, studyId, participantId, cardId) => {
    const state = await loadLockedCardState(executor, studyId, participantId, cardId);
    return state || {
        classification_id: null,
        category_id: null,
        remarks: null,
        revision: null,
        discard_card_id: null,
        discard_reason: null,
    };
};

const assertParticipantCategory = async (executor, context, categoryId) => {
    const category = await findParticipantCategory(executor, context.studyId, context.participantId, categoryId);
    if (!category) {
        throw new StudyRuntimeError(HTTPStatus.NOT_FOUND, "Category is not owned by the participant");
    }
    return category;
};

const updateParticipantClassification = (
    executor,
    studyId,
    participantId,
    cardId,
    categoryId,
    remarks,
    expectedRevision,
    enrichmentRunId,
) => updateStudyClassification(
    executor,
    studyId,
    participantId,
    cardId,
    categoryId,
    remarks,
    expectedRevision,
    enrichmentRunId,
);

const createParticipantClassification = (executor, studyId, participantId, cardId, categoryId, remarks, enrichmentRunId) =>
    createStudyClassification(executor, studyId, participantId, cardId, categoryId, remarks, enrichmentRunId);

const createParticipantDiscard = (executor, studyId, participantId, cardId, reason, enrichmentRunId) =>
    createStudyDiscard(executor, studyId, participantId, cardId, reason, enrichmentRunId);

export {
    assertParticipantCategory,
    createParticipantClassification,
    createParticipantDiscard,
    lockStudyCard,
    normalizeDiscardReason,
    normalizeRemarks,
    parseExpectedRevision,
    readLockedCardState,
    updateParticipantClassification,
};
