import HTTPStatus from "./http-status.js";
import {StudyRuntimeError} from "./study-runtime.js";
import {
    createParticipantCategory as createParticipantCategoryInRepository,
    lockParticipantCategory as lockParticipantCategoryInRepository,
    updateParticipantCategory as updateParticipantCategoryInRepository,
} from "./study-write-repository.js";

const normalizeCategoryName = value => value.trim().toLowerCase().replace(/\s+/g, " ");
const CATEGORY_NAME_MAX_LENGTH = 160;

const parseCategoryName = value => {
    if (typeof value !== "string") {
        throw new StudyRuntimeError(HTTPStatus.BAD_REQUEST, "A category name is required");
    }
    const rawName = value.trim();
    if (!rawName || rawName.length > CATEGORY_NAME_MAX_LENGTH) {
        throw new StudyRuntimeError(HTTPStatus.BAD_REQUEST, "A category name is required");
    }
    return {rawName, normalizedName: normalizeCategoryName(rawName)};
};

const createParticipantCategory = (executor, studyId, participantId, rawName, normalizedName) =>
    createParticipantCategoryInRepository(executor, studyId, participantId, rawName, normalizedName);

const lockParticipantCategory = (executor, studyId, participantId, categoryId) =>
    lockParticipantCategoryInRepository(executor, studyId, participantId, categoryId);

const updateParticipantCategory = (executor, studyId, participantId, categoryId, rawName, normalizedName, expectedUpdatedAt) =>
    updateParticipantCategoryInRepository(
        executor,
        studyId,
        participantId,
        categoryId,
        rawName,
        normalizedName,
        expectedUpdatedAt,
    );

export {
    createParticipantCategory,
    lockParticipantCategory,
    normalizeCategoryName,
    parseCategoryName,
    updateParticipantCategory,
};
