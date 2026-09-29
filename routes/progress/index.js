import {createStudyService} from "../../util/study-service.js";
import {requireStudySession, respondWithStudyRuntimeError, sessionParticipant} from "../../util/study-runtime.js";

const withPercentage = progress => ({
    ...progress,
    completed: progress.classified + progress.discarded,
    percentage: progress.total
        ? Math.round((progress.classified + progress.discarded) * 1000 / progress.total) / 10
        : 0,
});

const rawPagination = req => {
    const queryIndex = req.originalUrl.indexOf("?");
    const parameters = new URLSearchParams(queryIndex === -1 ? "" : req.originalUrl.slice(queryIndex + 1));
    return {page: parameters.get("page") ?? undefined, limit: parameters.get("limit") ?? undefined};
};

export const get = async (req, res) => {
    const context = requireStudySession(req, res);
    if (!context) return;

    const studyService = createStudyService(req.app.locals.dependencies);
    try {
        const [selectedProgress, {progressPage, categorySummary}] = await Promise.all([
            studyService.loadProgress(context),
            studyService.loadProgressPage(context, rawPagination(req)),
        ]);
        const participant = sessionParticipant(context);
        res.locals.participant = participant;
        res.render("progress", {
            reviewers: [],
            participant,
            selectedProgress: withPercentage(selectedProgress),
            progressPage,
            categorySummary,
        });
    } catch (error) {
        if (!respondWithStudyRuntimeError(res, error)) throw error;
    }
};
