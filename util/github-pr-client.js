import {readFileSync} from "node:fs";
import {randomUUID} from "node:crypto";
import {GithubConfigError, normalizeRepository, resolveCredential} from "./github-pr-config.js";
import {GithubRequestError} from "./github-pr-errors.js";
import {buildRunManifest, buildSnapshotManifest, canonicalize, checksum, checksumRaw, checksumRunManifest, checksumSnapshotManifest, isExactPageValidatorMatch} from "./github-pr-manifest.js";
import {normalizeResponse} from "./github-pr-normalizer.js";

const ENDPOINTS = Object.freeze({
    metadata: {path: (repository, number) => `/repos/${repository}/pulls/${number}`, required: true, method: "GET"},
    commits: {path: (repository, number) => `/repos/${repository}/pulls/${number}/commits`, required: true, method: "GET"},
    files: {path: (repository, number) => `/repos/${repository}/pulls/${number}/files`, required: true, method: "GET"},
    reviews: {path: (repository, number) => `/repos/${repository}/pulls/${number}/reviews`, required: true, method: "GET"},
    issueComments: {path: (repository, number) => `/repos/${repository}/issues/${number}/comments`, required: true, method: "GET"},
    reviewComments: {path: (repository, number) => `/repos/${repository}/pulls/${number}/comments`, required: true, method: "GET"},
    timeline: {path: (repository, number) => `/repos/${repository}/issues/${number}/timeline`, required: false, method: "GET"},
    diff: {path: (repository, number) => `/repos/${repository}/pulls/${number}`, required: false, method: "GET", accept: "application/vnd.github.patch"},
});
const MAX_DIFF_BYTES = 8 * 1024 * 1024;
const TERMINAL_STATES = Object.freeze(["COMPLETE", "COMPLETE_EMPTY", "UNAVAILABLE", "TRUNCATED", "FAILED"]);
const MAX_COORDINATED_CONCURRENCY = 4;
const QUOTA_MARGIN = 1;
const DEFAULT_PACING_MS = 100;
const FALLBACK_RATE_LIMIT_DELAY_MS = 60_000;
const HIGH_LATENCY_MS = 10_000;
const MAX_JITTER_MS = 250;
const RAPID_QUOTA_WINDOW_MS = 5_000;
const RETRY_BACKOFF_MS = 1_000;
const STABLE_WINDOW_MS = 30_000;

class GithubQuotaPauseError extends Error {
    constructor(details = {}) {
        super("GitHub quota requires a checkpointed pause");
        this.name = "GithubQuotaPauseError";
        this.code = "QUOTA_PAUSED";
        this.retryAt = details.retryAt ?? null;
        this.remaining = details.remaining ?? null;
        this.reason = details.reason ?? "rate_limit";
    }
}

class GithubTelemetryPersistenceError extends Error {
    constructor(error, endpoint) {
        super("GitHub telemetry persistence failed", {cause: error});
        this.name = "GithubTelemetryPersistenceError";
        this.code = "TELEMETRY_PERSISTENCE_FAILED";
        this.endpoint = endpoint;
    }
}

const parseNumericHeader = (headers, name) => {
    const value = headers.get(name);
    if (value === null || value.trim() === "") return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
};

const retryHint = (response, now) => {
    const retryAfter = response.headers.get("retry-after")?.trim();
    if (retryAfter) {
        const seconds = Number(retryAfter);
        if (Number.isFinite(seconds) && seconds >= 0) return {delayMs: seconds * 1000, source: "RETRY_AFTER"};
        const date = Date.parse(retryAfter);
        if (Number.isFinite(date)) return {delayMs: Math.max(0, date - now()), source: "RETRY_AFTER"};
    }
    const reset = parseNumericHeader(response.headers, "x-ratelimit-reset");
    return reset !== null && reset > 0 ? {delayMs: Math.max(0, reset * 1000 - now()), source: "RESET"} : null;
};

const hasSecondaryLimitHeader = response => ["x-ratelimit-secondary", "x-github-secondary-rate-limit", "x-secondary-rate-limit"]
    .some(header => ["1", "true", "secondary"].includes(response.headers.get(header)?.toLowerCase()));

const isRateLimited = (response, message = null) => response.status === 429 || (response.status === 403
    && (response.headers.get("retry-after")
        || response.headers.get("x-ratelimit-remaining") === "0"
        || hasSecondaryLimitHeader(response)
        || (typeof message === "string" && /secondary rate limit/i.test(message))));

const classifyHttpResponse = (response, message = null) => {
    if (response.status === 429) return {classification: "RATE_LIMIT", decision: "RETRY", rateLimitType: "PRIMARY"};
    if (response.status === 403 && isRateLimited(response, message)) {
        const secondary = hasSecondaryLimitHeader(response) || (typeof message === "string" && /secondary rate limit/i.test(message));
        return {classification: "RATE_LIMIT", decision: "RETRY", rateLimitType: secondary ? "SECONDARY" : "PRIMARY"};
    }
    if (response.status >= 500 && response.status <= 599) return {classification: "RETRYABLE_HTTP", decision: "RETRY", rateLimitType: "UNSPECIFIED"};
    return {classification: "TERMINAL_HTTP", decision: response.status === 404 || response.status === 410 ? "UNAVAILABLE" : "FAIL", rateLimitType: "UNSPECIFIED"};
};

const retryDelay = ({response, now, attempt, rateLimited, random, margin = QUOTA_MARGIN}) => {
    const hint = retryHint(response, now);
    const base = hint?.delayMs ?? (rateLimited ? FALLBACK_RATE_LIMIT_DELAY_MS : RETRY_BACKOFF_MS);
    const multiplier = hint ? 1 : 2 ** (attempt - 1);
    return base * multiplier + margin * 1000 + Math.floor(random() * MAX_JITTER_MS);
};

const readErrorMessage = async response => {
    try {
        const payload = JSON.parse(await response.text());
        return typeof payload?.message === "string" ? payload.message : null;
    } catch (_error) {
        return null;
    }
};

const createQuotaCoordinator = ({sleep = async delay => new Promise(resolve => setTimeout(resolve, delay)), now = Date.now, random = Math.random, margin = QUOTA_MARGIN, pacingMs = DEFAULT_PACING_MS, initialState = null} = {}) => {
    let concurrency = 1;
    let active = 0;
    let remaining = null;
    let resetAt = null;
    let retryAt = null;
    let stableSince = null;
    let nextRequestAt = 0;
    let lastObservedAt = null;
    let lastObservedRemaining = null;
    let pacingTail = Promise.resolve();
    const waiters = [];
    const restore = state => {
        if (!state || typeof state !== "object") return;
        remaining = Number.isInteger(state.remaining) ? state.remaining : null;
        resetAt = Number.isFinite(state.resetAt) ? state.resetAt : null;
        retryAt = Number.isFinite(state.retryAt) ? state.retryAt : null;
        concurrency = Number.isInteger(state.concurrency) ? Math.min(MAX_COORDINATED_CONCURRENCY, Math.max(1, state.concurrency)) : 1;
        nextRequestAt = retryAt || 0;
    };
    restore(initialState);

    const wakeWaiters = () => {
        while (active < concurrency && waiters.length > 0) {
            active += 1;
            waiters.shift()();
        }
    };
    const waitForSlot = async () => {
        if (active < concurrency) {
            active += 1;
            return;
        }
        await new Promise(resolve => waiters.push(resolve));
    };
    const quotaSafeTime = () => Math.max(
        retryAt || 0,
        remaining !== null && remaining <= margin
            ? resetAt === null ? retryAt || 0 : resetAt + margin * 1000
            : 0,
    );
    const reserveRequest = async deadline => {
        let finishPacing;
        const previousPacing = pacingTail;
        pacingTail = new Promise(resolve => { finishPacing = resolve; });
        await previousPacing;
        try {
            let reservedAt = now();
            while (true) {
                const quotaSafeAt = quotaSafeTime();
                if (quotaSafeAt > deadline) throw new GithubQuotaPauseError({retryAt: quotaSafeAt, remaining});
                const safeAt = Math.max(nextRequestAt, quotaSafeAt);
                const delay = Math.max(0, safeAt - Math.max(now(), reservedAt));
                if (delay > 0) await sleep(delay);
                reservedAt = Math.max(now(), safeAt);
                if (quotaSafeTime() <= reservedAt) break;
            }
            const usableQuota = remaining === null ? null : Math.max(0, remaining - margin);
            const quotaPacing = resetAt !== null && usableQuota > 0
                ? Math.ceil(Math.max(0, resetAt - reservedAt) / usableQuota)
                : 0;
            nextRequestAt = reservedAt + Math.max(pacingMs, quotaPacing);
            if (remaining !== null && remaining > 0) remaining -= 1;
        } finally {
            finishPacing();
        }
    };

    return {
        async acquire(deadline = Number.POSITIVE_INFINITY) {
            await waitForSlot();
            let released = false;
            const release = () => {
                if (released) return;
                released = true;
                active -= 1;
                wakeWaiters();
            };
            try {
                await reserveRequest(deadline);
                return release;
            } catch (error) {
                release();
                throw error;
            }
        },
        observe(response, observation = {}) {
            const observedAt = now();
            const headerRemaining = parseNumericHeader(response.headers, "x-ratelimit-remaining");
            const headerReset = parseNumericHeader(response.headers, "x-ratelimit-reset");
            const limited = observation.rateLimited ?? isRateLimited(response);
            const rapidQuotaDrop = headerRemaining !== null && lastObservedRemaining !== null && lastObservedAt !== null
                && lastObservedRemaining - headerRemaining >= Math.max(2, concurrency * 2)
                && observedAt - lastObservedAt <= RAPID_QUOTA_WINDOW_MS;
            const highLatency = Number.isFinite(observation.latencyMs) && observation.latencyMs >= HIGH_LATENCY_MS;
            if (headerRemaining !== null) remaining = headerRemaining;
            if (headerReset !== null && headerReset > 0) resetAt = headerReset * 1000;
            if (limited) {
                concurrency = Math.max(1, Math.floor(concurrency / 2));
                stableSince = null;
                const announced = observation.retryDelayMs === undefined
                    ? observedAt + retryDelay({response, now, attempt: 1, rateLimited: true, random, margin})
                    : observedAt + observation.retryDelayMs;
                const announcedReset = remaining !== null && remaining <= margin && resetAt !== null
                    ? resetAt + margin * 1000
                    : 0;
                retryAt = Math.max(retryAt || 0, announced, announcedReset);
                nextRequestAt = retryAt;
            } else if (remaining !== null && remaining <= margin) {
                concurrency = Math.max(1, Math.floor(concurrency / 2));
                stableSince = null;
                retryAt = Math.max(retryAt || 0, resetAt === null
                    ? observedAt + FALLBACK_RATE_LIMIT_DELAY_MS
                    : resetAt + margin * 1000);
                nextRequestAt = retryAt;
            } else if (highLatency || rapidQuotaDrop) {
                concurrency = Math.max(1, Math.floor(concurrency / 2));
                stableSince = null;
            } else if (response.ok && remaining !== null && remaining > margin + concurrency) {
                if (retryAt !== null && retryAt <= observedAt) retryAt = null;
                stableSince ??= observedAt;
                if (observedAt - stableSince >= STABLE_WINDOW_MS && concurrency < MAX_COORDINATED_CONCURRENCY) {
                    concurrency += 1;
                    stableSince = observedAt;
                    wakeWaiters();
                }
            } else {
                stableSince = null;
            }
            if (headerRemaining !== null) lastObservedRemaining = headerRemaining;
            lastObservedAt = observedAt;
        },
        get concurrency() { return concurrency; },
        get active() { return active; },
        get state() { return {remaining, resetAt, retryAt, concurrency}; },
        restore,
    };
};

const findBaselinePage = (baselinePages, requested) => {
    if (!baselinePages) return null;
    const pages = Array.isArray(baselinePages) ? baselinePages : Object.values(baselinePages);
    return pages.find(page => isExactPageValidatorMatch(requested, page)) || null;
};

const buildRequestHeaders = (config, definition, credential) => ({
    Accept: definition.accept || config.accept,
    "X-GitHub-Api-Version": config.apiVersion,
    "User-Agent": config.userAgent,
    Authorization: `Bearer ${credential.getToken()}`,
});

const parseLinkHeader = header => {
    if (!header) return {};
    const links = {};
    for (const part of header.split(",")) {
        const match = part.match(/^\s*<([^>]+)>\s*;\s*rel="?([^";]+)"?/);
        if (match) links[match[2]] = match[1];
    }
    return links;
};

const sanitizeStatusError = (status, endpoint, retryable) => new GithubRequestError(
    retryable ? "RETRYABLE_HTTP" : ({401: "AUTHENTICATION_FAILED", 403: "PERMISSION_DENIED", 404: "NOT_FOUND"}[status] || "HTTP_ERROR"),
    `GitHub ${endpoint} request failed (${status})`,
    {status, endpoint, retryable},
);

const classifySuccess = (endpoint, values, response) => {
    if (endpoint === "diff" && response.status === 206) return "TRUNCATED";
    if (values.length === 0 && endpoint !== "metadata") return "COMPLETE_EMPTY";
    return "COMPLETE";
};

const createGithubClient = ({config, fetch: fetchImplementation = globalThis.fetch, sleep = async delay => new Promise(resolve => setTimeout(resolve, delay)), now = Date.now, random = Math.random, readSecretFile = path => readFileSync(path, "utf8"), environment = process.env}) => {
    if (typeof fetchImplementation !== "function") throw new TypeError("fetch implementation is required");
    const defaultCoordinator = createQuotaCoordinator({sleep, now, random});
    let sharedCredential;
    let credentialResolved = false;
    const getSharedCredential = () => {
        if (!credentialResolved) {
            sharedCredential = resolveCredential(config, "shared/credential", environment, readSecretFile);
            credentialResolved = true;
        }
        return sharedCredential;
    };
    const requestPage = async ({endpoint, url, credential, deadline, pageOrdinal, repository, number, baselinePages, coordinator, telemetry = null, executionId = null, runId = null, studyId = null, prCardId = null}) => {
        const definition = ENDPOINTS[endpoint];
        const requestUrl = new URL(url);
        const fingerprint = checksum({
            method: definition.method,
            apiBase: config.apiBase,
            path: requestUrl.pathname,
            query: requestUrl.search,
            endpoint,
            version: config.apiVersion,
            accept: definition.accept || config.accept,
            pageOrdinal,
        });
        const requestIdentity = {repository, number, endpoint, pageOrdinal, requestFingerprint: fingerprint, apiVersion: config.apiVersion, accept: definition.accept || config.accept};
        const budgetStartedAt = now();
        let attempt = 0;
        let waited = 0;
        const waitWouldExceedDeadline = delay => Math.max(now(), budgetStartedAt + waited) + delay > deadline;
        const recordTelemetry = async event => {
            try {
                await telemetry?.record?.(event);
            } catch (error) {
                throw new GithubTelemetryPersistenceError(error, endpoint);
            }
        };
        while (attempt < config.maxAttempts) {
            let release;
            let timeout;
            let attemptId = null;
            let startedAt = null;
            let telemetryFinished = false;
            try {
                release = await coordinator?.acquire(deadline);
                attempt += 1;
                attemptId = randomUUID();
                startedAt = now();
                await recordTelemetry({eventType: "ATTEMPT_STARTED", eventId: randomUUID(), attemptId, executionId, runId, studyId, prCardId, endpoint, pageOrdinal, attemptNumber: attempt, fingerprint, occurredAt: new Date(startedAt).toISOString()});
                const headers = buildRequestHeaders(config, definition, credential);
                const baseline = findBaselinePage(baselinePages, requestIdentity);
                if (baseline?.etag) headers["If-None-Match"] = baseline.etag;
                const controller = new AbortController();
                const requestStartedAt = now();
                timeout = setTimeout(() => controller.abort(), config.timeoutMs);
                const response = await fetchImplementation(url, {method: definition.method, headers, signal: controller.signal});
                const latencyMs = Math.max(0, now() - requestStartedAt);
                if (response.status === 304) {
                    await recordTelemetry({eventType: "ATTEMPT_FINISHED", eventId: randomUUID(), attemptId, executionId, runId, studyId, prCardId, endpoint, pageOrdinal, attemptNumber: attempt, fingerprint, occurredAt: new Date(now()).toISOString(), durationMs: now() - startedAt, classification: "NOT_MODIFIED", decision: "ACCEPT", httpStatus: 304, requestId: response.headers.get("x-github-request-id")});
                    telemetryFinished = true;
                    coordinator?.observe(response, {latencyMs});
                    if (!isExactPageValidatorMatch(requestIdentity, baseline)) throw new GithubRequestError("BASELINE_REQUIRED", "GitHub conditional response has no compatible baseline", {endpoint});
                    return {...baseline, httpStatus: 304, reused: true};
                }
                if (!response.ok) {
                    const errorMessage = await readErrorMessage(response);
                    const classification = classifyHttpResponse(response, errorMessage);
                    const rateLimited = classification.classification === "RATE_LIMIT";
                    const retryable = rateLimited || classification.classification === "RETRYABLE_HTTP";
                    const delay = retryDelay({response, now, attempt, rateLimited, random});
                    const willRetry = retryable && attempt < config.maxAttempts;
                    const hint = retryHint(response, now);
                    await recordTelemetry({eventType: "ATTEMPT_FINISHED", eventId: randomUUID(), attemptId, executionId, runId, studyId, prCardId, endpoint, pageOrdinal, attemptNumber: attempt, fingerprint, occurredAt: new Date(now()).toISOString(), durationMs: now() - startedAt, ...classification, httpStatus: response.status, errorCode: rateLimited ? "RATE_LIMITED" : null, quotaRemaining: parseNumericHeader(response.headers, "x-ratelimit-remaining"), quotaResetAt: parseNumericHeader(response.headers, "x-ratelimit-reset"), retryAfterMs: hint?.source === "RETRY_AFTER" ? hint.delayMs : null, retrySource: hint?.source || (rateLimited ? "FALLBACK_RATE_LIMIT" : "BACKOFF"), scheduledWaitMs: willRetry ? delay : null, waitSource: hint?.source || (rateLimited ? "FALLBACK" : "BACKOFF"), effectiveRetryAt: willRetry ? new Date(now() + delay).toISOString() : null, requestId: response.headers.get("x-github-request-id")});
                    telemetryFinished = true;
                    coordinator?.observe(response, {latencyMs, rateLimited, retryDelayMs: rateLimited ? delay : undefined});
                    const nextRetryAt = coordinator?.state.retryAt || now() + delay;
                    if (rateLimited) {
                        if (attempt >= config.maxAttempts || waitWouldExceedDeadline(delay)) {
                            throw new GithubQuotaPauseError({retryAt: nextRetryAt, remaining: coordinator?.state.remaining});
                        }
                        waited += delay;
                        if (!coordinator) await sleep(delay);
                        continue;
                    }
                    if (retryable && attempt < config.maxAttempts) {
                        if (waitWouldExceedDeadline(delay)) throw new GithubRequestError("WAIT_BUDGET_EXHAUSTED", "GitHub retry wait budget exhausted", {endpoint, retryable: true});
                        waited += delay;
                        await sleep(delay);
                        continue;
                    }
                    throw sanitizeStatusError(response.status, endpoint, retryable);
                }
                await recordTelemetry({eventType: "ATTEMPT_FINISHED", eventId: randomUUID(), attemptId, executionId, runId, studyId, prCardId, endpoint, pageOrdinal, attemptNumber: attempt, fingerprint, occurredAt: new Date(now()).toISOString(), durationMs: now() - startedAt, classification: "SUCCESS", decision: "ACCEPT", httpStatus: response.status, requestId: response.headers.get("x-github-request-id"), quotaRemaining: parseNumericHeader(response.headers, "x-ratelimit-remaining"), quotaResetAt: parseNumericHeader(response.headers, "x-ratelimit-reset")});
                telemetryFinished = true;
                coordinator?.observe(response, {latencyMs});
                const contentLength = Number(response.headers.get("content-length"));
                if (endpoint === "diff" && Number.isFinite(contentLength) && contentLength > MAX_DIFF_BYTES) {
                    await response.body?.cancel();
                    return {
                        endpoint,
                        repository,
                        number,
                        pageOrdinal,
                        requestFingerprint: fingerprint,
                        apiVersion: config.apiVersion,
                        accept: definition.accept || config.accept,
                        etag: response.headers.get("etag"),
                        httpStatus: response.status,
                        responseChecksum: null,
                        normalizedChecksum: null,
                        itemCount: null,
                        nextUrl: null,
                        state: "TRUNCATED",
                        normalizedPayload: null,
                        normalized: null,
                        next: null,
                        status: response.status,
                        fingerprint,
                    };
                }
                let rawBody;
                try {
                    rawBody = await response.text();
                } catch (_error) {
                    throw new GithubRequestError("MALFORMED_JSON", "GitHub response was not valid JSON", {endpoint});
                }
                let payload = rawBody;
                if (endpoint !== "diff") {
                    try {
                        payload = JSON.parse(rawBody);
                    } catch (_error) {
                        throw new GithubRequestError("MALFORMED_JSON", "GitHub response was not valid JSON", {endpoint});
                    }
                }
                const normalized = normalizeResponse(endpoint, payload);
                const nextUrl = parseLinkHeader(response.headers.get("link")).next || null;
                const state = endpoint === "diff" && response.status === 206
                    ? "TRUNCATED"
                    : nextUrl ? "PARTIAL" : classifySuccess(endpoint, endpoint === "metadata" ? [normalized] : endpoint === "diff" ? [normalized] : normalized, response);
                return {
                    endpoint,
                    repository,
                    number,
                    pageOrdinal,
                    requestFingerprint: fingerprint,
                    apiVersion: config.apiVersion,
                    accept: definition.accept || config.accept,
                    etag: response.headers.get("etag"),
                    httpStatus: response.status,
                    responseChecksum: checksumRaw(rawBody),
                    normalizedChecksum: checksum(normalized),
                    itemCount: endpoint === "metadata" || endpoint === "diff" ? 1 : normalized.length,
                    nextUrl,
                    state,
                    normalizedPayload: normalized,
                    normalized,
                    next: nextUrl,
                    status: response.status,
                    fingerprint,
                };
            } catch (error) {
                if (error instanceof GithubQuotaPauseError || error instanceof GithubTelemetryPersistenceError) throw error;
                if (!telemetryFinished) {
                    await recordTelemetry({eventType: "ATTEMPT_FINISHED", eventId: randomUUID(), attemptId, executionId, runId, studyId, prCardId, endpoint, pageOrdinal, attemptNumber: attempt, fingerprint, occurredAt: new Date(now()).toISOString(), durationMs: now() - startedAt, classification: error instanceof GithubRequestError ? "TERMINAL_HTTP" : error?.name === "AbortError" ? "TIMEOUT" : "TRANSPORT_ERROR", decision: attempt < config.maxAttempts ? "RETRY" : "FAIL", errorCode: error instanceof GithubRequestError ? error.code : error?.name === "AbortError" ? "TIMEOUT" : "TRANSPORT_RETRY_EXHAUSTED"});
                    telemetryFinished = true;
                }
                if (error instanceof GithubRequestError) throw error;
                if (attempt >= config.maxAttempts || now() >= deadline) throw new GithubRequestError("TRANSPORT_RETRY_EXHAUSTED", "GitHub transport request failed", {endpoint, retryable: true});
                const delay = RETRY_BACKOFF_MS * (2 ** (attempt - 1)) + QUOTA_MARGIN * 1000 + Math.floor(random() * MAX_JITTER_MS);
                if (waitWouldExceedDeadline(delay)) throw new GithubRequestError("WAIT_BUDGET_EXHAUSTED", "GitHub retry wait budget exhausted", {endpoint, retryable: true});
                waited += delay;
                await sleep(delay);
                continue;
            } finally {
                release?.();
                if (timeout !== undefined) clearTimeout(timeout);
            }
        }
        throw new GithubRequestError("RETRY_EXHAUSTED", "GitHub request retry budget exhausted", {endpoint, retryable: true});
    };

    const fetchEndpoint = async ({repository: inputRepository, number, endpoint, credential, runDeadline = Number.POSITIVE_INFINITY, baselinePages = null, checkpointPages = null, coordinator = defaultCoordinator, telemetry = null, executionId = null, runId = null, studyId = null, prCardId = null}) => {
        const repository = normalizeRepository(inputRepository);
        const definition = ENDPOINTS[endpoint];
        if (!definition) throw new GithubRequestError("UNKNOWN_ENDPOINT", "GitHub endpoint is not configured", {endpoint});
        const deadline = Math.min(now() + config.pageWaitBudgetMs, runDeadline);
        let url = new URL(definition.path(repository, number), config.apiBase).toString();
        const values = [];
        const pageRecords = [];
        let pageCount = 0;
        let lastPage = null;
        const visitedUrls = new Set();
        const checkpointForOrdinal = ordinal => checkpointPages?.find(page => page.pageOrdinal === ordinal) || null;
        const assertCheckpoint = (page, requestedUrl) => {
            if (!page) return;
            const requestUrl = new URL(requestedUrl);
            const expectedFingerprint = checksum({
                method: definition.method,
                apiBase: config.apiBase,
                path: requestUrl.pathname,
                query: requestUrl.search,
                endpoint,
                version: config.apiVersion,
                accept: definition.accept || config.accept,
                pageOrdinal: page.pageOrdinal,
            });
            const expectedNormalized = page.normalizedPayload === null || page.normalizedPayload === undefined
                ? null
                : checksum(page.normalizedPayload);
            const expectedResponse = page.normalizedPayload === null || page.normalizedPayload === undefined
                ? null
                : checksumRaw(endpoint === "diff" ? page.normalizedPayload : JSON.stringify(page.normalizedPayload));
            if (page.endpoint !== undefined && page.endpoint !== endpoint || page.pageOrdinal < 0
                || page.requestFingerprint !== undefined && page.requestFingerprint !== expectedFingerprint
                || page.apiVersion !== undefined && page.apiVersion !== config.apiVersion
                || page.accept !== undefined && page.accept !== (definition.accept || config.accept)
                || page.normalizedChecksum !== undefined && page.normalizedChecksum !== null && page.normalizedChecksum !== expectedNormalized
                || page.responseChecksum !== undefined && page.responseChecksum !== null && page.responseChecksum !== expectedResponse) {
                throw new GithubRequestError("CHECKPOINT_CONFLICT", "Persisted GitHub checkpoint conflicts with the requested page", {endpoint});
            }
            if (page.state === "PARTIAL" && typeof (page.nextUrl || page.next) !== "string") {
                throw new GithubRequestError("CHECKPOINT_CONFLICT", "Persisted partial checkpoint has no next URL", {endpoint});
            }
        };
        try {
            while (url) {
                if (visitedUrls.has(url)) throw new GithubRequestError("PAGINATION_LOOP", "GitHub pagination repeated a page", {endpoint});
                visitedUrls.add(url);
                const checkpointPage = checkpointForOrdinal(pageCount);
                assertCheckpoint(checkpointPage, url);
                if (checkpointPage?.state === "FAILED") throw new GithubRequestError("CHECKPOINT_CONFLICT", "Failed checkpoint cannot be resumed", {endpoint});
                const page = checkpointPage || await requestPage({endpoint, url, credential, deadline, pageOrdinal: pageCount, repository, number, baselinePages, coordinator, telemetry, executionId, runId, studyId, prCardId});
                lastPage = page;
                pageRecords.push(page);
                if (endpoint === "metadata") return {endpoint, status: page.state, value: page.normalized, pages: 1, etag: page.etag, fingerprint: page.fingerprint, pageRecords: [page], snapshotManifest: buildSnapshotManifest({pages: [page]})};
                if (endpoint === "diff") return {endpoint, status: page.state, value: page.normalized, pages: 1, etag: page.etag, fingerprint: page.fingerprint, pageRecords: [page], snapshotManifest: buildSnapshotManifest({pages: [page]})};
                values.push(...page.normalized);
                pageCount += 1;
                url = page.nextUrl || page.next || null;
            }
            return {endpoint, status: classifySuccess(endpoint, values, lastPage), value: values, pages: pageCount, etag: lastPage?.etag || null, fingerprint: lastPage?.fingerprint || null, pageRecords, snapshotManifest: buildSnapshotManifest({pages: pageRecords})};
        } catch (error) {
            if (error instanceof GithubTelemetryPersistenceError) throw error;
            if (error instanceof GithubQuotaPauseError) return {
                endpoint,
                status: "PAUSED",
                value: null,
                errorCode: error.code,
                retryAt: error.retryAt,
                quota: coordinator?.state || {remaining: error.remaining, resetAt: null, retryAt: error.retryAt, concurrency: 1},
                pageRecords,
            };
            if (!(error instanceof GithubRequestError)) throw error;
            if (!definition.required && ["NOT_FOUND", "PERMISSION_DENIED"].includes(error.code)) return {endpoint, status: "UNAVAILABLE", value: null, errorCode: error.code, httpStatus: error.status};
            return {endpoint, status: "FAILED", value: null, errorCode: error.code, httpStatus: error.status};
        }
    };

    const fetchPullRequest = async ({repository: inputRepository, number, baselinePages = null, checkpointPages = {}, coordinator = defaultCoordinator, quotaState = null, telemetry = null, executionId = randomUUID(), runId = null, studyId = null, prCardId = null}) => {
        const repository = normalizeRepository(inputRepository);
        coordinator?.restore?.(quotaState);
        const runDeadline = now() + config.runWaitBudgetMs;
        let credential;
        try {
            credential = getSharedCredential();
        } catch (error) {
            if (error instanceof GithubConfigError) return {repository, status: "FAILED", errorCode: error.code, endpoints: {}};
            throw error;
        }
        const endpointNames = Object.keys(ENDPOINTS);
        const endpoints = {};
        let cursor = 0;
        const worker = async () => {
            while (cursor < endpointNames.length) {
                const endpoint = endpointNames[cursor];
                cursor += 1;
                endpoints[endpoint] = await fetchEndpoint({repository, number, endpoint, credential, runDeadline, baselinePages, checkpointPages: checkpointPages[endpoint], coordinator, telemetry, executionId, runId, studyId, prCardId});
            }
        };
        await Promise.all(Array.from({length: Math.min(config.concurrency, endpointNames.length)}, worker));
        const requiredResults = Object.values(endpoints).filter(result => ENDPOINTS[result.endpoint].required);
        const omitted = endpoints.metadata?.status === "FAILED" && endpoints.metadata.errorCode === "NOT_FOUND";
        const paused = Object.values(endpoints).find(result => result.status === "PAUSED");
        const requiredFailed = requiredResults.some(result => result.status === "FAILED");
        const firstFailedRequiredName = endpointNames.find(name => ENDPOINTS[name].required && endpoints[name]?.status === "FAILED");
        let errorCode;
        if (omitted) errorCode = "NOT_FOUND";
        else if (paused) errorCode = paused.errorCode;
        else if (requiredFailed) errorCode = firstFailedRequiredName ? endpoints[firstFailedRequiredName].errorCode : "UNKNOWN";
        else errorCode = undefined;
        return {repository, alias: credential.alias, status: paused ? "PAUSED" : omitted ? "OMITTED" : requiredFailed ? "FAILED" : "COMPLETE", errorCode, retryAt: paused?.retryAt, quota: coordinator.state, endpoints};
    };

    return {fetchEndpoint, fetchPullRequest};
};

export {
    ENDPOINTS,
    GithubQuotaPauseError,
    MAX_DIFF_BYTES,
    TERMINAL_STATES,
    GithubRequestError,
    buildRunManifest,
    buildSnapshotManifest,
    canonicalize,
    checksum,
    checksumRunManifest,
    checksumSnapshotManifest,
    createGithubClient,
    createQuotaCoordinator,
    isExactPageValidatorMatch,
    classifyHttpResponse,
    parseLinkHeader,
};
