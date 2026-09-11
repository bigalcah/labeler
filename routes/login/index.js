import HTTPStatus from "../../util/http-status.js";
import {authenticateLogin} from "../../util/login-authentication.js";
import {clearLoginCsrfCookie} from "../../util/csrf.js";
import {readSessionCookie, setSessionCookie} from "../../util/session-middleware.js";

const renderLogin = async ({req, res, authenticationFailed = false, csrfFailed = false, csrfToken = null}) => {
    const {pool, clock, csrf} = req.app.locals.dependencies;
    const context = csrfToken === null
        ? await csrf.ensureLoginCsrfContext({pool, request: req, response: res, clock, createToken: csrf.createCsrfToken})
        : {token: csrfToken};
    res.render("login", {
        authenticationFailed,
        csrfFailed,
        csrfToken: context.token,
    });
};

export const get = async (req, res) => renderLogin({req, res});

export const post = async (req, res) => {
    const {pool, clock, sessionPolicy, passwordVerifier, csrf} = req.app.locals.dependencies;
    const csrfValid = req.csrfValidated || await csrf.validateLoginCsrfToken({
        pool,
        request: req,
        token: req.body?.csrf_token,
        clock,
    });
    if (!csrfValid) {
        res.status(HTTPStatus.FORBIDDEN);
        await renderLogin({req, res, csrfFailed: true});
        return;
    }
    const result = await authenticateLogin({
        pool,
        username: req.body?.username,
        password: req.body?.password,
        clientIp: req.ip,
        sessionId: readSessionCookie(req, sessionPolicy),
        clock,
        sessionPolicy,
        passwordVerifier: passwordVerifier || undefined,
        createCsrfToken: csrf.createCsrfToken,
    });
    if (result.kind === "authenticated") {
        setSessionCookie(res, result.sessionId, sessionPolicy);
        clearLoginCsrfCookie(res);
        res.redirect("/queue");
        return;
    }
    if (result.kind === "rate_limited") {
        res.set("Retry-After", `${result.retryAfterSeconds}`);
        res.status(HTTPStatus.TOO_MANY_REQUESTS);
        await renderLogin({req, res, authenticationFailed: true, csrfToken: req.body?.csrf_token});
        return;
    }
    res.status(HTTPStatus.UNAUTHORIZED);
    await renderLogin({req, res, authenticationFailed: true, csrfToken: req.body?.csrf_token});
};
