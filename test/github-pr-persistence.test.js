import assert from "node:assert/strict";
import test from "node:test";
import {
    GithubPersistenceError,
    assertExactCards,
    createRunningRun,
    finalizeRun,
    markRunFailed,
    promoteRun,
    recordRunCard,
    recordTelemetryEvent,
    sanitizeTelemetry,
    telemetryReport,
    stagePage,
    upsertSnapshot,
} from "../util/github-pr-persistence.js";

const studyId = "study-1";
const sourceChecksum = "csv-checksum";
const cardsFor = expectedCardCount => Array.from({length: expectedCardCount}, (_value, ordinal) => ({pr_card_id: `card-${ordinal}`, ordinal}));
const cards = cardsFor(300);

class FakeDatabase {
    constructor(expectedCardCount = 300) {
        this.runs = [];
        this.pages = [];
        this.snapshots = [];
        this.runCards = [];
        this.promotions = [];
        this.decisions = [];
        this.study = {id: studyId, source_checksum: sourceChecksum, expected_card_count: expectedCardCount};
        this.cards = cardsFor(expectedCardCount);
        this.nextId = 1;
    }

    pool() {
        return {connect: async () => this.client()};
    }

    client() {
        return {query: (sql, params) => this.query(sql, params), release: () => {}};
    }

    async query(sql, params = []) {
        if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") return {rows: []};
        if (/FROM study\s/.test(sql) && sql.includes("FOR UPDATE")) return {rows: [this.study]};
        if (sql.includes("FROM study_card")) return {rows: this.cards};
        if (sql.includes("FROM github_enrichment_run") && sql.includes("WHERE study_id = $1")) {
            return {rows: this.runs.filter(run => run.study_id === params[0] && run.state === "RUNNING")};
        }
        if (sql.includes("INSERT INTO github_enrichment_run(") ) {
            const run = {id: `run-${this.nextId++}`, study_id: params[0], source_checksum: params[1], config_fingerprint: params[2], normalizer_version: params[3], state: "RUNNING", manifest_checksum: null};
            this.runs.push(run);
            return {rows: [run]};
        }
        if (sql.includes("FROM github_enrichment_run") && sql.includes("WHERE id = $1")) {
            return {rows: this.runs.filter(run => run.id === params[0])};
        }
        if (sql.includes("INSERT INTO github_run_page")) {
            const page = {run_id: params[0], study_id: params[1], pr_card_id: params[2], endpoint: params[3], page_ordinal: params[4], request_fingerprint: params[5], api_version: params[6], accept: params[7], etag: params[8], http_status: params[9], response_checksum: params[10], normalized_checksum: params[11], item_count: params[12], next_url: params[13], state: params[14], normalized_payload: params[15]};
            this.pages.push(page);
            return {rows: [page]};
        }
        if (sql.includes("FROM github_run_page") && sql.includes("page_ordinal")) {
            return {rows: this.pages.filter(page => page.run_id === params[0] && page.pr_card_id === params[1] && page.endpoint === params[2] && page.page_ordinal === params[3])};
        }
        if (sql.includes("INSERT INTO github_card_snapshot")) {
            const existing = this.snapshots.find(snapshot => snapshot.pr_card_id === params[0] && snapshot.snapshot_checksum === params[1]);
            if (existing) return {rows: []};
            const snapshot = {id: `snapshot-${this.nextId++}`, pr_card_id: params[0], snapshot_checksum: params[1], normalizer_version: params[2], manifest: params[3]};
            this.snapshots.push(snapshot);
            return {rows: [snapshot]};
        }
        if (sql.includes("FROM github_card_snapshot")) {
            return {rows: this.snapshots.filter(snapshot => snapshot.pr_card_id === params[0] && snapshot.snapshot_checksum === params[1])};
        }
        if (sql.includes("INSERT INTO github_enrichment_run_card")) {
            const runCard = {run_id: params[0], study_id: params[1], pr_card_id: params[2], snapshot_id: params[3], snapshot_checksum: params[4], ordinal: params[5]};
            this.runCards.push(runCard);
            return {rows: [runCard]};
        }
        if (sql.includes("FROM github_enrichment_run_card run_card")) {
            return {rows: this.runCards.filter(card => card.run_id === params[0]).sort((left, right) => left.ordinal - right.ordinal).map(card => ({...card, snapshot_id: card.snapshot_id}))};
        }
        if (sql.includes("FROM github_enrichment_run_card") && sql.includes("snapshot_id")) {
            return {rows: this.runCards.filter(card => card.run_id === params[0] && card.study_id === params[1] && card.pr_card_id === params[2])};
        }
        if (sql.includes("BOOL_AND")) {
            return {rows: this.pages.filter(page => page.run_id === params[0]).reduce((result, page) => {
                const key = `${page.pr_card_id}:${page.endpoint}`;
                const current = result.find(row => `${row.pr_card_id}:${row.endpoint}` === key);
                if (current) {
                    current.complete = current.complete && ["COMPLETE", "COMPLETE_EMPTY", "PARTIAL"].includes(page.state);
                    current.terminal_complete = current.terminal_complete || ["COMPLETE", "COMPLETE_EMPTY"].includes(page.state);
                    current.omitted = current.omitted && page.state === "UNAVAILABLE";
                } else {
                    result.push({
                        pr_card_id: page.pr_card_id,
                        endpoint: page.endpoint,
                        complete: ["COMPLETE", "COMPLETE_EMPTY", "PARTIAL"].includes(page.state),
                        terminal_complete: ["COMPLETE", "COMPLETE_EMPTY"].includes(page.state),
                        omitted: page.state === "UNAVAILABLE",
                    });
                }
                return result;
            }, [])};
        }
        if (sql.includes("UPDATE github_enrichment_run") && sql.includes("COMPLETED")) {
            const run = this.runs.find(candidate => candidate.id === params[0]);
            if (run?.state === "RUNNING") {
                run.state = "COMPLETED";
                run.manifest_checksum = params[1];
                return {rows: [run]};
            }
            return {rows: []};
        }
        if (sql.includes("UPDATE github_enrichment_run") && sql.includes("FAILED")) {
            const run = this.runs.find(candidate => candidate.id === params[0]);
            if (run?.state === "RUNNING") run.state = "FAILED";
            return {rows: run ? [run] : []};
        }
        if (sql.includes("FROM study_enrichment_promotion")) return {rows: this.promotions.filter(promotion => promotion.study_id === params[0])};
        if (sql.includes("FROM pr_classification")) return {rows: this.decisions.filter(decision => decision.study_id === params[0]).slice(0, 1)};
        if (sql.includes("INSERT INTO study_enrichment_promotion")) {
            const promotion = {study_id: params[0], run_id: params[1], source_checksum: params[2]};
            this.promotions.push(promotion);
            return {rows: [promotion]};
        }
        throw new Error(`Unhandled SQL: ${sql}`);
    }
}

const createRun = database => createRunningRun({
    pool: database.pool(),
    studyId,
    sourceChecksum,
    configFingerprint: "config-fingerprint",
    normalizerVersion: "normalizer-1",
    expectedCardCount: database.study.expected_card_count,
});

const addCompleteEvidence = async (database, run) => {
    for (const card of database.cards) {
        for (const endpoint of ["metadata", "commits", "files", "reviews", "issueComments", "reviewComments"]) {
            await stagePage(database.client(), {
                runId: run.id,
                studyId,
                prCardId: card.pr_card_id,
                endpoint,
                pageOrdinal: 0,
                requestFingerprint: `${card.pr_card_id}-${endpoint}`,
                apiVersion: "v",
                accept: "a",
                state: "COMPLETE",
                normalizedPayload: [{id: card.pr_card_id}],
            });
        }
        const {snapshot} = await upsertSnapshot(database.client(), {
            prCardId: card.pr_card_id,
            snapshotChecksum: `snapshot-${card.ordinal}`,
            normalizerVersion: "normalizer-1",
            manifest: {pages: []},
        });
        await recordRunCard(database.client(), {
            runId: run.id,
            studyId,
            prCardId: card.pr_card_id,
            snapshotId: snapshot.id,
            snapshotChecksum: snapshot.snapshot_checksum,
            ordinal: card.ordinal,
        });
    }
};

test("rejects zero, duplicate, and missing card manifests", () => {
    assert.throws(() => assertExactCards([], 300), error => error.code === "CARD_MANIFEST_INCOMPLETE");
    assert.throws(() => assertExactCards([...cards.slice(0, 299), cards[298]], 300), error => error.code === "CARD_MANIFEST_INCOMPLETE");
    assert.throws(() => assertExactCards([...cards.slice(0, 299), {pr_card_id: "card-300", ordinal: 300}], 300), error => error.code === "CARD_MANIFEST_INCOMPLETE");
});

test("creates a run only for the study checksum and exact membership", async () => {
    const database = new FakeDatabase();
    const run = await createRun(database);
    assert.equal(run.state, "RUNNING");
    await assert.rejects(() => createRunningRun({pool: database.pool(), studyId, sourceChecksum: "different", configFingerprint: "f", normalizerVersion: "n", expectedCardCount: 300}), error => error.code === "STUDY_CHECKSUM_MISMATCH");
    await assert.rejects(() => createRunningRun({pool: database.pool(), studyId, sourceChecksum, configFingerprint: "f", normalizerVersion: "n", expectedCardCount: 30}), error => error.code === "STUDY_CHECKSUM_MISMATCH");
});

test("creates, finalizes, and promotes an exact persisted 30-card run", async () => {
    const database = new FakeDatabase(30);
    const run = await createRun(database);
    await addCompleteEvidence(database, run);
    const completed = await finalizeRun({pool: database.pool(), runId: run.id});
    const promotion = await promoteRun({pool: database.pool(), studyId, runId: run.id, sourceChecksum});

    assert.equal(completed.state, "COMPLETED");
    assert.equal(database.runCards.length, 30);
    assert.equal(promotion.run_id, run.id);
});

test("reuses one compatible running run and rejects incompatible automatic resume", async () => {
    const database = new FakeDatabase();
    const first = await createRun(database);
    const resumed = await createRun(database);
    assert.equal(resumed.id, first.id);
    await assert.rejects(() => createRunningRun({
        pool: database.pool(),
        studyId,
        sourceChecksum,
        configFingerprint: "different-policy",
        normalizerVersion: "normalizer-1",
        expectedCardCount: 300,
    }), error => error.code === "INCOMPATIBLE_RUNNING_RUN");
});

test("restores persisted checkpoint and quota metadata through the running-run loader", async () => {
    const database = new FakeDatabase();
    const first = await createRun(database);
    const persisted = database.runs.find(run => run.id === first.id);
    persisted.checkpoint = {cardOrdinal: 7, endpoint: "reviews", pageOrdinal: 2, nextUrl: "https://api.test/page=3"};
    persisted.quota_metadata = {remaining: 2, resetAt: 12_000, retryAt: 10_000, concurrency: 1};
    persisted.next_resume_at = new Date(10_000);

    const resumed = await createRun(database);

    assert.deepEqual(resumed.checkpoint, persisted.checkpoint);
    assert.deepEqual(resumed.quota_metadata, persisted.quota_metadata);
    assert.deepEqual(resumed.next_resume_at, persisted.next_resume_at);
});

test("reuses an equivalent snapshot and stores a changed snapshot version", async () => {
    const database = new FakeDatabase();
    const first = await upsertSnapshot(database.client(), {prCardId: "card-1", snapshotChecksum: "same", normalizerVersion: "n", manifest: {value: 1}});
    const reused = await upsertSnapshot(database.client(), {prCardId: "card-1", snapshotChecksum: "same", normalizerVersion: "n", manifest: {value: 1}});
    const changed = await upsertSnapshot(database.client(), {prCardId: "card-1", snapshotChecksum: "changed", normalizerVersion: "n", manifest: {value: 2}});
    assert.equal(reused.reused, true);
    assert.equal(reused.snapshot.id, first.snapshot.id);
    assert.equal(changed.reused, false);
    assert.equal(database.snapshots.length, 2);
});

test("fails a run when a required endpoint is incomplete", async () => {
    const database = new FakeDatabase();
    const run = await createRun(database);
    await stagePage(database.client(), {runId: run.id, studyId, prCardId: "card-0", endpoint: "metadata", pageOrdinal: 0, requestFingerprint: "f", apiVersion: "v", accept: "a", state: "FAILED", normalizedPayload: null});
    await assert.rejects(() => finalizeRun({pool: database.pool(), runId: run.id}), error => error.code === "REQUIRED_ENDPOINT_INCOMPLETE");
    const failed = await markRunFailed(database.pool(), run.id, studyId);
    assert.equal(failed.state, "FAILED");
});

test("rejects cross-study failure updates", async () => {
    const database = new FakeDatabase(30);
    const run = await createRun(database);
    await assert.rejects(
        () => markRunFailed(database.pool(), run.id, "other-study"),
        error => error.code === "RUN_SCOPE_MISMATCH",
    );
    assert.equal(run.state, "RUNNING");
});

test("promotes exactly 300 cards and associates the run, while rejecting repeat or decided promotion", async () => {
    const database = new FakeDatabase();
    const run = await createRun(database);
    await addCompleteEvidence(database, run);
    const completed = await finalizeRun({pool: database.pool(), runId: run.id});
    const promotion = await promoteRun({pool: database.pool(), studyId, runId: run.id, sourceChecksum});
    assert.equal(completed.state, "COMPLETED");
    assert.equal(promotion.run_id, run.id);
    await assert.rejects(() => promoteRun({pool: database.pool(), studyId, runId: run.id, sourceChecksum}), error => error.code === "ALREADY_PROMOTED");
    const other = new FakeDatabase();
    const otherRun = await createRun(other);
    await addCompleteEvidence(other, otherRun);
    await finalizeRun({pool: other.pool(), runId: otherRun.id});
    await assert.rejects(() => promoteRun({pool: other.pool(), studyId: "other-study", runId: otherRun.id, sourceChecksum}), error => error.code === "RUN_SCOPE_MISMATCH");
    const decided = new FakeDatabase();
    const decidedRun = await createRun(decided);
    await addCompleteEvidence(decided, decidedRun);
    await finalizeRun({pool: decided.pool(), runId: decidedRun.id});
    decided.decisions.push({study_id: studyId});
    await assert.rejects(() => promoteRun({pool: decided.pool(), studyId, runId: decidedRun.id, sourceChecksum}), error => error.code === "DECISIONS_EXIST");
});

test("does not accept raw response fields for staging", async () => {
    const database = new FakeDatabase();
    const run = await createRun(database);
    await assert.rejects(() => stagePage(database.client(), {runId: run.id, studyId, prCardId: "card-0", endpoint: "metadata", pageOrdinal: 0, requestFingerprint: "f", apiVersion: "v", accept: "a", state: "COMPLETE", rawBody: "private"}), error => error instanceof GithubPersistenceError && error.code === "RAW_PAYLOAD_REJECTED");
});

test("serializes normalized string payloads before JSONB staging", async () => {
    let parameters;
    const client = {query: async (_sql, values) => {
        parameters = values;
        return {rows: [{}]};
    }};
    const normalizedPayload = "diff --git a/private.txt b/private.txt";
    await stagePage(client, {
        runId: "run-1",
        studyId,
        prCardId: "card-0",
        endpoint: "diff",
        pageOrdinal: 0,
        requestFingerprint: "f",
        apiVersion: "v",
        accept: "application/vnd.github.patch",
        state: "TRUNCATED",
        normalizedPayload,
    });
    assert.equal(parameters.at(-1), JSON.stringify(normalizedPayload));
});

test("rejects a conflicting persisted page instead of ignoring the duplicate", async () => {
    const existing = {
        run_id: "run-1",
        study_id: studyId,
        pr_card_id: "card-0",
        endpoint: "reviews",
        page_ordinal: 0,
        request_fingerprint: "stored-fingerprint",
        api_version: "v",
        accept: "a",
        etag: null,
        http_status: 200,
        response_checksum: "stored-response",
        normalized_checksum: "stored-normalized",
        item_count: 1,
        next_url: null,
        state: "COMPLETE",
        normalized_payload: JSON.stringify([{id: 1}]),
    };
    const client = {query: async (sql) => sql.includes("INSERT INTO github_run_page")
        ? {rows: []}
        : {rows: [existing]}};

    await assert.rejects(() => stagePage(client, {
        runId: "run-1", studyId, prCardId: "card-0", endpoint: "reviews", pageOrdinal: 0,
        requestFingerprint: "different-fingerprint", apiVersion: "v", accept: "a", state: "COMPLETE",
        normalizedPayload: [{id: 1}],
    }), error => error instanceof GithubPersistenceError && error.code === "PAGE_CONFLICT");
});

test("rejects a conflicting persisted run-card mapping instead of ignoring the duplicate", async () => {
    const existing = {
        run_id: "run-1", study_id: studyId, pr_card_id: "card-0", snapshot_id: "snapshot-old",
        snapshot_checksum: "stored-snapshot", ordinal: 0,
    };
    const client = {query: async (sql) => sql.includes("INSERT INTO github_enrichment_run_card")
        ? {rows: []}
        : {rows: [existing]}};

    await assert.rejects(() => recordRunCard(client, {
        runId: "run-1", studyId, prCardId: "card-0", snapshotId: "snapshot-new",
        snapshotChecksum: "different-snapshot", ordinal: 0,
    }), error => error instanceof GithubPersistenceError && error.code === "RUN_CARD_CONFLICT");
});

test("sanitizes telemetry and treats equivalent event redelivery as idempotent", async () => {
    const stored = [];
    const client = {query: async (sql, values) => {
        if (sql.includes("INSERT INTO github_api_telemetry_event")) {
            if (stored.length) return {rows: []};
            stored.push({event_id: values[0], event_type: values[1], run_id: values[2], attempt_id: values[6], fingerprint: values[10]});
            return {rows: [{event_id: values[0]}]};
        }
        return {rows: stored};
    }};
    const event = {eventId: "event-1", eventType: "ATTEMPT_STARTED", runId: "run-1", studyId: "study-1", attemptId: "attempt-1", fingerprint: "safe", url: "https://secret", body: "secret", checkpoint: {nextUrl: "https://secret", cardOrdinal: 2}};
    await recordTelemetryEvent(client, event);
    await recordTelemetryEvent(client, event);
    assert.equal(stored.length, 1);
    assert.equal(JSON.stringify(sanitizeTelemetry(event)).includes("secret"), false);
});

test("sanitizes quotaResetAt: normalizes numeric epoch seconds to ISO timestamp, preserves null and ISO strings", async () => {
    // Given: an ATTEMPT_FINISHED event with quotaResetAt as Unix epoch seconds (the live stack error was 1787979818)
    const eventWithEpochSeconds = {
        eventId: "tel-epoch", eventType: "ATTEMPT_FINISHED", runId: "run-1", studyId: "study-1",
        executionId: "exec-1", attemptId: "attempt-1", fingerprint: "safe",
        endpoint: "metadata", pageOrdinal: 0, attemptNumber: 1,
        occurredAt: new Date().toISOString(), durationMs: 1200, classification: "RATE_LIMIT",
        decision: "RETRY", httpStatus: 429, errorCode: "rate_limit_exceeded",
        quotaRemaining: 0, quotaResetAt: 1787979818, retryAfterMs: 5000,
        effectiveRetryAt: null, retrySource: "header", waitSource: "header",
        scheduledWaitMs: 0, requestId: "req-1", pauseReason: null,
        causalEventId: null, checkpoint: null,
    };
    // When: sanitizeTelemetry processes the event
    const sanitized = sanitizeTelemetry(eventWithEpochSeconds);
    // Then: quotaResetAt should be an ISO timestamp string, NOT raw epoch seconds
    assert.ok(typeof sanitized.quotaResetAt === "string", "quotaResetAt should be a string, got " + typeof sanitized.quotaResetAt);
    // Exact deterministic result for 1787979818 seconds from epoch
    assert.strictEqual(sanitized.quotaResetAt, "2026-08-29T05:03:38.000Z", "quotaResetAt should be the exact ISO string for 1787979818 seconds");
    // And: the parsed value should be a valid date (no out-of-range error)
    const parsedDate = new Date(sanitized.quotaResetAt);
    assert.ok(!isNaN(parsedDate.getTime()), "quotaResetAt should parse to a valid Date");
    // And: no raw epoch seconds should remain in the sanitized output
    assert.ok(!/^\d{10}$/.test(sanitized.quotaResetAt.replace(/[^0-9]/g, "")), "quotaResetAt should not be raw epoch seconds");
});

test("sanitizes quotaResetAt: preserves null input", async () => {
    const eventWithNull = {
        eventId: "tel-null", eventType: "ATTEMPT_FINISHED", runId: "run-1", studyId: "study-1",
        executionId: "exec-1", attemptId: "attempt-1", fingerprint: "safe",
        endpoint: "metadata", pageOrdinal: 0, attemptNumber: 1,
        occurredAt: new Date().toISOString(), durationMs: 1200,
        quotaRemaining: 0, quotaResetAt: null, retryAfterMs: 5000,
        effectiveRetryAt: null, retrySource: "header", waitSource: "header",
        scheduledWaitMs: 0, requestId: "req-1", pauseReason: null,
        causalEventId: null, checkpoint: null,
    };
    const sanitized = sanitizeTelemetry(eventWithNull);
    assert.strictEqual(sanitized.quotaResetAt, null);
});

test("sanitizes quotaResetAt: preserves valid ISO string input", async () => {
    const isoInput = "2026-06-15T14:30:00Z";
    const eventWithISO = {
        eventId: "tel-iso", eventType: "ATTEMPT_FINISHED", runId: "run-1", studyId: "study-1",
        executionId: "exec-1", attemptId: "attempt-1", fingerprint: "safe",
        endpoint: "metadata", pageOrdinal: 0, attemptNumber: 1,
        occurredAt: new Date().toISOString(), durationMs: 1200,
        quotaRemaining: 0, quotaResetAt: isoInput, retryAfterMs: 5000,
        effectiveRetryAt: null, retrySource: "header", waitSource: "header",
        scheduledWaitMs: 0, requestId: "req-1", pauseReason: null,
        causalEventId: null, checkpoint: null,
    };
    const sanitized = sanitizeTelemetry(eventWithISO);
    assert.strictEqual(sanitized.quotaResetAt, isoInput);
});

test("reports historical runs as not instrumented without inventing rate-limit counts", async () => {
    const client = {query: async sql => sql.includes("attempt_telemetry_version")
        ? {rows: [{attempt_telemetry_version: null}]}
        : {rows: [{event_count: 0, started_count: 0, finished_count: 0, rate_limit_403_count: 0, rate_limit_429_count: 0}]}};
    assert.deepEqual(await telemetryReport(client, "historical-run"), {
        telemetry_status: "NOT_INSTRUMENTED", event_count: 0, rate_limit_403_count: null, rate_limit_429_count: null,
    });
});
