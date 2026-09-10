import HTTPStatus from "../../../../util/http-status.js";
import {createStudyService} from "../../../../util/study-service.js";
import {
    requireStudySession,
    respondWithStudyRuntimeError,
} from "../../../../util/study-runtime.js";

const continuationPath = cardId => cardId
    ? `/queue/${encodeURIComponent(cardId)}`
    : "/queue";

export const post = async (req, res) => {
    const context = requireStudySession(req, res);
    if (!context) return;

    const studyService = createStudyService(req.app.locals.dependencies);
    try {
        const nextCardId = await studyService.classifyCard(context, req.params.id, {
            categoryId: req.body?.category_id,
            expectedRevision: req.body?.expected_revision,
            remarks: req.body?.remarks,
        });
        res.redirect(HTTPStatus.SEE_OTHER, continuationPath(nextCardId));
    } catch (error) {
        if (!respondWithStudyRuntimeError(res, error)) throw error;
    }
};
