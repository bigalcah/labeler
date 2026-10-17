import {getStudyExportAvailability, StudyExportError} from "../../util/study-export.js";
import {requireStudySession, sessionParticipant} from "../../util/study-runtime.js";

const respondWithExportError = (res, error) => {
    const status = error instanceof StudyExportError ? error.status : 500;
    const message = status === 403 ? "Export is not available." : "We couldn't prepare the export.";
    res.status(status).type("text/plain").send(message);
};

export const get = async (req, res) => {
    res.set("Cache-Control", "private, no-store");
    const context = requireStudySession(req, res);
    if (!context) return;

    try {
        const exportAvailability = await getStudyExportAvailability({pool: req.app.locals.pool, context});
        const participant = sessionParticipant(context);
        res.locals.participant = participant;
        res.render("export", {participant, exportAvailability});
    } catch (error) {
        respondWithExportError(res, error);
    }
};
