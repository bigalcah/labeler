import HTTPStatus from "../../util/http-status.js";
import {
    findFirstPendingCard,
    loadStudyProgress,
    requireStudySession,
    respondWithStudyRuntimeError,
    sessionParticipant,
} from "../../util/study-runtime.js";

export const get = async (req, res) => {
    const context = requireStudySession(req, res);
    if (!context) return;

    const pool = req.app.locals.dependencies.pool;
    try {
        const cardId = await findFirstPendingCard(pool, context.studyId, context.participantId);
        if (cardId) {
            res.redirect(HTTPStatus.SEE_OTHER, `/queue/${encodeURIComponent(cardId)}`);
            return;
        }

        const progress = await loadStudyProgress(pool, context.studyId, context.participantId);
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
