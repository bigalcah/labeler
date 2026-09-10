import {createStudyService} from "../../util/study-service.js";
import {requireStudySession, respondWithStudyRuntimeError, sessionParticipant} from "../../util/study-runtime.js";

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

    const studyService = createStudyService(req.app.locals.dependencies);
    try {
        const selectedProgress = withPercentage(await studyService.loadProgress(context));
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
