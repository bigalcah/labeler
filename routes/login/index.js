import HTTPStatus from "../../util/http-status.js";
import {respondWithStudyRuntimeError, resolveReadyStudy} from "../../util/study-runtime.js";

export const get = async (req, res) => {
    const pool = req.app.locals.dependencies.pool;
    try {
        const study = await resolveReadyStudy(pool);
        const {rows: reviewers} = await pool.query(
            `SELECT reviewer.id, reviewer.name
             FROM study_participant
             INNER JOIN reviewer ON reviewer.id = study_participant.reviewer_id
             WHERE study_participant.study_id = $1
             ORDER BY study_participant.ordinal`,
            [ study.id ],
        );
        res.render("login", {reviewers});
    } catch (error) {
        if (!respondWithStudyRuntimeError(res, error)) throw error;
    }
};

export const post = async (req, res) => {
    const pool = req.app.locals.dependencies.pool;
    try {
        const study = await resolveReadyStudy(pool);
        const {rows: [ participant ]} = await pool.query(
            `SELECT reviewer.name
             FROM study_participant
             INNER JOIN reviewer ON reviewer.id = study_participant.reviewer_id
             WHERE study_participant.study_id = $1
               AND reviewer.id = $2`,
            [ study.id, req.body?.id ],
        );
        if (!participant) {
            res.status(HTTPStatus.NOT_FOUND).end();
            return;
        }
        res.redirect(`/${encodeURIComponent(participant.name)}/queue`);
    } catch (error) {
        if (!respondWithStudyRuntimeError(res, error)) throw error;
    }
};
