import HTTPStatus from "./http-status.js";
import {projectCardV2, projectEnrichedCard} from "./study-card-projection.js";
import {
    findFirstPendingCard,
    findNextPendingCard,
    loadParticipantCategories,
    loadStudyCard,
    loadStudyProgress,
} from "./study-read-repository.js";
import {
    createParticipantCategory,
    createStudyClassification,
    createStudyDiscard,
    findParticipantCategory,
    loadLockedCardState,
    lockParticipantCategory,
    lockStudyCard,
    updateParticipantCategory,
    updateStudyClassification,
} from "./study-write-repository.js";
import {isUuid, StudyRuntimeError} from "./study-runtime.js";
import {withTransaction} from "./transaction.js";

const CATEGORY_NAME_MAX_LENGTH = 160;

const sessionIds = context => {
    if (!context || context.studyId === undefined || context.participantId === undefined) {
        throw new StudyRuntimeError(HTTPStatus.UNAUTHORIZED, "A valid study session is required");
    }
    return {studyId: context.studyId, participantId: context.participantId};
};

const requireUuid = (value, message) => {
    if (!isUuid(value)) throw new StudyRuntimeError(HTTPStatus.BAD_REQUEST, message);
    return value;
};

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

const normalizeRemarks = value => typeof value === "string" && value.trim() ? value.trim() : null;

const normalizeDiscardReason = value => {
    if (value === undefined || value === null) return null;
    if (typeof value !== "string") {
        throw new StudyRuntimeError(HTTPStatus.UNPROCESSABLE_ENTITY, "Discard reason must be text");
    }
    return value.trim() || null;
};

const parseCategoryName = value => {
    if (typeof value !== "string") {
        throw new StudyRuntimeError(HTTPStatus.BAD_REQUEST, "A category name is required");
    }
    const rawName = value.trim();
    if (!rawName || rawName.length > CATEGORY_NAME_MAX_LENGTH) {
        throw new StudyRuntimeError(HTTPStatus.BAD_REQUEST, "A category name is required");
    }
    return {rawName, normalizedName: rawName.toLowerCase().replace(/\s+/g, " ")};
};

const parseExpectedUpdatedAt = value => {
    if (value === undefined) return null;
    if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
        throw new StudyRuntimeError(HTTPStatus.BAD_REQUEST, "A valid category version is required");
    }
    return new Date(value).toISOString();
};

const lockedCard = async (executor, studyId, cardId) => {
    const card = await lockStudyCard(executor, studyId, cardId);
    if (!card) throw new StudyRuntimeError(HTTPStatus.NOT_FOUND, "Card is not part of the READY study");
    if (card.promotion_run_id && (card.promotion_state !== "COMPLETED" || !card.mapped_card_id)) {
        throw new StudyRuntimeError(HTTPStatus.CONFLICT, "The study enrichment promotion is not available for this card");
    }
    return {...card, enrichmentRunId: card.promotion_run_id || null};
};

const lockedCardState = async (executor, {studyId, participantId, cardId}) => {
    const state = await loadLockedCardState(executor, studyId, participantId, cardId);
    return state || {
        classification_id: null,
        revision: null,
        discard_card_id: null,
        discard_reason: null,
    };
};

const projectStudyCard = async (executor, {studyId, participantId, cardId}) => {
    const card = await loadStudyCard(executor, studyId, participantId, cardId);
    if (!card) throw new StudyRuntimeError(HTTPStatus.NOT_FOUND, "Card is not part of the READY study");
    const enrichment = card.enrichment_run_id && card.enrichment_pages ? {
        run_id: card.enrichment_run_id,
        snapshot_checksum: card.enrichment_snapshot_checksum,
        pages: card.enrichment_pages,
    } : null;
    const projected = projectEnrichedCard(card, enrichment);
    return Object.hasOwn(card, "title") ? {...projected, card_v2: projectCardV2(card, enrichment)} : projected;
};

const normalizeProgress = progress => ({
    total: progress?.total || 0,
    classified: progress?.classified || 0,
    discarded: progress?.discarded || 0,
    pending: progress?.pending || 0,
    completed: (progress?.classified || 0) + (progress?.discarded || 0),
});

const rethrowCategoryConflict = error => {
    if (error.code === "23505") {
        throw new StudyRuntimeError(HTTPStatus.CONFLICT, "A category with that name already exists");
    }
    throw error;
};

const createStudyService = ({pool}) => {
    const resolveQueue = async context => {
        const {studyId, participantId} = sessionIds(context);
        return findFirstPendingCard(pool, studyId, participantId);
    };

    const loadProgress = async context => {
        const {studyId, participantId} = sessionIds(context);
        return normalizeProgress(await loadStudyProgress(pool, studyId, participantId));
    };

    const loadReviewCardData = async (context, cardId) => {
        const {studyId, participantId} = sessionIds(context);
        const validCardId = requireUuid(cardId, "A valid card ID is required");
        const [card, categories, progress] = await Promise.all([
            projectStudyCard(pool, {studyId, participantId, cardId: validCardId}),
            loadParticipantCategories(pool, studyId, participantId),
            loadStudyProgress(pool, studyId, participantId),
        ]);
        return {card, categories, progress: normalizeProgress(progress)};
    };

    const createCategory = async (context, {name} = {}) => {
        const {studyId, participantId} = sessionIds(context);
        const {rawName, normalizedName} = parseCategoryName(name);
        try {
            return await createParticipantCategory(pool, studyId, participantId, rawName, normalizedName);
        } catch (error) {
            return rethrowCategoryConflict(error);
        }
    };

    const renameCategory = async (context, categoryId, {name, expectedUpdatedAt} = {}) => {
        const {studyId, participantId} = sessionIds(context);
        const validCategoryId = requireUuid(categoryId, "A valid category ID is required");
        const categoryName = parseCategoryName(name);
        const expectedUpdatedAtValue = parseExpectedUpdatedAt(expectedUpdatedAt);
        try {
            return await withTransaction(pool, async client => {
                const category = await lockParticipantCategory(client, studyId, participantId, validCategoryId);
                if (!category) throw new StudyRuntimeError(HTTPStatus.NOT_FOUND, "Category is not owned by the participant");
                const updated = await updateParticipantCategory(
                    client,
                    studyId,
                    participantId,
                    validCategoryId,
                    categoryName.rawName,
                    categoryName.normalizedName,
                    expectedUpdatedAtValue,
                );
                if (!updated) throw new StudyRuntimeError(HTTPStatus.CONFLICT, "The category version is stale");
                return updated;
            });
        } catch (error) {
            return rethrowCategoryConflict(error);
        }
    };

    const classifyCard = async (context, cardId, {categoryId, expectedRevision, remarks} = {}) => {
        const {studyId, participantId} = sessionIds(context);
        const validCardId = requireUuid(cardId, "A valid card ID is required");
        const validCategoryId = requireUuid(categoryId, "A valid category ID is required");
        const revision = parseExpectedRevision(expectedRevision);
        const normalizedRemarks = normalizeRemarks(remarks);
        return withTransaction(pool, async client => {
            const card = await lockedCard(client, studyId, validCardId);
            const category = await findParticipantCategory(client, studyId, participantId, validCategoryId);
            if (!category) throw new StudyRuntimeError(HTTPStatus.NOT_FOUND, "Category is not owned by the participant");
            const state = await lockedCardState(client, {studyId, participantId, cardId: validCardId});
            const currentRevision = state.classification_id ? Number(state.revision) : 0;
            if (state.discard_card_id) throw new StudyRuntimeError(HTTPStatus.CONFLICT, "A discarded card cannot be classified");
            if (revision !== currentRevision) throw new StudyRuntimeError(HTTPStatus.CONFLICT, "The card revision is stale");
            if (state.classification_id) {
                const {rowCount} = await updateStudyClassification(
                    client,
                    studyId,
                    participantId,
                    validCardId,
                    validCategoryId,
                    normalizedRemarks,
                    revision,
                    card.enrichmentRunId,
                );
                if (rowCount !== 1) throw new StudyRuntimeError(HTTPStatus.CONFLICT, "The card revision is stale");
            } else {
                await createStudyClassification(
                    client,
                    studyId,
                    participantId,
                    validCardId,
                    validCategoryId,
                    normalizedRemarks,
                    card.enrichmentRunId,
                );
            }
            return findNextPendingCard(client, studyId, participantId, card.ordinal);
        });
    };

    const discardCard = async (context, cardId, {expectedRevision, reason} = {}) => {
        const {studyId, participantId} = sessionIds(context);
        const validCardId = requireUuid(cardId, "A valid card ID is required");
        const revision = parseExpectedRevision(expectedRevision);
        const normalizedReason = normalizeDiscardReason(reason);
        return withTransaction(pool, async client => {
            const card = await lockedCard(client, studyId, validCardId);
            const state = await lockedCardState(client, {studyId, participantId, cardId: validCardId});
            const currentRevision = state.classification_id ? Number(state.revision) : 0;
            if (state.classification_id) throw new StudyRuntimeError(HTTPStatus.CONFLICT, "A classified card cannot be discarded");
            if (revision !== currentRevision) throw new StudyRuntimeError(HTTPStatus.CONFLICT, "The card revision is stale");
            if (state.discard_card_id) {
                if (state.discard_reason !== normalizedReason) {
                    throw new StudyRuntimeError(HTTPStatus.CONFLICT, "The discard reason does not match the saved replay");
                }
            } else {
                await createStudyDiscard(client, studyId, participantId, validCardId, normalizedReason, card.enrichmentRunId);
            }
            return findNextPendingCard(client, studyId, participantId, card.ordinal);
        });
    };

    return {classifyCard, createCategory, discardCard, loadProgress, loadReviewCardData, renameCategory, resolveQueue};
};

export {createStudyService};
