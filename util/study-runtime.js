import HTTPStatus from "./http-status.js";
import {projectCardV2, projectEnrichedCard} from "./study-card-projection.js";
import {
    findFirstPendingCard as findFirstPendingCardInRepository,
    findNextPendingCard as findNextPendingCardInRepository,
    loadParticipantCategories as loadParticipantCategoriesInRepository,
    loadStudyCard as loadStudyCardInRepository,
    loadStudyProgress as loadStudyProgressInRepository,
} from "./study-read-repository.js";

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
    return loadParticipantCategoriesInRepository(executor, studyId, participantId);
};

const loadStudyProgress = async (executor, studyId, participantId) => {
    const progress = await loadStudyProgressInRepository(executor, studyId, participantId);
    return {
        total: progress?.total || 0,
        classified: progress?.classified || 0,
        discarded: progress?.discarded || 0,
        pending: progress?.pending || 0,
        completed: (progress?.classified || 0) + (progress?.discarded || 0),
    };
};

const loadStudyCard = async (executor, studyId, participantId, cardId) => {
    const card = await loadStudyCardInRepository(executor, studyId, participantId, cardId);
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
    return findFirstPendingCardInRepository(executor, studyId, participantId);
};

const findNextPendingCard = async (executor, studyId, participantId, ordinal) => {
    return findNextPendingCardInRepository(executor, studyId, participantId, ordinal);
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
