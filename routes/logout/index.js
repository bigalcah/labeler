import HTTPStatus from "../../util/http-status.js";
import {
    clearSessionCookie,
    destroySession,
    readSessionCookie,
} from "../../util/session-middleware.js";

export const post = async (req, res) => {
    const {pool, sessionPolicy} = req.app.locals.dependencies;
    if (!req.sessionContext || !req.csrfValidated) {
        res.status(HTTPStatus.FORBIDDEN).end();
        return;
    }
    const sessionId = readSessionCookie(req, sessionPolicy);
    if (sessionId !== null) await destroySession({pool, sessionId});
    clearSessionCookie(res, sessionPolicy);
    res.redirect("/login");
};
