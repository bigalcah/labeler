import HTTPStatus from "../../util/http-status.js";
import {parseCategoryName} from "../../util/category.js";
import {requireStudySession, respondWithStudyRuntimeError} from "../../util/study-runtime.js";

export const post = async (req, res) => {
    const context = requireStudySession(req, res);
    if (!context) return;

    const pool = req.app.locals.dependencies.pool;
    try {
        const {rawName, normalizedName} = parseCategoryName(req.body?.name);
        const {rows: [ category ]} = await pool.query(
            `INSERT INTO participant_category(study_id, participant_id, raw_name, normalized_name)
             VALUES ($1, $2, $3, $4)
             RETURNING id, raw_name, updated_at`,
            [ context.studyId, context.participantId, rawName, normalizedName ],
        );
        res.status(HTTPStatus.CREATED).json(category);
    } catch (error) {
        if (error.code === "23505") {
            res.status(HTTPStatus.CONFLICT).end();
            return;
        }
        if (respondWithStudyRuntimeError(res, error)) return;
        throw error;
    }
};
