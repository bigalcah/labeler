import HTTPStatus from "./http-status.js";
import {StudyRuntimeError} from "./study-runtime.js";

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

export {normalizeCategoryName, parseCategoryName};
