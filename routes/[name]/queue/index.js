import HTTPStatus from "../../../util/http-status.js";
import {
    findFirstPendingCard,
    loadStudyProgress,
    respondWithStudyRuntimeError,
    resolveStudyParticipant,
} from "../../../util/study-runtime.js";

export const get = async (req, res) => {
    const pool = req.app.locals.dependencies.pool;
    try {
        const {study, participant} = await resolveStudyParticipant(pool, req.params.name);
        const cardId = await findFirstPendingCard(pool, study.id, participant.id);
        if (cardId) {
            res.redirect(
                HTTPStatus.SEE_OTHER,
                `/${encodeURIComponent(participant.name)}/queue/${encodeURIComponent(cardId)}`,
            );
            return;
        }

        const progress = await loadStudyProgress(pool, study.id, participant.id);
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
