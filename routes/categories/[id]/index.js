import HTTPStatus from "../../../util/http-status.js";
import {createStudyService} from "../../../util/study-service.js";
import {
    requireStudySession,
    respondWithStudyRuntimeError,
} from "../../../util/study-runtime.js";

export const patch = async (req, res) => {
    const context = requireStudySession(req, res);
    if (!context) return;

    const studyService = createStudyService(req.app.locals.dependencies);
    try {
        const category = await studyService.renameCategory(context, req.params.id, {
            name: req.body?.name,
            expectedUpdatedAt: req.body?.expected_updated_at,
        });
        res.status(HTTPStatus.OK).json(category);
    } catch (error) {
        if (!respondWithStudyRuntimeError(res, error)) throw error;
    }
};
