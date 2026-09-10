import HTTPStatus from "../../util/http-status.js";
import {createStudyService} from "../../util/study-service.js";
import {
    requireStudySession,
    respondWithStudyRuntimeError,
    sessionParticipant,
} from "../../util/study-runtime.js";

export const get = async (req, res) => {
    const context = requireStudySession(req, res);
    if (!context) return;

    const studyService = createStudyService(req.app.locals.dependencies);
    try {
        const cardId = await studyService.resolveQueue(context);
        if (cardId) {
            res.redirect(HTTPStatus.SEE_OTHER, `/queue/${encodeURIComponent(cardId)}`);
            return;
        }

        const progress = await studyService.loadProgress(context);
        const participant = sessionParticipant(context);
        res.locals.participant = participant;
        res.render("review", {
            participant,
            categories: [],
            card: null,
            progress,
            total: progress.total,
            navigation: {previousId: null, nextId: null},
        });
    } catch (error) {
        if (!respondWithStudyRuntimeError(res, error)) throw error;
    }
};
