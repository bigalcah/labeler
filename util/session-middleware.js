import {createHmac, randomBytes, timingSafeEqual} from "node:crypto";
import {ABSOLUTE_TTL_MS, IDLE_TTL_MS, SESSION_COOKIE} from "./production-config.js";

const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const SESSION_TAG_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const SESSION_TAG_BYTES = 32;
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const DEFAULT_POLICY = Object.freeze({
    sessionCookie: SESSION_COOKIE,
    idleTtlMs: IDLE_TTL_MS,
    absoluteTtlMs: ABSOLUTE_TTL_MS,
    getSessionSecrets: () => [],
});

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

const asDate = value => {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
};

const getSessionSecrets = policy => typeof policy.getSessionSecrets === "function"
    ? policy.getSessionSecrets()
    : [];

const signSessionId = (sessionId, secret) => createHmac("sha256", secret)
    .update(sessionId, "ascii")
    .digest();

const verifySessionCookie = (cookieValue, policy) => {
    const parts = cookieValue.split(".");
    if (parts.length !== 2) return null;
    const [sessionId, tag] = parts;
    if (!SESSION_ID_PATTERN.test(sessionId) || !SESSION_TAG_PATTERN.test(tag)) return null;
    const receivedTag = Buffer.from(tag, "base64url");
    if (receivedTag.length !== SESSION_TAG_BYTES || receivedTag.toString("base64url") !== tag) return null;
    for (const secret of getSessionSecrets(policy)) {
        const expectedTag = signSessionId(sessionId, secret);
        if (timingSafeEqual(expectedTag, receivedTag)) return sessionId;
    }
    return null;
};

const isValidSession = ({session, now, policy}) => {
    const createdAt = asDate(session.created_at);
    const lastActivityAt = asDate(session.last_activity_at);
    const expiresAt = asDate(session.expires_at);
    const absoluteExpiresAt = asDate(session.absolute_expires_at);
    if (!createdAt || !lastActivityAt || !expiresAt || !absoluteExpiresAt
        || session.enabled !== true
        || !Number.isInteger(session.session_credential_version)
        || session.session_credential_version !== session.account_credential_version) return false;
    return now.getTime() < lastActivityAt.getTime() + policy.idleTtlMs
        && now.getTime() < createdAt.getTime() + policy.absoluteTtlMs
        && now.getTime() < expiresAt.getTime()
        && now.getTime() < absoluteExpiresAt.getTime();
};

const loadSession = async ({pool, sessionId}) => {
    const {rows: [session]} = await pool.query(
        `SELECT session.account_id, account.study_id, account.reviewer_id,
                session.credential_version AS session_credential_version,
                session.csrf_token,
                session.created_at, session.last_activity_at, session.expires_at, session.absolute_expires_at,
                account.enabled, account.credential_version AS account_credential_version,
                participant.participant_key
         FROM app_session session
         INNER JOIN participant_account account
             ON account.id = session.account_id
             AND account.study_id = session.study_id
             AND account.reviewer_id = session.reviewer_id
         INNER JOIN study_participant participant
             ON participant.study_id = account.study_id
             AND participant.reviewer_id = account.reviewer_id
         WHERE session.session_id = $1`,
        [ sessionId ],
    );
    return session;
};

const createSessionId = () => randomBytes(32).toString("base64url");

const readSessionCookie = (request, policy = DEFAULT_POLICY) => {
    const cookieValue = readCookie(request.headers.cookie, policy.sessionCookie.name);
    return cookieValue === null ? null : verifySessionCookie(cookieValue, policy);
};

const setSessionCookie = (response, sessionId, policy = DEFAULT_POLICY) => {
    const [currentSecret] = getSessionSecrets(policy);
    if (!currentSecret) throw new Error("Session signing key unavailable");
    if (!SESSION_ID_PATTERN.test(sessionId)) throw new Error("Invalid session ID");
    const {name, ...options} = policy.sessionCookie;
    const tag = signSessionId(sessionId, currentSecret).toString("base64url");
    response.cookie(name, `${sessionId}.${tag}`, options);
};

const destroySession = async ({pool, sessionId}) => {
    await pool.query("DELETE FROM app_session WHERE session_id = $1", [ sessionId ]);
};

const clearSessionCookie = (response, policy = DEFAULT_POLICY) => {
    const {name, ...options} = policy.sessionCookie;
    response.clearCookie(name, options);
};

const createSessionMiddleware = ({pool, clock = () => new Date(), policy = {
    ...DEFAULT_POLICY,
}} = {}) => async (req, res, next) => {
    req.sessionContext = null;
    res.locals.sessionContext = null;
    req.csrfToken = null;
    res.locals.csrfToken = null;
    req.touchSession = null;
    const sessionId = readSessionCookie(req, policy);
    if (!sessionId) return next();
    try {
        const now = asDate(clock());
        const session = await loadSession({pool, sessionId});
        if (!now || !session || !isValidSession({session, now, policy})) return next();
        const absoluteExpiresAt = asDate(session.absolute_expires_at);
        const expiresAt = new Date(Math.min(
            absoluteExpiresAt.getTime(),
            now.getTime() + policy.idleTtlMs,
        ));
        const touchSession = async () => pool.query(
            `UPDATE app_session
             SET last_activity_at = $2, expires_at = $3
             WHERE session_id = $1`,
            [ sessionId, now, expiresAt ],
        );
        req.touchSession = touchSession;
        if (SAFE_METHODS.has(req.method)) await touchSession();
        const context = Object.freeze({
            accountId: session.account_id,
            studyId: session.study_id,
            participantId: session.reviewer_id,
            participantKey: session.participant_key,
        });
        req.sessionContext = context;
        res.locals.sessionContext = context;
        req.csrfToken = session.csrf_token || null;
        res.locals.csrfToken = session.csrf_token || null;
    } catch (_error) {
        req.sessionContext = null;
        res.locals.sessionContext = null;
        req.csrfToken = null;
        res.locals.csrfToken = null;
    }
    next();
};

export {clearSessionCookie, createSessionId, createSessionMiddleware, destroySession, readSessionCookie, setSessionCookie};
