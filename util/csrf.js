import {randomBytes, timingSafeEqual} from "node:crypto";
import {DEFAULT_DEVELOPMENT_ORIGINS, SESSION_COOKIE} from "./production-config.js";

const LOGIN_CSRF_TTL_MS = 900_000;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const LOGIN_CSRF_COOKIE = Object.freeze({
    name: "__Host-login-csrf",
    secure: SESSION_COOKIE.secure,
    httpOnly: SESSION_COOKIE.httpOnly,
    sameSite: SESSION_COOKIE.sameSite,
    path: SESSION_COOKIE.path,
});

const createCsrfToken = () => randomBytes(32).toString("base64url");

const readCookie = (header, name) => {
    if (typeof header !== "string") return null;
    const cookie = header.split(";").map(part => part.trim()).find(part => part.startsWith(`${name}=`));
    if (!cookie) return null;
    try {
        return decodeURIComponent(cookie.slice(name.length + 1));
    } catch (_error) {
        return null;
    }
};

const isValidTokenPair = (expectedToken, suppliedToken) => {
    if (!TOKEN_PATTERN.test(expectedToken || "") || !TOKEN_PATTERN.test(suppliedToken || "")) return false;
    const expected = Buffer.from(expectedToken);
    const supplied = Buffer.from(suppliedToken);
    return expected.length === supplied.length && timingSafeEqual(expected, supplied);
};

const readCsrfToken = request => {
    const headerToken = request.headers["x-csrf-token"];
    const bodyToken = request.body?.csrf_token;
    if (headerToken !== undefined && bodyToken !== undefined && headerToken !== bodyToken) return null;
    return typeof headerToken === "string" ? headerToken : typeof bodyToken === "string" ? bodyToken : null;
};

const isAllowedOrigin = ({request, policy = {nodeEnv: "development", appOrigin: null, developmentOrigins: DEFAULT_DEVELOPMENT_ORIGINS}}) => {
    const suppliedOrigin = request.headers.origin;
    if (typeof suppliedOrigin !== "string" || suppliedOrigin.length === 0) return false;
    if (policy.appOrigin !== null) return suppliedOrigin === policy.appOrigin;
    if (policy.nodeEnv === "production") return false;
    let origin;
    try {
        origin = new URL(suppliedOrigin);
    } catch (_error) {
        return false;
    }
    if (origin.origin !== suppliedOrigin || origin.protocol !== "http:" || origin.username || origin.password) return false;
    return policy.developmentOrigins.some(allowedOrigin => {
        const allowed = new URL(allowedOrigin);
        return allowed.protocol === origin.protocol
            && allowed.hostname === origin.hostname
            && (!allowed.port || allowed.port === origin.port);
    });
};

const createLoginCsrfContext = async ({pool, clock = () => new Date(), createContextId = createCsrfToken, createToken = createCsrfToken}) => {
    const contextId = createContextId();
    const token = createToken();
    const expiresAt = new Date(new Date(clock()).getTime() + LOGIN_CSRF_TTL_MS);
    await pool.query(
        `INSERT INTO login_csrf_context(context_id, token, expires_at)
         VALUES ($1, $2, $3)`,
        [ contextId, token, expiresAt ],
    );
    return {contextId, token};
};

const ensureLoginCsrfContext = async ({pool, request, response, clock, createContextId, createToken}) => {
    const contextId = readCookie(request.headers.cookie, LOGIN_CSRF_COOKIE.name);
    if (TOKEN_PATTERN.test(contextId || "")) {
        const {rows: [context]} = await pool.query(
            "SELECT token, expires_at FROM login_csrf_context WHERE context_id = $1",
            [ contextId ],
        );
        if (context && new Date(context.expires_at).getTime() > new Date(clock()).getTime()) {
            return {contextId, token: context.token};
        }
    }
    const context = await createLoginCsrfContext({pool, clock, createContextId, createToken});
    const {name, ...options} = LOGIN_CSRF_COOKIE;
    response.cookie(name, context.contextId, options);
    return context;
};

const validateLoginCsrfToken = async ({pool, request, token, clock = () => new Date()}) => {
    const contextId = readCookie(request.headers.cookie, LOGIN_CSRF_COOKIE.name);
    if (!TOKEN_PATTERN.test(contextId || "")) return false;
    const {rows: [context]} = await pool.query(
        "SELECT token, expires_at FROM login_csrf_context WHERE context_id = $1",
        [ contextId ],
    );
    return !!context
        && new Date(context.expires_at).getTime() > new Date(clock()).getTime()
        && isValidTokenPair(context.token, token);
};

const validateSessionCsrfToken = ({expectedToken, suppliedToken}) => isValidTokenPair(expectedToken, suppliedToken);

const clearLoginCsrfCookie = (response, policy = LOGIN_CSRF_COOKIE) => {
    const {name, ...options} = policy;
    response.clearCookie(name, options);
};

export {
    LOGIN_CSRF_COOKIE,
    DEFAULT_DEVELOPMENT_ORIGINS,
    createCsrfToken,
    clearLoginCsrfCookie,
    ensureLoginCsrfContext,
    isAllowedOrigin,
    readCsrfToken,
    validateLoginCsrfToken,
    validateSessionCsrfToken,
};
