import HTTPStatus from "../../../util/http-status.js";
import {parseCategoryName} from "../../../util/category.js";
import {withTransaction} from "../../../util/transaction.js";
import {
    isUuid,
    requireStudySession,
    respondWithStudyRuntimeError,
    StudyRuntimeError,
} from "../../../util/study-runtime.js";

const parseExpectedUpdatedAt = value => {
    if (value === undefined) return null;
    if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
        throw new StudyRuntimeError(HTTPStatus.BAD_REQUEST, "A valid category version is required");
    }
    return new Date(value).toISOString();
};

export const patch = async (req, res) => {
    const context = requireStudySession(req, res);
    if (!context) return;

    const categoryId = req.params.id;
    if (!isUuid(categoryId)) {
        res.status(HTTPStatus.BAD_REQUEST).end();
        return;
    }

    let categoryName;
    let expectedUpdatedAt;
    try {
        categoryName = parseCategoryName(req.body?.name);
        expectedUpdatedAt = parseExpectedUpdatedAt(req.body?.expected_updated_at);
    } catch (error) {
        if (!respondWithStudyRuntimeError(res, error)) throw error;
        return;
    }

    const pool = req.app.locals.dependencies.pool;
    try {
        const category = await withTransaction(pool, async client => {
            const {rows: [ownedCategory]} = await client.query(
                `SELECT id, updated_at
                 FROM participant_category
                 WHERE id = $1
                   AND participant_id = $2
                 FOR UPDATE`,
                [categoryId, context.participantId],
            );
            if (!ownedCategory) {
                throw new StudyRuntimeError(HTTPStatus.NOT_FOUND, "Category is not owned by the participant");
            }

            const {rows: [updatedCategory]} = await client.query(
                `UPDATE participant_category
                 SET raw_name = $3,
                     normalized_name = $4,
                     updated_at = clock_timestamp()
                 WHERE id = $1
                   AND participant_id = $2
                   AND ($5::timestamptz IS NULL OR updated_at = $5::timestamptz)
                 RETURNING id, raw_name, updated_at`,
                [categoryId, context.participantId, categoryName.rawName, categoryName.normalizedName, expectedUpdatedAt],
            );
            if (!updatedCategory) {
                throw new StudyRuntimeError(HTTPStatus.CONFLICT, "The category version is stale");
            }
            return updatedCategory;
        });
        res.status(HTTPStatus.OK).json(category);
    } catch (error) {
        if (error.code === "23505") {
            res.status(HTTPStatus.CONFLICT).end();
            return;
        }
        if (!respondWithStudyRuntimeError(res, error)) throw error;
    }
};
