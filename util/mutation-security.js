import HTTPStatus from "./http-status.js";
import {isAllowedOrigin, readCsrfToken, validateLoginCsrfToken, validateSessionCsrfToken} from "./csrf.js";

const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

const reject = (res, status = HTTPStatus.FORBIDDEN) => {
    res.status(status).end();
};

const createMutationSecurityMiddleware = ({pool, clock, csrf, originPolicy}) => async (req, res, next) => {
    if (!MUTATION_METHODS.has(req.method)) {
        next();
        return;
    }
    if (!isAllowedOrigin({request: req, policy: originPolicy})) {
        reject(res);
        return;
    }
    const suppliedToken = readCsrfToken(req);
    if (req.path === "/login") {
        const valid = await (csrf.validateLoginCsrfToken || validateLoginCsrfToken)({
            pool,
            request: req,
            token: suppliedToken,
            clock,
        });
        if (!valid) {
            reject(res);
            return;
        }
        req.csrfValidated = true;
        next();
        return;
    }
    if (!req.sessionContext || !(csrf.validateSessionCsrfToken || validateSessionCsrfToken)({
        expectedToken: req.csrfToken,
        suppliedToken,
    })) {
        reject(res, req.sessionContext ? HTTPStatus.FORBIDDEN : HTTPStatus.UNAUTHORIZED);
        return;
    }
    if (req.touchSession) await req.touchSession();
    req.csrfValidated = true;
    next();
};

export {createMutationSecurityMiddleware};
