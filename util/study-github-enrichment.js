import {
    buildSnapshotManifest,
    checksum,
    checksumSnapshotManifest,
} from "./github-pr-manifest.js";
import {githubConfigFingerprint} from "./github-pr-config.js";
import {
    createRunningRun,
    finalizeRun,
    markRunFailed,
    promoteRun,
    recordRunCard,
    stagePage,
    upsertSnapshot,
    loadCommittedCardIds,
    loadRunPages,
    persistCheckpoint,
    recordTelemetryEvent,
} from "./github-pr-persistence.js";
import {withTransaction} from "./transaction.js";
import {randomUUID} from "node:crypto";

const NORMALIZER_VERSION = "1";

const loadStudyCardSources = async (pool, studyId) => {
    const {rows} = await pool.query(
        `SELECT study_card.pr_card_id, study_card.ordinal, pr_cards.repository, pr_cards.pr_number
         FROM study_card
         INNER JOIN pr_cards ON pr_cards.id = study_card.pr_card_id
         WHERE study_card.study_id = $1
         ORDER BY study_card.ordinal`,
        [studyId],
    );
    return rows;
};

const assertCardSources = (runCards, sources, expectedCardCount) => {
    if (sources.length !== expectedCardCount || runCards.length !== expectedCardCount) {
        throw new Error(`GitHub enrichment requires exactly ${expectedCardCount} study cards`);
    }
    for (const [index, source] of sources.entries()) {
        const runCard = runCards[index];
        if (source.pr_card_id !== runCard.pr_card_id || source.ordinal !== runCard.ordinal || source.ordinal !== index) {
            throw new Error("Study card mapping changed while preparing GitHub enrichment");
        }
    }
};

const pageOptions = ({run, study, source, endpoint, page, config}) => ({
    runId: run.id,
    studyId: study.id,
    prCardId: source.pr_card_id,
    endpoint,
    pageOrdinal: page.pageOrdinal ?? 0,
    requestFingerprint: page.requestFingerprint || checksum({
        repository: source.repository,
        number: source.pr_number,
        endpoint,
        pageOrdinal: page.pageOrdinal ?? 0,
    }),
    apiVersion: page.apiVersion || config.apiVersion,
    accept: page.accept || config.accept,
    etag: page.etag ?? null,
    httpStatus: page.httpStatus ?? null,
    responseChecksum: page.responseChecksum ?? null,
    normalizedChecksum: page.normalizedChecksum ?? null,
    itemCount: page.itemCount ?? null,
    nextUrl: page.nextUrl ?? null,
    state: page.state,
    normalizedPayload: page.normalizedPayload ?? null,
});

const pagesForEndpoint = (result, endpoint) => {
    if (Array.isArray(result?.pageRecords) && result.pageRecords.length > 0) return result.pageRecords;
    return [{endpoint, state: result?.status || "FAILED", httpStatus: result?.httpStatus ?? null}];
};

const assertEndpointResults = (endpoints, source) => {
    for (const [endpoint, result] of Object.entries(endpoints)) {
        if (result?.status === "FAILED") {
            throw new Error(`GitHub ${endpoint} enrichment failed for ${source.repository}#${source.pr_number}`);
        }
    }
};

const persistCardEnrichment = async ({run, study, source, result, config, persistence, transaction}) => {
    if (!result || result.status === "FAILED") {
        throw new Error(`GitHub enrichment failed for ${source.repository}#${source.pr_number}: ${result?.errorCode || "UNKNOWN"}`);
    }
    const endpoints = result.status === "OMITTED"
        ? Object.fromEntries(Object.entries(result.endpoints || {}).map(([endpoint, endpointResult]) => [
            endpoint,
            {
                ...endpointResult,
                status: "UNAVAILABLE",
                value: null,
                pageRecords: undefined,
                normalized: undefined,
                normalizedPayload: undefined,
            },
        ]))
        : result.endpoints || {};
    assertEndpointResults(endpoints, source);
    const pages = Object.entries(endpoints).flatMap(([endpoint, endpointResult]) =>
        pagesForEndpoint(endpointResult, endpoint));
    if (pages.some(page => page.state === "FAILED")) {
        throw new Error(`GitHub enrichment returned a failed endpoint for ${source.repository}#${source.pr_number}`);
    }
    const manifest = buildSnapshotManifest({pages});
    const snapshotChecksum = checksumSnapshotManifest({pages});
    await transaction(async client => {
        for (const [endpoint, endpointResult] of Object.entries(endpoints)) {
            for (const page of pagesForEndpoint(endpointResult, endpoint)) {
                await persistence.stagePage(client, pageOptions({run, study, source, endpoint, page, config}));
            }
        }
        const {snapshot} = await persistence.upsertSnapshot(client, {
            prCardId: source.pr_card_id,
            snapshotChecksum,
            normalizerVersion: NORMALIZER_VERSION,
            manifest,
        });
        await persistence.recordRunCard(client, {
            runId: run.id,
            studyId: study.id,
            prCardId: source.pr_card_id,
            snapshotId: snapshot.id,
            snapshotChecksum,
            ordinal: source.ordinal,
        });
    });
};

const enrichStudyWithGithub = async options => {
    const {
        pool,
        study,
        config,
        githubClient,
        expectedCardCount = study.expected_card_count ?? 300,
        persistence = {createRunningRun, stagePage, upsertSnapshot, recordRunCard, finalizeRun, markRunFailed, loadCommittedCardIds, loadRunPages, persistCheckpoint, promoteRun, recordTelemetryEvent},
        loadCards = loadStudyCardSources,
        transaction = operation => withTransaction(pool, operation),
        resumeRunId = null,
        now = Date.now,
        executionId = randomUUID(),
    } = options;
    if (!config.enabled) return {status: "DISABLED", study};
    if (!githubClient || typeof githubClient.fetchPullRequest !== "function") {
        throw new Error("GitHub enrichment requires an injected client");
    }

    const run = await persistence.createRunningRun({
        pool,
        studyId: study.id,
        sourceChecksum: study.source_checksum,
        configFingerprint: githubConfigFingerprint(config),
        normalizerVersion: NORMALIZER_VERSION,
        expectedCardCount,
        resumeRunId,
    });
    const resumeAt = run.next_resume_at ? new Date(run.next_resume_at).getTime() : null;
    if (resumeAt !== null && Number.isFinite(resumeAt) && resumeAt > now()) {
        return {status: "PAUSED", run, study, retryAt: resumeAt};
    }
    const telemetry = persistence.recordTelemetryEvent
        ? {record: event => transaction(client => persistence.recordTelemetryEvent(client, {...event, runId: run.id, studyId: study.id}))}
        : null;
    if (resumeRunId && telemetry) {
        await telemetry.record({eventType: "RESUME_STARTED", eventId: randomUUID(), executionId});
    }
    try {
        const sources = await loadCards(pool, study.id);
        assertCardSources(run.cards, sources, expectedCardCount);
        const committed = persistence.loadCommittedCardIds
            ? await transaction(client => persistence.loadCommittedCardIds(client, run.id))
            : [];
        const committedIds = new Set(committed.map(card => card.pr_card_id));
        for (const source of sources) {
            if (committedIds.has(source.pr_card_id)) continue;
            const checkpointPages = persistence.loadRunPages
                ? await transaction(client => persistence.loadRunPages(client, run.id, source.pr_card_id))
                : [];
            const result = await githubClient.fetchPullRequest({
                repository: source.repository,
                number: source.pr_number,
                baselinePages: run.baseline_pages?.[source.pr_card_id] || null,
                checkpointPages: Object.groupBy(checkpointPages, page => page.endpoint),
                quotaState: run.quota_metadata || null,
                telemetry,
                executionId,
                runId: run.id,
                studyId: study.id,
                prCardId: source.pr_card_id,
            });
            if (result.status === "PAUSED") {
                const pausedEndpoint = Object.entries(result.endpoints || {}).find(([, endpointResult]) => endpointResult.status === "PAUSED");
                await transaction(async client => {
                    for (const [endpoint, endpointResult] of Object.entries(result.endpoints || {})) {
                        for (const page of endpointResult.pageRecords || []) {
                            await persistence.stagePage(client, pageOptions({run, study, source, endpoint, page, config}));
                        }
                    }
                    if (persistence.persistCheckpoint) {
                        await persistence.persistCheckpoint(client, {
                            runId: run.id,
                            checkpoint: {
                                cardOrdinal: source.ordinal,
                                endpoint: pausedEndpoint?.[0] || null,
                                pageOrdinal: pausedEndpoint?.[1]?.pageRecords?.length || null,
                                nextUrl: pausedEndpoint?.[1]?.pageRecords?.at(-1)?.nextUrl || null,
                            },
                            quota: result.quota,
                        });
                    }
                    if (persistence.recordTelemetryEvent) {
                        await persistence.recordTelemetryEvent(client, {
                            eventId: randomUUID(),
                            eventType: "PAUSE_COMMITTED",
                            runId: run.id,
                            studyId: study.id,
                            executionId,
                            prCardId: source.pr_card_id,
                            endpoint: pausedEndpoint?.[0] || null,
                            quotaRemaining: Number.isInteger(result.quota?.remaining) ? result.quota.remaining : null,
                            effectiveRetryAt: result.retryAt ? new Date(result.retryAt).toISOString() : null,
                            checkpoint: {cardOrdinal: source.ordinal, endpoint: pausedEndpoint?.[0] || null, pageOrdinal: pausedEndpoint?.[1]?.pageRecords?.length || null},
                            decision: "PAUSE",
                            pauseReason: result.errorCode || "rate_limit",
                        });
                    }
                });
                return {status: "PAUSED", run, study, retryAt: result.retryAt};
            }
            await persistCardEnrichment({run, study, source, result, config, persistence, transaction});
            committedIds.add(source.pr_card_id);
            if (persistence.persistCheckpoint) {
                await transaction(client => persistence.persistCheckpoint(client, {
                    runId: run.id,
                    checkpoint: {cardOrdinal: source.ordinal + 1, endpoint: null, pageOrdinal: null, nextUrl: null},
                    quota: result.quota,
                }));
            }
        }
        const completed = await persistence.finalizeRun({pool, runId: run.id, expectedCardCount});
        const promotion = await persistence.promoteRun({
            pool,
            studyId: study.id,
            runId: run.id,
            sourceChecksum: study.source_checksum,
            expectedCardCount,
        });
        return {status: "PROMOTED", run: completed, promotion, study};
    } catch (error) {
        await persistence.markRunFailed(pool, run.id);
        throw error;
    }
};

export {
    NORMALIZER_VERSION,
    assertCardSources,
    assertEndpointResults,
    enrichStudyWithGithub,
    loadStudyCardSources,
};
