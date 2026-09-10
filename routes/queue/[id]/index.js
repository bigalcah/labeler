import {createStudyService} from "../../../util/study-service.js";
import {
    addCardDates,
    requireStudySession,
    respondWithStudyRuntimeError,
    sessionParticipant,
} from "../../../util/study-runtime.js";

export const get = async (req, res) => {
    const context = requireStudySession(req, res);
    if (!context) return;
    const studyService = createStudyService(req.app.locals.dependencies);
    try {
        const {card, categories, progress} = await studyService.loadReviewCardData(context, req.params.id);
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
