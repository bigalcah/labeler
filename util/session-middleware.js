import {randomBytes} from "node:crypto";
import {ABSOLUTE_TTL_MS, IDLE_TTL_MS, SESSION_COOKIE} from "./production-config.js";

const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

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
        `SELECT session.account_id, session.study_id, session.reviewer_id,
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
             ON participant.study_id = session.study_id
             AND participant.reviewer_id = session.reviewer_id
         WHERE session.session_id = $1`,
        [ sessionId ],
    );
    return session;
};

const createSessionId = () => randomBytes(32).toString("base64url");

const readSessionCookie = (request, policy = {sessionCookie: SESSION_COOKIE}) => {
    const sessionId = readCookie(request.headers.cookie, policy.sessionCookie.name);
    return SESSION_ID_PATTERN.test(sessionId || "") ? sessionId : null;
};

const setSessionCookie = (response, sessionId, policy = {sessionCookie: SESSION_COOKIE}) => {
    const {name, ...options} = policy.sessionCookie;
    response.cookie(name, sessionId, options);
};

const destroySession = async ({pool, sessionId}) => {
    await pool.query("DELETE FROM app_session WHERE session_id = $1", [ sessionId ]);
};

const clearSessionCookie = (response, policy = {sessionCookie: SESSION_COOKIE}) => {
    const {name, ...options} = policy.sessionCookie;
    response.clearCookie(name, options);
};

const createSessionMiddleware = ({pool, clock = () => new Date(), policy = {
    sessionCookie: SESSION_COOKIE,
    idleTtlMs: IDLE_TTL_MS,
    absoluteTtlMs: ABSOLUTE_TTL_MS,
}} = {}) => async (req, res, next) => {
    req.sessionContext = null;
    res.locals.sessionContext = null;
    req.csrfToken = null;
    res.locals.csrfToken = null;
    req.touchSession = null;
    const sessionId = readCookie(req.headers.cookie, policy.sessionCookie.name);
    if (!SESSION_ID_PATTERN.test(sessionId || "")) return next();
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
