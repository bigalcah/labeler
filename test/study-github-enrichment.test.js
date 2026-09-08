import assert from "node:assert/strict";
import test from "node:test";
import {readGithubConfig, validateGithubConfig} from "../util/github-pr-config.js";
import {enrichStudyWithGithub} from "../util/study-github-enrichment.js";

const study = {id: "study-id", source_checksum: "csv-checksum", expected_card_count: 300};
const config = validateGithubConfig({enabled: true, aliases: {
    default: {
        tokenEnv: "TOKEN",
        permissions: ["metadata", "pulls", "contents", "issues"],
    },
}, defaultAlias: "default"});

const sources = Array.from({length: 300}, (_, ordinal) => ({
    pr_card_id: `card-${ordinal}`,
    ordinal,
    repository: `owner-${ordinal % 196}/repository`,
    pr_number: ordinal + 1,
}));

const page = (endpoint, state = endpoint === "metadata" ? "COMPLETE" : "COMPLETE_EMPTY") => ({
    endpoint,
    pageOrdinal: 0,
    requestFingerprint: `${endpoint}-fingerprint`,
    apiVersion: config.apiVersion,
    accept: config.accept,
    httpStatus: 200,
    responseChecksum: `${endpoint}-response`,
    normalizedChecksum: `${endpoint}-normalized`,
    itemCount: endpoint === "metadata" ? 1 : 0,
    state,
    normalizedPayload: endpoint === "metadata" ? {title: "PR"} : [],
});

const completeResult = () => ({
    status: "COMPLETE",
    endpoints: Object.fromEntries([
        "metadata", "commits", "files", "reviews", "issueComments", "reviewComments",
        "timeline", "diff",
    ].map(endpoint => [endpoint, endpoint === "timeline"
        ? {status: "UNAVAILABLE"}
        : {status: endpoint === "diff" ? "TRUNCATED" : "COMPLETE", pageRecords: [page(endpoint, endpoint === "diff" ? "TRUNCATED" : undefined)]}])),
});

const fakePersistence = events => ({
    createRunningRun: async () => ({id: "run-id", cards: sources.map(({pr_card_id, ordinal}) => ({pr_card_id, ordinal}))}),
    stagePage: async (_client, options) => events.push(["stagePage", options]),
    upsertSnapshot: async (_client, options) => {
        events.push(["upsertSnapshot", options]);
        return {snapshot: {id: `snapshot-${options.prCardId}`}};
    },
    recordRunCard: async (_client, options) => events.push(["recordRunCard", options]),
    finalizeRun: async options => {
        events.push(["finalizeRun", options]);
        return {id: "run-id", state: "COMPLETED"};
    },
    promoteRun: async options => {
        events.push(["promoteRun", options]);
        return {study_id: options.studyId, run_id: options.runId};
    },
    markRunFailed: async (_pool, runId) => events.push(["markRunFailed", runId]),
});

test("disabled enrichment neither creates a run nor calls a client", async () => {
    let fetched = false;
    const result = await enrichStudyWithGithub({
        pool: {},
        study,
        config: validateGithubConfig({enabled: false}),
        githubClient: {fetchPullRequest: async () => { fetched = true; }},
        persistence: {createRunningRun: async () => { throw new Error("must not create run"); }},
    });
    assert.equal(result.status, "DISABLED");
    assert.equal(fetched, false);
});

test("disabled configuration ignores malformed aliases and secret sources", () => {
    const disabled = readGithubConfig({
        GITHUB_ENRICHMENT_ENABLED: "false",
        GITHUB_CREDENTIAL_ALIASES: "not-json",
        GITHUB_DEFAULT_ALIAS: "missing",
    });
    assert.equal(disabled.enabled, false);
    assert.deepEqual(disabled.aliases, {});
});

test("enabled enrichment stages pages, snapshots, mappings, finalizes, and promotes", async () => {
    const events = [];
    let fetched = 0;
    const result = await enrichStudyWithGithub({
        pool: {},
        study,
        config,
        githubClient: {fetchPullRequest: async () => { fetched += 1; return completeResult(); }},
        persistence: fakePersistence(events),
        loadCards: async () => sources,
        transaction: async operation => operation({}),
    });
    assert.equal(result.status, "PROMOTED");
    assert.equal(fetched, 300);
    assert.equal(new Set(sources.map(source => source.repository)).size, 196);
    assert.equal(events.filter(([name]) => name === "stagePage").length, 2400);
    assert.equal(events.filter(([name, options]) => name === "stagePage" && options.state === "UNAVAILABLE").length, 300);
    assert.equal(events.filter(([name]) => name === "upsertSnapshot").length, 300);
    assert.equal(events.filter(([name]) => name === "recordRunCard").length, 300);
    assert.equal(events.filter(([name, options]) => name === "stagePage" && options.state === "TRUNCATED").length, 300);
    assert.equal(events.at(-2)[0], "finalizeRun");
    assert.equal(events.at(-1)[0], "promoteRun");
});

test("omits a missing pull request and continues to promotion with its CSV baseline", async () => {
    const events = [];
    let fetched = 0;
    const omitted = {
        status: "OMITTED",
        errorCode: "NOT_FOUND",
        endpoints: Object.fromEntries([
            "metadata", "commits", "files", "reviews", "issueComments", "reviewComments", "timeline", "diff",
        ].map(endpoint => [endpoint, {status: "UNAVAILABLE", errorCode: "NOT_FOUND", httpStatus: 404}])),
    };
    const result = await enrichStudyWithGithub({
        pool: {},
        study,
        config,
        githubClient: {fetchPullRequest: async () => {
            fetched += 1;
            return fetched === 1 ? omitted : completeResult();
        }},
        persistence: fakePersistence(events),
        loadCards: async () => sources,
        transaction: async operation => operation({}),
    });
    assert.equal(result.status, "PROMOTED");
    assert.equal(fetched, 300);
    assert.equal(events.filter(([name]) => name === "upsertSnapshot").length, 300);
    assert.equal(events.filter(([name]) => name === "recordRunCard").length, 300);
    assert.equal(events.filter(([name, options]) => name === "stagePage" && options.state === "UNAVAILABLE").length, 307);
    assert.equal(events.some(([name]) => name === "markRunFailed"), false);
});

test("an incomplete enrichment fails and marks the run instead of promoting it", async () => {
    const events = [];
    await assert.rejects(() => enrichStudyWithGithub({
        pool: {},
        study,
        config,
        githubClient: {fetchPullRequest: async () => ({
            status: "FAILED",
            errorCode: "PERMISSION_DENIED",
            endpoints: {},
        })},
        persistence: fakePersistence(events),
        loadCards: async () => sources,
        transaction: async operation => operation({}),
    }), /GitHub enrichment failed/);
    assert.deepEqual(events.map(([name]) => name), ["markRunFailed"]);
});

test("a required endpoint failure marks the run before finalization", async () => {
    const events = [];
    await assert.rejects(() => enrichStudyWithGithub({
        pool: {},
        study,
        config,
        githubClient: {fetchPullRequest: async () => ({
            status: "COMPLETE",
            endpoints: {
                metadata: {status: "FAILED", errorCode: "PERMISSION_DENIED"},
            },
        })},
        persistence: fakePersistence(events),
        loadCards: async () => sources,
        transaction: async operation => operation({}),
    }), /metadata enrichment failed/);
    assert.deepEqual(events.map(([name]) => name), ["markRunFailed"]);
});

test("pauses a running run at a card checkpoint without marking it failed", async () => {
    const events = [];
    const persistence = fakePersistence(events);
    persistence.createRunningRun = async ({resumeRunId}) => ({
        id: resumeRunId || "run-id",
        cards: sources.map(({pr_card_id, ordinal}) => ({pr_card_id, ordinal})),
    });
    persistence.loadCommittedCardIds = async () => [{pr_card_id: "card-0", ordinal: 0}];
    persistence.persistCheckpoint = async (_client, options) => events.push(["checkpoint", options]);
    const result = await enrichStudyWithGithub({
        pool: {},
        study,
        config,
        resumeRunId: "run-id",
        githubClient: {fetchPullRequest: async ({number}) => number === 2
            ? {status: "PAUSED", retryAt: 1234, quota: {remaining: 0, retryAt: 1234, concurrency: 1}, endpoints: {}}
            : completeResult()},
        persistence,
        loadCards: async () => sources,
        transaction: async operation => operation({}),
    });
    assert.equal(result.status, "PAUSED");
    assert.equal(events.filter(([name]) => name === "checkpoint").length, 1);
    assert.equal(events.some(([name]) => name === "markRunFailed"), false);
    assert.equal(events.some(([name]) => name === "finalizeRun"), false);
});

test("persists the paused card, page cursor, and next URL for page-level resume", async () => {
    const events = [];
    const persistence = fakePersistence(events);
    persistence.persistCheckpoint = async (_client, options) => events.push(["checkpoint", options]);
    const nextUrl = "https://api.test/repos/owner-0/repository/pulls/1/reviews?page=2";
    const result = await enrichStudyWithGithub({
        pool: {},
        study,
        config,
        githubClient: {fetchPullRequest: async () => ({
            status: "PAUSED",
            retryAt: 10_000,
            quota: {remaining: 0, retryAt: 10_000, concurrency: 1},
            endpoints: {
                reviews: {
                    status: "PAUSED",
                    pageRecords: [{...page("reviews", "PARTIAL"), nextUrl, next: nextUrl}],
                },
            },
        })},
        persistence,
        loadCards: async () => sources,
        transaction: async operation => operation({}),
    });

    const staged = events.find(([name]) => name === "stagePage");
    const checkpoint = events.find(([name]) => name === "checkpoint");
    assert.equal(result.status, "PAUSED");
    assert.equal(staged[1].prCardId, "card-0");
    assert.equal(staged[1].state, "PARTIAL");
    assert.equal(staged[1].pageOrdinal, 0);
    assert.equal(staged[1].nextUrl, nextUrl);
    assert.deepEqual(checkpoint[1].checkpoint, {
        cardOrdinal: 0,
        endpoint: "reviews",
        pageOrdinal: 1,
        nextUrl,
    });
    assert.equal(events.some(([name]) => name === "markRunFailed"), false);
});

test("blocks a restarted running run until its persisted resume time", async () => {
    const events = [];
    const persistence = fakePersistence(events);
    persistence.createRunningRun = async () => ({
        id: "run-id",
        next_resume_at: new Date(10_000),
        quota_metadata: {remaining: 0, retryAt: 10_000, resetAt: 10_000, concurrency: 1},
        cards: sources.map(({pr_card_id, ordinal}) => ({pr_card_id, ordinal})),
    });
    let fetched = false;
    const result = await enrichStudyWithGithub({
        pool: {},
        study,
        config,
        githubClient: {fetchPullRequest: async () => { fetched = true; }},
        persistence,
        now: () => 9_999,
        loadCards: async () => sources,
        transaction: async operation => operation({}),
    });

    assert.equal(result.status, "PAUSED");
    assert.equal(result.retryAt, 10_000);
    assert.equal(fetched, false);
    assert.deepEqual(events, []);
});

test("automatically resumes the compatible run on a second invocation", async () => {
    const events = [];
    let run = null;
    const committed = new Set();
    const persistence = fakePersistence(events);
    persistence.createRunningRun = async () => {
        run ||= {id: "auto-resumed-run", cards: sources.map(({pr_card_id, ordinal}) => ({pr_card_id, ordinal}))};
        return run;
    };
    persistence.loadCommittedCardIds = async () => [...committed].map(pr_card_id => ({pr_card_id}));
    persistence.recordRunCard = async (_client, options) => {
        committed.add(options.prCardId);
        events.push(["recordRunCard", options]);
    };
    persistence.finalizeRun = async () => ({...run, state: "COMPLETED"});
    persistence.persistCheckpoint = async (_client, options) => events.push(["checkpoint", options]);
    let invocation = 0;
    const githubClient = {fetchPullRequest: async ({number}) => {
        if (invocation === 0 && number === 2) return {status: "PAUSED", retryAt: 1234, quota: {remaining: 0, retryAt: 1234, concurrency: 1}, endpoints: {}};
        return completeResult();
    }};
    const invoke = () => enrichStudyWithGithub({
        pool: {},
        study,
        config,
        githubClient,
        persistence,
        loadCards: async () => sources,
        transaction: async operation => operation({}),
    });
    const first = await invoke();
    invocation += 1;
    const second = await invoke();
    assert.equal(first.status, "PAUSED");
    assert.equal(second.status, "PROMOTED");
    assert.equal(first.run.id, second.run.id);
    assert.equal(committed.size, 300);
    assert.equal(events.filter(([name]) => name === "recordRunCard").length, 300);
});
