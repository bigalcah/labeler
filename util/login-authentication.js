import {normalizeUsername} from "./credential-manifest.js";
import {verifyPasswordHash} from "./credential-policy.js";
import {ABSOLUTE_TTL_MS, IDLE_TTL_MS} from "./production-config.js";
import {createSessionId} from "./session-middleware.js";
import {createCsrfToken} from "./csrf.js";
import {withTransaction} from "./transaction.js";

const LOGIN_WINDOW_MS = 900_000;
const ACCOUNT_FAILURE_LIMIT = 5;
const IP_ATTEMPT_LIMIT = 20;
const DUMMY_PASSWORD_HASH = "$argon2id$v=19$m=65536,p=4,t=3$FbLy+XGMNhtfr0VGSCpcUg$A1EqurfdjdUSDkseBAXH1fkxIqTctEFIhQrabHfUj7I";

const normalizeLoginUsername = value => {
    if (typeof value !== "string") return null;
    try {
        return normalizeUsername(value.trim().toLowerCase());
    } catch (_error) {
        return null;
    }
};

const recordIpAttempt = async ({client, clientIp, now}) => {
    const {rows: [attempt]} = await client.query(
        `INSERT INTO login_ip_attempt(ip_address, attempt_count, window_started_at)
         VALUES ($1, 1, $2)
         ON CONFLICT (ip_address) DO UPDATE
         SET attempt_count = CASE
                 WHEN login_ip_attempt.window_started_at <= $2 - INTERVAL '15 minutes' THEN 1
                 ELSE login_ip_attempt.attempt_count + 1
             END,
             window_started_at = CASE
                 WHEN login_ip_attempt.window_started_at <= $2 - INTERVAL '15 minutes' THEN $2
                 ELSE login_ip_attempt.window_started_at
             END
         RETURNING attempt_count, window_started_at`,
        [ clientIp, now ],
    );
    return attempt;
};

const retryAfterSeconds = ({windowStartedAt, now}) => Math.max(1, Math.ceil(
    (new Date(windowStartedAt).getTime() + LOGIN_WINDOW_MS - now.getTime()) / 1000,
));

const isLocked = ({lockedUntil, now}) => lockedUntil !== null && new Date(lockedUntil).getTime() > now.getTime();

const recordAccountFailure = async ({client, account, now}) => {
    const windowStartedAt = account.failed_login_window_started_at;
    const failures = windowStartedAt === null || new Date(windowStartedAt).getTime() <= now.getTime() - LOGIN_WINDOW_MS
        ? 1
        : account.failed_login_attempts + 1;
    await client.query(
        `UPDATE participant_account
         SET failed_login_attempts = $2,
             failed_login_window_started_at = CASE
                 WHEN $2 = 1 THEN $3
                 ELSE failed_login_window_started_at
             END,
             locked_until = CASE
                 WHEN $2 >= $4 THEN $3 + INTERVAL '15 minutes'
                 ELSE locked_until
             END,
             updated_at = $3
         WHERE id = $1`,
        [ account.id, failures, now, ACCOUNT_FAILURE_LIMIT ],
    );
};

const authenticateLogin = async ({
    pool,
    username,
    password,
    clientIp,
    sessionId = null,
    clock = () => new Date(),
    sessionPolicy = {idleTtlMs: IDLE_TTL_MS, absoluteTtlMs: ABSOLUTE_TTL_MS},
    passwordVerifier = verifyPasswordHash,
    createSessionId: createNewSessionId = createSessionId,
    createCsrfToken: createNewCsrfToken = createCsrfToken,
}) => {
    const now = new Date(clock());
    const normalizedUsername = normalizeLoginUsername(username);
    return withTransaction(pool, async client => {
        const ipAttempt = await recordIpAttempt({client, clientIp, now});
        if (ipAttempt.attempt_count > IP_ATTEMPT_LIMIT) {
            return {kind: "rate_limited", retryAfterSeconds: retryAfterSeconds({windowStartedAt: ipAttempt.window_started_at, now})};
        }
        const {rows: accounts} = normalizedUsername === null
            ? {rows: []}
            : await client.query(
                `SELECT account.id, account.study_id, account.reviewer_id, account.password_hash,
                        account.enabled, account.credential_version, account.failed_login_attempts,
                        account.failed_login_window_started_at, account.locked_until
                 FROM participant_account account
                 INNER JOIN study ON study.id = account.study_id AND study.bootstrap_state = 'READY'
                 WHERE account.normalized_username = $1
                 LIMIT 2
                 FOR UPDATE OF account`,
                [ normalizedUsername ],
            );
        const account = accounts.length === 1 ? accounts[0] : null;
        const passwordMatches = await passwordVerifier(account?.password_hash || DUMMY_PASSWORD_HASH, password);
        if (!account || !passwordMatches || account.enabled !== true || isLocked({lockedUntil: account.locked_until, now})) {
            if (account && !isLocked({lockedUntil: account.locked_until, now})) {
                await recordAccountFailure({client, account, now});
            }
            return {kind: "invalid"};
        }
        const newSessionId = createNewSessionId();
        const csrfToken = createNewCsrfToken();
        const absoluteExpiresAt = new Date(now.getTime() + sessionPolicy.absoluteTtlMs);
        const expiresAt = new Date(Math.min(absoluteExpiresAt.getTime(), now.getTime() + sessionPolicy.idleTtlMs));
        await client.query(
            `UPDATE participant_account
             SET failed_login_attempts = 0, failed_login_window_started_at = NULL, locked_until = NULL, updated_at = $2
             WHERE id = $1`,
            [ account.id, now ],
        );
        if (sessionId !== null) await client.query("DELETE FROM app_session WHERE session_id = $1", [ sessionId ]);
        await client.query(
            `INSERT INTO app_session(
                session_id, account_id, study_id, reviewer_id, credential_version,
                created_at, last_activity_at, expires_at, absolute_expires_at, csrf_token
            ) VALUES ($1, $2, $3, $4, $5, $6, $6, $7, $8, $9)`,
            [ newSessionId, account.id, account.study_id, account.reviewer_id, account.credential_version,
                now, expiresAt, absoluteExpiresAt, csrfToken ],
        );
        return {kind: "authenticated", sessionId: newSessionId};
    });
};

export {authenticateLogin};
