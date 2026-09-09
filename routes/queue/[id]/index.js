import HTTPStatus from "../../../util/http-status.js";
import {
    addCardDates,
    isUuid,
    loadParticipantCategories,
    loadStudyCard,
    loadStudyProgress,
    requireStudySession,
    respondWithStudyRuntimeError,
    sessionParticipant,
} from "../../../util/study-runtime.js";

export const get = async (req, res) => {
    const context = requireStudySession(req, res);
    if (!context) return;
    if (!isUuid(req.params.id)) {
        res.status(HTTPStatus.BAD_REQUEST).end();
        return;
    }

    const pool = req.app.locals.dependencies.pool;
    try {
        const [ card, categories, progress ] = await Promise.all([
            loadStudyCard(pool, context.studyId, context.participantId, req.params.id),
            loadParticipantCategories(pool, context.studyId, context.participantId),
            loadStudyProgress(pool, context.studyId, context.participantId),
        ]);
        const participant = sessionParticipant(context);
        const datedCard = addCardDates(card);
        res.locals.participant = participant;
        res.render("review", {
            participant,
            categories,
            card: datedCard,
            progress,
            total: progress.total,
            navigation: {
                previousId: card.previous_card_id,
                nextId: card.next_card_id,
            },
        });
    } catch (error) {
        if (!respondWithStudyRuntimeError(res, error)) throw error;
    }
};
