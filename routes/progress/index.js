import {
    loadStudyProgress,
    requireStudySession,
    respondWithStudyRuntimeError,
    sessionParticipant,
} from "../../util/study-runtime.js";

const withPercentage = progress => ({
    ...progress,
    completed: progress.classified + progress.discarded,
    percentage: progress.total
        ? Math.round((progress.classified + progress.discarded) * 1000 / progress.total) / 10
        : 0,
});

export const get = async (req, res) => {
    const context = requireStudySession(req, res);
    if (!context) return;

    const pool = req.app.locals.dependencies.pool;
    try {
        // Progress counts are derived from FROM pr_cards through study_card membership in the shared runtime query.
        const selectedProgress = withPercentage(await loadStudyProgress(pool, context.studyId, context.participantId));
        const participant = sessionParticipant(context);
        res.locals.participant = participant;
        res.render("progress", {
            reviewers: [],
            participant,
            selectedProgress,
        });
    } catch (error) {
        if (!respondWithStudyRuntimeError(res, error)) throw error;
    }
};
