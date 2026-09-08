import {withTransaction} from "./transaction.js";
import {canonicalize} from "./github-pr-manifest.js";
import {
    assertExactCards,
    assertRunCards,
    assertStudyMapping,
    GithubPersistenceError,
} from "./github-pr-persistence-validation.js";

const EXPECTED_CARD_COUNT = 300;
const REQUIRED_ENDPOINTS = Object.freeze([
    "metadata",
    "commits",
    "files",
    "reviews",
    "issueComments",
    "reviewComments",
]);

const sanitizeCheckpoint = checkpoint => ({
    cardOrdinal: Number.isInteger(checkpoint?.cardOrdinal) ? checkpoint.cardOrdinal : null,
    endpoint: typeof checkpoint?.endpoint === "string" ? checkpoint.endpoint : null,
    pageOrdinal: Number.isInteger(checkpoint?.pageOrdinal) ? checkpoint.pageOrdinal : null,
    nextUrl: typeof checkpoint?.nextUrl === "string" ? checkpoint.nextUrl : null,
});

const sanitizeQuota = quota => ({
    remaining: Number.isInteger(quota?.remaining) ? quota.remaining : null,
    resetAt: Number.isFinite(quota?.resetAt) ? quota.resetAt : null,
    retryAt: Number.isFinite(quota?.retryAt) ? quota.retryAt : null,
    concurrency: Number.isInteger(quota?.concurrency) ? Math.min(4, Math.max(1, quota.concurrency)) : 1,
});

const TELEMETRY_EVENT_TYPES = Object.freeze(["ATTEMPT_STARTED", "ATTEMPT_FINISHED", "PAUSE_COMMITTED", "RESUME_STARTED"]);
const sanitizeTelemetry = event => {
    const allowed = {
        eventId: event.eventId,
        eventType: event.eventType,
        runId: event.runId,
        studyId: event.studyId,
        executionId: event.executionId ?? null,
        prCardId: event.prCardId ?? null,
        attemptId: event.attemptId ?? null,
        endpoint: event.endpoint ?? null,
        pageOrdinal: Number.isInteger(event.pageOrdinal) ? event.pageOrdinal : null,
        attemptNumber: Number.isInteger(event.attemptNumber) ? event.attemptNumber : null,
        fingerprint: event.fingerprint ?? null,
        occurredAt: event.occurredAt ?? new Date().toISOString(),
        durationMs: Number.isInteger(event.durationMs) ? event.durationMs : null,
        classification: event.classification ?? null,
        decision: event.decision ?? null,
        httpStatus: Number.isInteger(event.httpStatus) ? event.httpStatus : null,
        errorCode: event.errorCode ?? null,
        rateLimitType: event.rateLimitType ?? null,
        quotaRemaining: Number.isInteger(event.quotaRemaining) ? event.quotaRemaining : null,
        quotaResetAt: (() => {
            if (event.quotaResetAt == null) return null;
            if (Number.isFinite(event.quotaResetAt)) return new Date(event.quotaResetAt * 1000).toISOString();
            return event.quotaResetAt;
        })(),
        retryAfterMs: Number.isInteger(event.retryAfterMs) ? event.retryAfterMs : null,
        effectiveRetryAt: event.effectiveRetryAt ?? null,
        retrySource: event.retrySource ?? null,
        waitSource: event.waitSource ?? null,
        scheduledWaitMs: Number.isInteger(event.scheduledWaitMs) ? event.scheduledWaitMs : null,
        requestId: event.requestId ?? null,
        pauseReason: event.pauseReason ?? null,
        causalEventId: event.causalEventId ?? null,
        checkpoint: event.checkpoint ? {
            cardOrdinal: Number.isInteger(event.checkpoint.cardOrdinal) ? event.checkpoint.cardOrdinal : null,
            endpoint: typeof event.checkpoint.endpoint === "string" ? event.checkpoint.endpoint : null,
            pageOrdinal: Number.isInteger(event.checkpoint.pageOrdinal) ? event.checkpoint.pageOrdinal : null,
        } : null,
    };
    if (!TELEMETRY_EVENT_TYPES.includes(allowed.eventType)) throw new GithubPersistenceError("TELEMETRY_EVENT_INVALID", "Unknown telemetry event type");
    return allowed;
};

const recordTelemetryEvent = async (client, event) => {
    const value = sanitizeTelemetry(event);
    const parameters = [value.eventId, value.eventType, value.runId, value.studyId, value.executionId, value.prCardId, value.attemptId, value.endpoint, value.pageOrdinal, value.attemptNumber, value.fingerprint, value.occurredAt, value.durationMs, value.classification, value.decision, value.httpStatus, value.errorCode, value.rateLimitType, value.quotaRemaining, value.quotaResetAt, value.retryAfterMs, value.effectiveRetryAt, value.retrySource, value.waitSource, value.scheduledWaitMs, value.requestId, value.pauseReason, value.causalEventId, value.checkpoint ? JSON.stringify(value.checkpoint) : null];
    const result = await client.query(`INSERT INTO github_api_telemetry_event(
        event_id, event_type, run_id, study_id, execution_id, pr_card_id, attempt_id, endpoint,
        page_ordinal, attempt_number, fingerprint, occurred_at, duration_ms, classification, decision,
        http_status, error_code, rate_limit_type, quota_remaining, quota_reset_at, retry_after_ms,
        effective_retry_at, retry_source, wait_source, scheduled_wait_ms, request_id, pause_reason, causal_event_id, checkpoint
     ) VALUES (${parameters.map((_value, index) => `$${index + 1}`).join(", ")})
     ON CONFLICT DO NOTHING
     RETURNING event_id`, parameters);
    if (result.rows?.length) return result;
    const {rows: [existing]} = await client.query("SELECT * FROM github_api_telemetry_event WHERE event_id = $1 OR (attempt_id = $2 AND event_type = $3)", [value.eventId, value.attemptId, value.eventType]);
    const conflicts = existing && [
        ["event_type", value.eventType], ["run_id", value.runId], ["study_id", value.studyId],
        ["attempt_id", value.attemptId], ["endpoint", value.endpoint], ["page_ordinal", value.pageOrdinal],
        ["attempt_number", value.attemptNumber], ["fingerprint", value.fingerprint],
        ["classification", value.classification], ["decision", value.decision], ["http_status", value.httpStatus],
    ].some(([field, expected]) => existing[field] !== undefined && (existing[field] ?? null) !== expected);
    if (!existing || conflicts) {
        throw new GithubPersistenceError("TELEMETRY_CONFLICT", "Telemetry event re-delivery conflicts with the persisted event");
    }
    return result;
};

const telemetryReport = async (client, runId) => {
    const {rows: [summary]} = await client.query(`SELECT
        COUNT(*)::INTEGER AS event_count,
        COUNT(*) FILTER (WHERE event_type = 'ATTEMPT_STARTED')::INTEGER AS started_count,
        COUNT(*) FILTER (WHERE event_type = 'ATTEMPT_FINISHED')::INTEGER AS finished_count,
        COUNT(*) FILTER (WHERE classification = 'RATE_LIMIT' AND http_status = 403)::INTEGER AS rate_limit_403_count,
        COUNT(*) FILTER (WHERE classification = 'RATE_LIMIT' AND http_status = 429)::INTEGER AS rate_limit_429_count,
        COUNT(*) FILTER (WHERE decision = 'RETRY')::INTEGER AS retry_count,
        COUNT(*) FILTER (WHERE event_type = 'PAUSE_COMMITTED')::INTEGER AS pause_count,
        MIN(occurred_at) AS first_observation, MAX(occurred_at) AS last_observation
        FROM github_api_telemetry_event WHERE run_id = $1`, [runId]);
    const {rows: [run]} = await client.query("SELECT attempt_telemetry_version FROM github_enrichment_run WHERE id = $1", [runId]);
    if (run?.attempt_telemetry_version === null || run?.attempt_telemetry_version === undefined) return {telemetry_status: "NOT_INSTRUMENTED", event_count: 0, rate_limit_403_count: null, rate_limit_429_count: null};
    const complete = summary.started_count === summary.finished_count;
    return {...summary, telemetry_status: complete ? "COMPLETE" : "INCOMPLETE"};
};

const assertTelemetryComplete = async (client, run) => {
    if (run.attempt_telemetry_version === null || run.attempt_telemetry_version === undefined) return;
    const {rows} = await client.query(
        `SELECT event_type, attempt_id
         FROM github_api_telemetry_event
         WHERE run_id = $1 AND event_type IN ('ATTEMPT_STARTED', 'ATTEMPT_FINISHED')`,
        [run.id],
    );
    const attempts = new Map();
    for (const event of rows) {
        if (!event.attempt_id) throw new GithubPersistenceError("TELEMETRY_INCOMPLETE", "Instrumented telemetry event has no attempt");
        const pair = attempts.get(event.attempt_id) || {started: 0, finished: 0};
        if (event.event_type === "ATTEMPT_STARTED") pair.started += 1;
        if (event.event_type === "ATTEMPT_FINISHED") pair.finished += 1;
        attempts.set(event.attempt_id, pair);
    }
    if (attempts.size === 0 || [...attempts.values()].some(pair => pair.started !== 1 || pair.finished !== 1)) {
        throw new GithubPersistenceError("TELEMETRY_INCOMPLETE", "Instrumented enrichment run has unpaired API attempts");
    }
};

const createRunningRun = async options => {
    const {pool, studyId, sourceChecksum, configFingerprint, normalizerVersion, expectedCardCount = EXPECTED_CARD_COUNT, resumeRunId = null} = options;
    return withTransaction(pool, async client => {
        const {rows: [ study ]} = await client.query(
            `SELECT id, source_checksum, expected_card_count
             FROM study
             WHERE id = $1
             FOR UPDATE`,
            [ studyId ],
        );
        if (!study || study.source_checksum !== sourceChecksum || study.expected_card_count !== expectedCardCount) {
            throw new GithubPersistenceError("STUDY_CHECKSUM_MISMATCH", "Run study checksum or card count does not match");
        }
        const {rows: cards} = await client.query(
            `SELECT pr_card_id, ordinal
             FROM study_card
             WHERE study_id = $1
             ORDER BY ordinal
             FOR UPDATE`,
            [ studyId ],
        );
        assertExactCards(cards, expectedCardCount);
        const {rows: runningRuns} = await client.query(
            `SELECT id, study_id, source_checksum, config_fingerprint, normalizer_version, attempt_telemetry_version, state,
                    checkpoint, quota_metadata, next_resume_at
             FROM github_enrichment_run
             WHERE study_id = $1 AND state = 'RUNNING'
             ORDER BY created_at
             FOR UPDATE`,
            [studyId],
        );
        if (resumeRunId) {
            const run = runningRuns.find(candidate => candidate.id === resumeRunId);
            if (!run || run.source_checksum !== sourceChecksum
                || run.config_fingerprint !== configFingerprint
                || run.normalizer_version !== normalizerVersion) {
                throw new GithubPersistenceError("RUN_NOT_RESUMABLE", "Only a compatible running study run can be resumed");
            }
            return {...run, cards};
        }
        if (runningRuns.length > 1) {
            throw new GithubPersistenceError("INCOMPATIBLE_RUNNING_RUN", "Multiple running enrichment runs require explicit resolution");
        }
        if (runningRuns[0]) {
            const run = runningRuns[0];
            if (run.source_checksum !== sourceChecksum
                || run.config_fingerprint !== configFingerprint
                || run.normalizer_version !== normalizerVersion) {
                throw new GithubPersistenceError("INCOMPATIBLE_RUNNING_RUN", "Existing running enrichment run is incompatible");
            }
            return {...run, cards};
        }
        const {rows: [ run ]} = await client.query(
            `INSERT INTO github_enrichment_run(
                study_id, source_checksum, config_fingerprint, normalizer_version, attempt_telemetry_version, state
) VALUES ($1, $2, $3, $4, 1, 'RUNNING')
             RETURNING id, study_id, source_checksum, config_fingerprint, normalizer_version, attempt_telemetry_version, state`,
            [ studyId, sourceChecksum, configFingerprint, normalizerVersion ],
        );
        return {...run, cards};
    });
};

const assertNormalizedPage = page => {
    if (Object.hasOwn(page, "rawBody") || Object.hasOwn(page, "raw_payload") || Object.hasOwn(page, "body")) {
        throw new GithubPersistenceError("RAW_PAYLOAD_REJECTED", "Only normalized page metadata may be persisted");
    }
};

const stagePage = async (client, options) => {
    assertNormalizedPage(options);
    const {
        runId, studyId, prCardId, endpoint, pageOrdinal, requestFingerprint, apiVersion, accept,
        etag = null, httpStatus = null, responseChecksum = null, normalizedChecksum = null,
        itemCount = null, nextUrl = null, state, normalizedPayload = null,
    } = options;
    const result = await client.query(
        `INSERT INTO github_run_page(
            run_id, study_id, pr_card_id, endpoint, page_ordinal, request_fingerprint,
            api_version, accept, etag, http_status, response_checksum, normalized_checksum,
            item_count, next_url, state, normalized_payload
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
         ON CONFLICT (run_id, pr_card_id, endpoint, page_ordinal) DO NOTHING
         RETURNING run_id, study_id, pr_card_id, endpoint, page_ordinal`,
        [
            runId, studyId, prCardId, endpoint, pageOrdinal, requestFingerprint, apiVersion, accept,
            etag, httpStatus, responseChecksum, normalizedChecksum, itemCount, nextUrl, state,
            normalizedPayload === null ? null : JSON.stringify(normalizedPayload),
        ],
    );
    if (result.rows?.length) return result;
    const {rows: [existing]} = await client.query(
        `SELECT run_id, study_id, pr_card_id, endpoint, page_ordinal, request_fingerprint,
                api_version, accept, etag, http_status, response_checksum, normalized_checksum,
                item_count, next_url, state, normalized_payload
         FROM github_run_page
         WHERE run_id = $1 AND pr_card_id = $2 AND endpoint = $3 AND page_ordinal = $4`,
        [runId, prCardId, endpoint, pageOrdinal],
    );
    const matches = existing
        && existing.study_id === studyId
        && existing.request_fingerprint === requestFingerprint
        && existing.api_version === apiVersion
        && existing.accept === accept
        && (existing.etag ?? null) === etag
        && (existing.http_status ?? null) === httpStatus
        && (existing.response_checksum ?? null) === responseChecksum
        && (existing.normalized_checksum ?? null) === normalizedChecksum
        && (existing.item_count ?? null) === itemCount
        && (existing.next_url ?? null) === nextUrl
        && existing.state === state
        && canonicalize(existing.normalized_payload === null ? null : existing.normalized_payload) === canonicalize(normalizedPayload);
    if (!existing || !matches) throw new GithubPersistenceError("PAGE_CONFLICT", "Persisted GitHub page conflicts with the incoming page");
    return result;
};

const loadCommittedCardIds = async (client, runId) => {
    const {rows} = await client.query(
        "SELECT pr_card_id, ordinal FROM github_enrichment_run_card WHERE run_id = $1 ORDER BY ordinal",
        [runId],
    );
    return rows;
};

const loadRunPages = async (client, runId, prCardId) => {
    const {rows} = await client.query(
        `SELECT endpoint, page_ordinal AS "pageOrdinal", request_fingerprint AS "requestFingerprint",
                api_version AS "apiVersion", accept, etag, http_status AS "httpStatus",
                response_checksum AS "responseChecksum", normalized_checksum AS "normalizedChecksum",
                item_count AS "itemCount", next_url AS "nextUrl", state,
                normalized_payload AS "normalizedPayload"
         FROM github_run_page
         WHERE run_id = $1 AND pr_card_id = $2
         ORDER BY endpoint, page_ordinal`,
        [runId, prCardId],
    );
    return rows.map(page => ({...page, normalized: page.normalizedPayload, next: page.nextUrl}));
};

const persistCheckpoint = async (client, options) => {
    const checkpoint = sanitizeCheckpoint(options.checkpoint);
    const quota = sanitizeQuota(options.quota);
    return client.query(
        `UPDATE github_enrichment_run
         SET checkpoint = $2, quota_metadata = $3, next_resume_at = $4, updated_at = NOW()
         WHERE id = $1 AND state = 'RUNNING'`,
        [options.runId, JSON.stringify(checkpoint), JSON.stringify(quota), quota.retryAt ? new Date(quota.retryAt) : null],
    );
};

const upsertSnapshot = async (client, options) => {
    const {prCardId, snapshotChecksum, normalizerVersion, manifest} = options;
    const {rows: inserted} = await client.query(
        `INSERT INTO github_card_snapshot(pr_card_id, snapshot_checksum, normalizer_version, manifest)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (pr_card_id, snapshot_checksum) DO NOTHING
         RETURNING id, pr_card_id, snapshot_checksum, normalizer_version, manifest`,
        [ prCardId, snapshotChecksum, normalizerVersion, manifest ],
    );
    if (inserted[0]) return {snapshot: inserted[0], reused: false};
    const {rows: [snapshot]} = await client.query(
        `SELECT id, pr_card_id, snapshot_checksum, normalizer_version, manifest
         FROM github_card_snapshot
         WHERE pr_card_id = $1 AND snapshot_checksum = $2`,
        [ prCardId, snapshotChecksum ],
    );
    if (!snapshot) throw new GithubPersistenceError("SNAPSHOT_NOT_FOUND", "Equivalent snapshot disappeared");
    return {snapshot, reused: true};
};

const recordRunCard = async (client, options) => {
    const {runId, studyId, prCardId, snapshotId, snapshotChecksum, ordinal} = options;
    const result = await client.query(
        `INSERT INTO github_enrichment_run_card(
            run_id, study_id, pr_card_id, snapshot_id, snapshot_checksum, ordinal
         ) VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (run_id, study_id, pr_card_id) DO NOTHING
         RETURNING run_id, study_id, pr_card_id`,
        [ runId, studyId, prCardId, snapshotId, snapshotChecksum, ordinal ],
    );
    if (result.rows?.length) return result;
    const {rows: [existing]} = await client.query(
        `SELECT run_id, study_id, pr_card_id, snapshot_id, snapshot_checksum, ordinal
         FROM github_enrichment_run_card
         WHERE run_id = $1 AND study_id = $2 AND pr_card_id = $3`,
        [runId, studyId, prCardId],
    );
    if (!existing || existing.snapshot_id !== snapshotId || existing.snapshot_checksum !== snapshotChecksum || existing.ordinal !== ordinal) {
        throw new GithubPersistenceError("RUN_CARD_CONFLICT", "Persisted GitHub run-card mapping conflicts with the incoming mapping");
    }
    return result;
};

const loadRun = async (client, runId, lock = false) => {
    const {rows: [run]} = await client.query(
        `SELECT id, study_id, source_checksum, state, manifest_checksum, attempt_telemetry_version,
                checkpoint, quota_metadata, next_resume_at
         FROM github_enrichment_run
         WHERE id = $1${lock ? " FOR UPDATE" : ""}`,
        [ runId ],
    );
    if (!run) throw new GithubPersistenceError("RUN_NOT_FOUND", "Enrichment run does not exist");
    return run;
};

const loadManifestRows = async (client, runId) => {
    const {rows} = await client.query(
        `SELECT run_card.pr_card_id, run_card.ordinal, run_card.snapshot_checksum,
                snapshot.id AS snapshot_id
         FROM github_enrichment_run_card run_card
         INNER JOIN github_card_snapshot snapshot
             ON snapshot.id = run_card.snapshot_id
            AND snapshot.pr_card_id = run_card.pr_card_id
            AND snapshot.snapshot_checksum = run_card.snapshot_checksum
         WHERE run_card.run_id = $1
         ORDER BY run_card.ordinal`,
        [ runId ],
    );
    return rows;
};

const loadStudyCards = async (client, studyId) => {
    const {rows} = await client.query(
        `SELECT pr_card_id, ordinal
         FROM study_card
         WHERE study_id = $1
         ORDER BY ordinal`,
        [ studyId ],
    );
    return rows;
};

const assertRequiredPages = async (client, runId, expectedCount = EXPECTED_CARD_COUNT) => {
    const {rows} = await client.query(
        `SELECT pr_card_id, endpoint,
                BOOL_AND(state IN ('COMPLETE', 'COMPLETE_EMPTY', 'PARTIAL')) AS complete,
                BOOL_OR(state IN ('COMPLETE', 'COMPLETE_EMPTY')) AS terminal_complete,
                BOOL_AND(state = 'UNAVAILABLE') AS omitted
         FROM github_run_page
         WHERE run_id = $1
         GROUP BY pr_card_id, endpoint`,
        [ runId ],
    );
    const complete = new Set(rows.filter(row => row.complete && row.terminal_complete).map(row => `${row.pr_card_id}:${row.endpoint}`));
    const omitted = new Set(rows.filter(row => row.omitted).map(row => `${row.pr_card_id}:${row.endpoint}`));
    const cardIds = [...new Set(rows.map(row => row.pr_card_id))];
    if (cardIds.length !== expectedCount || cardIds.some(cardId => REQUIRED_ENDPOINTS.some(endpoint => {
        const key = `${cardId}:${endpoint}`;
        return !complete.has(key) && !omitted.has(key);
    }))) {
        throw new GithubPersistenceError("REQUIRED_ENDPOINT_INCOMPLETE", "Every card must complete every required endpoint");
    }
};

const finalizeRun = async options => {
    const {pool, runId, expectedCardCount = EXPECTED_CARD_COUNT} = options;
    return withTransaction(pool, async client => {
        const run = await loadRun(client, runId, true);
        if (run.state !== "RUNNING") throw new GithubPersistenceError("RUN_TERMINAL", "Enrichment run is already terminal");
        await assertTelemetryComplete(client, run);
        await assertRequiredPages(client, runId, expectedCardCount);
        const cards = await loadManifestRows(client, runId);
        assertStudyMapping(await loadStudyCards(client, run.study_id), cards, expectedCardCount);
        const {manifestChecksum} = assertRunCards(cards, expectedCardCount);
        const {rows: [completed]} = await client.query(
            `UPDATE github_enrichment_run
             SET state = 'COMPLETED', manifest_checksum = $2, updated_at = NOW()
             WHERE id = $1 AND state = 'RUNNING'
             RETURNING id, study_id, source_checksum, state, manifest_checksum`,
            [ runId, manifestChecksum ],
        );
        return completed || {...run, state: "COMPLETED", manifest_checksum: manifestChecksum};
    });
};

const markRunFailed = async (pool, runId) => withTransaction(pool, async client => {
    const run = await loadRun(client, runId, true);
    if (run.state !== "RUNNING") return run;
    const {rows: [failed]} = await client.query(
        `UPDATE github_enrichment_run
         SET state = 'FAILED', updated_at = NOW()
         WHERE id = $1 AND state = 'RUNNING'
         RETURNING id, study_id, source_checksum, state, manifest_checksum`,
        [ runId ],
    );
    return failed || {...run, state: "FAILED"};
});

const promoteRun = async options => {
    const {pool, studyId, runId, sourceChecksum, expectedCardCount = EXPECTED_CARD_COUNT} = options;
    return withTransaction(pool, async client => {
        const {rows: [study]} = await client.query(
            `SELECT id, source_checksum, expected_card_count
             FROM study
             WHERE id = $1
             FOR UPDATE`,
            [ studyId ],
        );
        if (!study || study.source_checksum !== sourceChecksum || study.expected_card_count !== expectedCardCount) {
            throw new GithubPersistenceError("STUDY_CHECKSUM_MISMATCH", "Promotion does not match the study");
        }
        const run = await loadRun(client, runId, true);
        if (run.study_id !== studyId || run.source_checksum !== sourceChecksum) {
            throw new GithubPersistenceError("RUN_SCOPE_MISMATCH", "Run belongs to another study or checksum");
        }
        if (run.state !== "COMPLETED") throw new GithubPersistenceError("RUN_NOT_COMPLETED", "Only completed runs can be promoted");
        await assertTelemetryComplete(client, run);
        const {rows: existingPromotion} = await client.query(
            "SELECT study_id FROM study_enrichment_promotion WHERE study_id = $1 FOR UPDATE",
            [ studyId ],
        );
        if (existingPromotion.length > 0) throw new GithubPersistenceError("ALREADY_PROMOTED", "Study already has an enrichment promotion");
        const {rows: decisions} = await client.query(
            `SELECT 1 FROM pr_classification WHERE study_id = $1
             UNION ALL SELECT 1 FROM pr_discard WHERE study_id = $1
             LIMIT 1`,
            [ studyId ],
        );
        if (decisions.length > 0) throw new GithubPersistenceError("DECISIONS_EXIST", "Study with decisions cannot be promoted");
        const cards = await loadManifestRows(client, runId);
        assertStudyMapping(await loadStudyCards(client, studyId), cards, expectedCardCount);
        const {manifestChecksum} = assertRunCards(cards, expectedCardCount);
        if (run.manifest_checksum !== manifestChecksum) throw new GithubPersistenceError("RUN_MANIFEST_MISMATCH", "Run manifest does not match its mappings");
        const {rows: [promotion]} = await client.query(
            `INSERT INTO study_enrichment_promotion(study_id, run_id, source_checksum)
             VALUES ($1, $2, $3)
             RETURNING study_id, run_id, source_checksum, promoted_at`,
            [ studyId, runId, sourceChecksum ],
        );
        return promotion;
    });
};

export {
    EXPECTED_CARD_COUNT,
    GithubPersistenceError,
    REQUIRED_ENDPOINTS,
    assertExactCards,
    createRunningRun,
    finalizeRun,
    markRunFailed,
    loadCommittedCardIds,
    loadRunPages,
    promoteRun,
    persistCheckpoint,
    recordTelemetryEvent,
    recordRunCard,
    sanitizeTelemetry,
    assertTelemetryComplete,
    stagePage,
    telemetryReport,
    upsertSnapshot,
};
