import {createStudyComparisonExport, StudyExportError} from "../../../util/study-export.js";
import {requireStudySession} from "../../../util/study-runtime.js";

const respondWithExportError = (res, error) => {
    const status = error instanceof StudyExportError ? error.status : 500;
    const message = status === 403 ? "Export is not available." : "We couldn't prepare the export.";
    res.status(status).type("text/plain").send(message);
};

export const post = async (req, res) => {
    res.set("Cache-Control", "private, no-store");
    const context = requireStudySession(req, res);
    if (!context) return;

    try {
        const csv = await createStudyComparisonExport({pool: req.app.locals.pool, context});
        res.status(200).set({
            "Cache-Control": "private, no-store",
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": "attachment; filename=\"pr-classifications.csv\"",
            "X-Content-Type-Options": "nosniff",
        }).send(csv);
    } catch (error) {
        respondWithExportError(res, error);
    }
};
