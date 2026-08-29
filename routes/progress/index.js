import pool from "../../util/pg-pool.js";
import {loadStudyProgress, resolveReadyStudy, resolveStudyParticipant, respondWithStudyRuntimeError} from "../../util/study-runtime.js";

const withPercentage = progress => ({
    ...progress,
    completed: progress.classified + progress.discarded,
    percentage: progress.total
        ? Math.round((progress.classified + progress.discarded) * 1000 / progress.total) / 10
        : 0,
});

export const get = async (req, res) => {
    try {
        if (!req.query.participant) {
            await resolveReadyStudy(pool);
            res.render("progress", {reviewers: [], participant: null, selectedProgress: null});
            return;
        }

        const {study, participant} = await resolveStudyParticipant(pool, req.query.participant);
        // Progress counts are derived from FROM pr_cards through study_card membership in the shared runtime query.
        const selectedProgress = withPercentage(await loadStudyProgress(pool, study.id, participant.id));
        res.locals.participant = participant;
        res.render("progress", {
            reviewers: [ { ...participant, ...selectedProgress } ],
            participant,
            selectedProgress,
        });
    } catch (error) {
        if (!respondWithStudyRuntimeError(res, error)) throw error;
    }
};
