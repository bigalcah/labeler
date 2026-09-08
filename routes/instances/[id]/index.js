import HTTPStatus from "../../../util/http-status.js";
import {
    addCardDates,
    isUuid,
    loadStudyCard,
    resolveReadyStudy,
    resolveStudyParticipant,
    respondWithStudyRuntimeError,
} from "../../../util/study-runtime.js";

export const get = async (req, res) => {
    const pool = req.app.locals.dependencies.pool;
    try {
        if (!req.query.participant) {
            await resolveReadyStudy(pool);
            res.status(HTTPStatus.NOT_FOUND).render("error", {
                icon: "bi-person-x",
                title: "Select a participant before opening a card",
            });
            return;
        }
        if (!isUuid(req.params.id)) {
            res.status(HTTPStatus.BAD_REQUEST).end();
            return;
        }

        const {study, participant} = await resolveStudyParticipant(pool, req.query.participant);
        // Card content comes from FROM pr_cards through the study_card membership query.
        const card = addCardDates(await loadStudyCard(pool, study.id, participant.id, req.params.id));
        res.locals.participant = participant;
        res.render("instance", {
            instance: card,
            participant,
        });
    } catch (error) {
        if (!respondWithStudyRuntimeError(res, error)) throw error;
    }
};
