import HTTPStatus from "../../util/http-status.js";
import {createStudyService} from "../../util/study-service.js";
import {requireStudySession, respondWithStudyRuntimeError} from "../../util/study-runtime.js";

export const post = async (req, res) => {
    const context = requireStudySession(req, res);
    if (!context) return;

    const studyService = createStudyService(req.app.locals.dependencies);
    try {
        const category = await studyService.createCategory(context, {name: req.body?.name});
        res.status(HTTPStatus.CREATED).json(category);
    } catch (error) {
        if (respondWithStudyRuntimeError(res, error)) return;
        throw error;
    }
};
