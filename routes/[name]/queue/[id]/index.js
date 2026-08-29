import pool from "../../../../util/pg-pool.js";
import HTTPStatus from "../../../../util/http-status.js";
import {
    addCardDates,
    isUuid,
    loadParticipantCategories,
    loadStudyCard,
    loadStudyProgress,
    respondWithStudyRuntimeError,
    resolveStudyParticipant,
} from "../../../../util/study-runtime.js";

export const get = async (req, res) => {
    if (!isUuid(req.params.id)) {
        res.status(HTTPStatus.BAD_REQUEST).end();
        return;
    }

    try {
        const {study, participant} = await resolveStudyParticipant(pool, req.params.name);
        const [ card, categories, progress ] = await Promise.all([
            loadStudyCard(pool, study.id, participant.id, req.params.id),
            loadParticipantCategories(pool, participant.id),
            loadStudyProgress(pool, study.id, participant.id),
        ]);
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
