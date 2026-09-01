import assert from "node:assert/strict";
import test from "node:test";
import {
    GithubConfigError,
    githubConfigFingerprint,
    normalizeRepository,
    readGithubConfig,
    resolveCredential,
    validateGithubConfig,
} from "../util/github-pr-config.js";
import {
    ENDPOINTS,
    MAX_DIFF_BYTES,
    buildRunManifest,
    buildSnapshotManifest,
    checksum,
    checksumRunManifest,
    checksumSnapshotManifest,
    createGithubClient as createGithubClientImplementation,
    createQuotaCoordinator,
    classifyHttpResponse,
    isExactPageValidatorMatch,
    parseLinkHeader,
} from "../util/github-pr-client.js";

const config = (overrides = {}) => validateGithubConfig({
    enabled: true,
    aliases: {
        default: {tokenEnv: "GITHUB_TOKEN", permissions: ["metadata", "pulls", "contents", "issues"]},
    },
    defaultAlias: "default",
    ...overrides,
});

const response = (status, body, headers = {}) => new Response(JSON.stringify(body), {status, headers});
const createGithubClient = options => createGithubClientImplementation({sleep: async () => {}, ...options});

test("normalizes repositories while resolving one shared credential", () => {
    assert.equal(normalizeRepository(" Public/Repo "), "public/repo");
    assert.throws(() => normalizeRepository("public/repo/other"), GithubConfigError);
    const resolved = resolveCredential(config(), "private/repo", {GITHUB_TOKEN: "shared-secret"});
    assert.equal(resolved.alias, "default");
    assert.equal(Object.hasOwn(resolved, "token"), false);
    assert.equal(resolved.getToken(), "shared-secret");
    assert.equal(resolveCredential(config(), "other/repo", {GITHUB_TOKEN: " shared-secret\n"}).getToken(), "shared-secret");
});

test("requires explicit enablement and rejects invalid profiles without secrets in errors", () => {
    assert.throws(() => resolveCredential(validateGithubConfig({}), "private/repo", {}), error => error.code === "DISABLED");
    assert.throws(() => validateGithubConfig({enabled: true, aliases: {x: {tokenEnv: "TOKEN"}}}), error => error.code === "INVALID_PROFILE");
    assert.throws(() => validateGithubConfig({enabled: true, aliases: {
        "Owner/Repo": {tokenEnv: "TOKEN", permissions: ["metadata", "pulls", "contents", "issues"]},
        "owner/repo": {tokenEnv: "TOKEN", permissions: ["metadata", "pulls", "contents", "issues"]},
    }}), error => error.code === "INVALID_PROFILE");
    assert.throws(() => validateGithubConfig({enabled: true, aliases: {
        default: {tokenEnv: "TOKEN", permissions: ["metadata", "pulls", "contents", "issues"]},
        "owner/repository": {tokenEnv: "TOKEN", permissions: ["metadata", "pulls", "contents", "issues"]},
    }}), error => error.code === "INVALID_PROFILE");
    assert.throws(() => validateGithubConfig({enabled: true, aliases: {
        default: {tokenEnv: "TOKEN", tokenFile: "/run/secrets/token", permissions: ["metadata", "pulls", "contents", "issues"]},
    }}), error => error.code === "INVALID_PROFILE");
    assert.throws(() => validateGithubConfig({enabled: true, aliases: {
        default: {tokenEnv: "TOKEN", permissions: ["metadata", "pulls"]},
    }}), error => error.code === "INSUFFICIENT_PERMISSIONS");
    assert.throws(() => resolveCredential(config(), "private/repo", {}), error => error.code === "CREDENTIAL_NOT_FOUND");
    assert.throws(() => readGithubConfig({
        GITHUB_ENRICHMENT_ENABLED: "true",
        GITHUB_CREDENTIAL_ALIASES: "not-json",
    }), error => error.code === "INVALID_PROFILE" && !/not-json/.test(error.message));
});

test("reads the neutral default profile from environment and supports one mounted secret file", () => {
    const environmentConfig = readGithubConfig({
        GITHUB_ENRICHMENT_ENABLED: "true",
        GITHUB_CREDENTIAL_ALIASES: JSON.stringify({default: {tokenEnv: "SHARED_TOKEN", permissions: ["metadata", "pulls", "contents", "issues"]}}),
        GITHUB_DEFAULT_ALIAS: "default",
    });
    assert.equal(resolveCredential(environmentConfig, "any/repository", {SHARED_TOKEN: "shared"}).getToken(), "shared");
    const fileConfig = config({aliases: {default: {tokenFile: "/run/secrets/github-token", permissions: ["metadata", "pulls", "contents", "issues"]}}});
    assert.equal(resolveCredential(fileConfig, "any/repository", {}, path => path === "/run/secrets/github-token" ? "file-secret" : "").getToken(), "file-secret");
    assert.throws(() => resolveCredential(fileConfig, "any/repository", {}, () => { throw new Error("fixture-token"); }), error =>
        error.code === "CREDENTIAL_NOT_FOUND" && !/fixture-token/.test(error.message));
});

test("fingerprints canonical non-secret policy and excludes token values", () => {
    const first = config();
    const second = config({aliases: {default: {tokenEnv: "GITHUB_TOKEN", permissions: ["issues", "contents", "pulls", "metadata"]}}});
    assert.equal(githubConfigFingerprint(first), githubConfigFingerprint(second));
    assert.notEqual(githubConfigFingerprint(first), githubConfigFingerprint(config({enabled: false})));
    assert.notEqual(githubConfigFingerprint(first), githubConfigFingerprint(config({aliases: {default: {tokenEnv: "GITHUB_TOKEN", permissions: ["metadata", "pulls", "contents", "issues", "security"]}}})));
    assert.doesNotMatch(githubConfigFingerprint(first), /shared-secret|fixture-token/);
});

test("keeps deterministic request policy defaults within the documented bounds", () => {
    const githubConfig = config();
    assert.equal(githubConfig.concurrency, 4);
    assert.equal(githubConfig.timeoutMs, 30_000);
    assert.equal(githubConfig.maxAttempts, 4);
    assert.equal(githubConfig.pageWaitBudgetMs, 300_000);
    assert.equal(githubConfig.runWaitBudgetMs, 1_800_000);
    assert.throws(() => validateGithubConfig({enabled: true, concurrency: 9, aliases: {default: {tokenEnv: "TOKEN", permissions: ["metadata", "pulls", "contents", "issues"]}}}), error => error.code === "INVALID_POLICY");
});

test("resolves one shared credential for 300 cards across 196 repositories", async () => {
    let tokenReads = 0;
    const environment = new Proxy({GITHUB_TOKEN: "shared-token"}, {
        get(target, property) {
            if (property === "GITHUB_TOKEN") tokenReads += 1;
            return target[property];
        },
    });
    const client = createGithubClient({
        config: config({apiBase: "https://api.test", concurrency: 8}),
        environment,
        fetch: async url => url.endsWith("/pulls/1") ? response(200, {id: 1}) : response(200, []),
    });
    for (let ordinal = 0; ordinal < 300; ordinal += 1) {
        await client.fetchPullRequest({repository: `owner-${ordinal % 196}/repository`, number: 1});
    }
    assert.equal(tokenReads, 1);
});

test("parses only the next Link relation", () => {
    assert.deepEqual(parseLinkHeader("<https://api.test?page=2>; rel=\"next\", <https://api.test?page=9>; rel=\"last\""), {
        next: "https://api.test?page=2",
        last: "https://api.test?page=9",
    });
});

test("declares required and optional endpoint classes", () => {
    assert.deepEqual(Object.entries(ENDPOINTS).filter(([, definition]) => definition.required).map(([name]) => name), [
        "metadata", "commits", "files", "reviews", "issueComments", "reviewComments",
    ]);
    assert.deepEqual(Object.entries(ENDPOINTS).filter(([, definition]) => !definition.required).map(([name]) => name), ["timeline", "diff"]);
});

test("sends versioned read-only headers, follows pagination, and records empty lists", async () => {
    const requests = [];
    const client = createGithubClient({
        config: config({apiBase: "https://api.test", concurrency: 1}),
        environment: {PUBLIC_TOKEN: "fixture-token"},
        fetch: async (url, options) => {
            requests.push({url, options});
            if (url.includes("page=2")) return response(200, [], {etag: "page-two"});
            if (url.includes("/commits")) return response(200, []);
            return response(200, [{id: 1}], {link: "<https://api.test/repos/public/repo/pulls/7/reviews?page=2>; rel=\"next\""});
        },
    });
    const credential = {getToken: () => "fixture-token"};
    const result = await client.fetchEndpoint({repository: "public/repo", number: 7, endpoint: "reviews", credential});
    assert.equal(result.status, "COMPLETE");
    assert.equal(result.value.length, 1);
    assert.equal(requests.length, 2);
    assert.equal(requests[0].options.headers.Authorization, "Bearer fixture-token");
    assert.equal(requests[0].options.headers["X-GitHub-Api-Version"], "2022-11-28");

    const empty = await client.fetchEndpoint({repository: "public/repo", number: 7, endpoint: "commits", credential});
    assert.equal(empty.status, "COMPLETE_EMPTY");
});

test("retries rate limits and 5xx at most four attempts without exposing token-safe error bodies", async () => {
    let attempts = 0;
    const client = createGithubClient({
        config: config({apiBase: "https://api.test", maxAttempts: 4}),
        fetch: async () => {
            attempts += 1;
            return response(503, {message: "secret response token fixture-token"}, {"retry-after": "0"});
        },
        sleep: async () => {},
    });
    const result = await client.fetchEndpoint({repository: "public/repo", number: 7, endpoint: "commits", credential: {getToken: () => "fixture-token"}});
    assert.equal(attempts, 4);
    assert.equal(result.status, "FAILED");
    assert.equal(result.errorCode, "RETRYABLE_HTTP");
    assert.doesNotMatch(JSON.stringify(result), /fixture-token|secret response/);
});

test("does not use a rate-limit reset header to delay an ordinary 5xx retry", async () => {
    let attempts = 0;
    const waits = [];
    const client = createGithubClient({
        config: config({apiBase: "https://api.test"}),
        fetch: async () => {
            attempts += 1;
            return attempts === 1
                ? response(500, {message: "temporary failure"}, {"x-ratelimit-reset": "4102444800"})
                : response(200, []);
        },
        sleep: async delay => waits.push(delay),
        random: () => 0,
    });
    const result = await client.fetchEndpoint({repository: "public/repo", number: 7, endpoint: "commits", credential: {getToken: () => "fixture-token"}});
    assert.equal(result.status, "COMPLETE_EMPTY");
    assert.equal(attempts, 2);
    assert.equal(waits[0], 2_000);
    assert.equal(waits.length, 2);
    assert.ok(waits[1] < 1_000);
});

test("retries a 429 with Retry-After and then accepts a successful page", async () => {
    let attempts = 0;
    const client = createGithubClient({
        config: config({apiBase: "https://api.test"}),
        fetch: async () => {
            attempts += 1;
            return attempts === 1 ? response(429, {message: "rate limited"}, {"retry-after": "0"}) : response(200, []);
        },
        sleep: async () => {},
    });
    const result = await client.fetchEndpoint({repository: "public/repo", number: 7, endpoint: "commits", credential: {getToken: () => "fixture-token"}});
    assert.equal(attempts, 2);
    assert.equal(result.status, "COMPLETE_EMPTY");
});

test("keeps an authorization 403 with only a reset header terminal", async () => {
    let attempts = 0;
    const client = createGithubClient({
        config: config({apiBase: "https://api.test"}),
        fetch: async () => { attempts += 1; return response(403, {message: "forbidden"}, {"x-ratelimit-reset": "9999999999"}); },
    });
    const result = await client.fetchEndpoint({repository: "public/repo", number: 7, endpoint: "commits", credential: {getToken: () => "fixture-token"}});
    assert.equal(result.status, "FAILED");
    assert.equal(result.errorCode, "PERMISSION_DENIED");
    assert.equal(attempts, 1);
});

test("classifies every 5xx as retryable while keeping 404 and 410 terminal", () => {
    assert.equal(classifyHttpResponse(response(500)).classification, "RETRYABLE_HTTP");
    assert.equal(classifyHttpResponse(response(404)).decision, "UNAVAILABLE");
    assert.equal(classifyHttpResponse(response(410)).decision, "UNAVAILABLE");
    assert.equal(classifyHttpResponse(response(403, {"x-ratelimit-reset": "10"})).classification, "TERMINAL_HTTP");
});

test("records sanitized start and finish telemetry around each real fetch", async () => {
    const events = [];
    const client = createGithubClient({
        config: config({apiBase: "https://api.test"}),
        environment: {GITHUB_TOKEN: "fixture-token"},
        fetch: async () => response(200, []),
    });
    const result = await client.fetchEndpoint({repository: "public/repo", number: 7, endpoint: "commits", credential: {getToken: () => "fixture-token"}, telemetry: {record: async event => events.push(event)}});
    assert.equal(result.status, "COMPLETE_EMPTY");
    assert.deepEqual(events.map(event => event.eventType), ["ATTEMPT_STARTED", "ATTEMPT_FINISHED"]);
    assert.equal(events[0].attemptId, events[1].attemptId);
    assert.doesNotMatch(JSON.stringify(events), /fixture-token|api\.test|Authorization/);
});

test("rejects telemetry persistence failures before fetching and does not expose the original error", async () => {
    let fetches = 0;
    const secret = "database password: fixture-secret";
    const telemetryError = new Error(secret);
    const client = createGithubClient({
        config: config({apiBase: "https://api.test", maxAttempts: 4}),
        fetch: async () => { fetches += 1; return response(200, []); },
    });

    await assert.rejects(
        client.fetchEndpoint({
            repository: "public/repo",
            number: 7,
            endpoint: "commits",
            credential: {getToken: () => "fixture-token"},
            telemetry: {record: async () => { throw telemetryError; }},
        }),
        error => error.code === "TELEMETRY_PERSISTENCE_FAILED"
            && error.cause === telemetryError
            && !error.message.includes(secret)
            && !JSON.stringify(error).includes(secret),
    );
    assert.equal(fetches, 0);
});

test("classifies a genuine fetch rejection as transport failure", async () => {
    let fetches = 0;
    const client = createGithubClient({
        config: config({apiBase: "https://api.test", maxAttempts: 1}),
        fetch: async () => {
            fetches += 1;
            throw new Error("socket failure");
        },
    });

    const result = await client.fetchEndpoint({
        repository: "public/repo",
        number: 7,
        endpoint: "commits",
        credential: {getToken: () => "fixture-token"},
    });
    assert.equal(result.status, "FAILED");
    assert.equal(result.errorCode, "TRANSPORT_RETRY_EXHAUSTED");
    assert.equal(fetches, 1);
});

test("uses the safe sixty-second fallback for a headerless 429", async () => {
    let attempts = 0;
    const waits = [];
    const client = createGithubClient({
        config: config({apiBase: "https://api.test"}),
        fetch: async () => {
            attempts += 1;
            return attempts === 1 ? response(429, {message: "rate limited"}) : response(200, []);
        },
        sleep: async delay => waits.push(delay),
        random: () => 0,
    });
    const result = await client.fetchEndpoint({repository: "public/repo", number: 7, endpoint: "commits", credential: {getToken: () => "fixture-token"}});
    assert.equal(result.status, "COMPLETE_EMPTY");
    assert.equal(attempts, 2);
    assert.equal(waits.some(delay => delay >= 60_000), true);
});

test("recognizes an explicit secondary-limit 403 without retry-after", async () => {
    let attempts = 0;
    const client = createGithubClient({
        config: config({apiBase: "https://api.test"}),
        fetch: async () => {
            attempts += 1;
            return attempts === 1
                ? response(403, {message: "secondary limit"}, {"x-github-secondary-rate-limit": "true"})
                : response(200, []);
        },
        sleep: async () => {},
    });
    const result = await client.fetchEndpoint({repository: "public/repo", number: 7, endpoint: "commits", credential: {getToken: () => "fixture-token"}});
    assert.equal(result.status, "COMPLETE_EMPTY");
    assert.equal(attempts, 2);
});

test("recognizes the documented secondary-limit message in a 403 as retryable", async () => {
    let attempts = 0;
    const client = createGithubClient({
        config: config({apiBase: "https://api.test"}),
        fetch: async () => {
            attempts += 1;
            return attempts === 1
                ? response(403, {message: "You have exceeded a secondary rate limit. Please wait a few minutes before you try again."})
                : response(200, []);
        },
        sleep: async () => {},
    });
    const result = await client.fetchEndpoint({repository: "public/repo", number: 7, endpoint: "commits", credential: {getToken: () => "fixture-token"}});
    assert.equal(result.status, "COMPLETE_EMPTY");
    assert.equal(attempts, 2);
});

test("records remaining quota and reset time from response headers", () => {
    const coordinator = createQuotaCoordinator({now: () => 5_000, random: () => 0});
    coordinator.observe(new Response("[]", {
        status: 200,
        headers: {"x-ratelimit-remaining": "7", "x-ratelimit-reset": "12"},
    }));
    assert.deepEqual(coordinator.state, {
        remaining: 7,
        resetAt: 12_000,
        retryAt: null,
        concurrency: 1,
    });
});

test("applies safety margin and deterministic jitter to the announced retry time", () => {
    const coordinator = createQuotaCoordinator({
        now: () => 5_000,
        random: () => 0.4,
        margin: 2,
    });
    coordinator.observe(new Response(null, {
        status: 429,
        headers: {"retry-after": "3"},
    }));
    assert.equal(coordinator.state.retryAt, 5_000 + 3_000 + 2_000 + 100);
});

test("does not treat omitted quota headers as exhausted quota", async () => {
    const waits = [];
    const coordinator = createQuotaCoordinator({
        now: () => 5_000,
        sleep: async delay => waits.push(delay),
    });
    coordinator.observe(new Response("[]", {status: 200}));
    const release = await coordinator.acquire(5_000);
    release();
    assert.equal(coordinator.state.remaining, null);
    assert.deepEqual(waits, []);
});

test("increases retry waits exponentially while preserving deterministic jitter and margin", async () => {
    const waits = [];
    let attempts = 0;
    const client = createGithubClient({
        config: config({apiBase: "https://api.test"}),
        now: () => 0,
        random: () => 0,
        sleep: async delay => waits.push(delay),
        fetch: async () => {
            attempts += 1;
            return attempts < 3 ? response(429, {message: "rate limited"}) : response(200, []);
        },
    });
    const result = await client.fetchEndpoint({
        repository: "public/repo",
        number: 7,
        endpoint: "commits",
        credential: {getToken: () => "fixture-token"},
        coordinator: null,
    });
    assert.equal(result.status, "COMPLETE_EMPTY");
    assert.equal(attempts, 3);
    assert.equal(waits.length, 2);
    assert.equal(waits[1] > waits[0], true);
    assert.equal(waits[0] >= 61_000, true);
});

test("does not exponentially multiply valid Retry-After hints", async () => {
    const waits = [];
    let attempts = 0;
    const client = createGithubClient({
        config: config({apiBase: "https://api.test"}),
        fetch: async () => {
            attempts += 1;
            return attempts < 3 ? response(429, {message: "rate limited"}, {"retry-after": "2"}) : response(200, []);
        },
        sleep: async delay => waits.push(delay),
        random: () => 0,
    });
    await client.fetchEndpoint({repository: "public/repo", number: 7, endpoint: "commits", credential: {getToken: () => "fixture-token"}, coordinator: null});
    assert.deepEqual(waits, [3_000, 3_000]);
});

test("pauses after four quota responses instead of failing the page", async () => {
    let attempts = 0;
    const client = createGithubClient({
        config: config({apiBase: "https://api.test", maxAttempts: 4, pageWaitBudgetMs: 1_000_000}),
        fetch: async () => {
            attempts += 1;
            return response(429, {message: "rate limited"});
        },
        sleep: async () => {},
    });
    const result = await client.fetchEndpoint({
        repository: "public/repo",
        number: 7,
        endpoint: "commits",
        credential: {getToken: () => "fixture-token"},
        coordinator: null,
    });
    assert.equal(result.status, "PAUSED");
    assert.equal(result.errorCode, "QUOTA_PAUSED");
    assert.equal(attempts, 4);
});

test("pauses after four documented secondary-limit responses without retaining their bodies", async () => {
    let attempts = 0;
    const client = createGithubClient({
        config: config({apiBase: "https://api.test", maxAttempts: 4, pageWaitBudgetMs: 1_000_000}),
        fetch: async () => {
            attempts += 1;
            return response(403, {message: "You have exceeded a secondary rate limit. Private fixture body."});
        },
    });
    const result = await client.fetchEndpoint({
        repository: "public/repo",
        number: 7,
        endpoint: "commits",
        credential: {getToken: () => "fixture-token"},
        coordinator: null,
    });
    assert.equal(result.status, "PAUSED");
    assert.equal(result.errorCode, "QUOTA_PAUSED");
    assert.equal(attempts, 4);
    assert.doesNotMatch(JSON.stringify(result), /Private fixture body|fixture-token/);
});

test("coordinates quota headers with a safe reset pause and bounded adaptive concurrency", async () => {
    let currentTime = 1_000;
    const waits = [];
    const coordinator = createQuotaCoordinator({
        now: () => currentTime,
        sleep: async delay => { waits.push(delay); currentTime += delay; },
        random: () => 0,
    });
    coordinator.observe(new Response(null, {status: 429, headers: {"retry-after": "2", "x-ratelimit-remaining": "0", "x-ratelimit-reset": "10"}}));
    const release = await coordinator.acquire(currentTime + 10_000);
    release();
    assert.equal(waits[0], 10_000);
    assert.equal(coordinator.concurrency, 1);
    for (let index = 0; index < 40; index += 1) {
        coordinator.observe(new Response("[]", {status: 200, headers: {"x-ratelimit-remaining": "100"}}));
    }
    assert.equal(coordinator.concurrency, 1);
    currentTime += 30_000;
    coordinator.observe(new Response("[]", {status: 200, headers: {"x-ratelimit-remaining": "99"}}));
    assert.equal(coordinator.concurrency, 2);
});

test("paces every acquisition globally and releases queued work without deadlock", async () => {
    let currentTime = 1_000;
    const waits = [];
    const coordinator = createQuotaCoordinator({
        now: () => currentTime,
        sleep: async delay => { waits.push(delay); currentTime += delay; },
    });
    const firstRelease = await coordinator.acquire();
    const secondAcquisition = coordinator.acquire();
    firstRelease();
    const secondRelease = await secondAcquisition;
    secondRelease();
    assert.equal(waits.length, 1);
    assert.equal(waits[0] > 0, true);
    assert.equal(coordinator.active, 0);
});

test("reduces adaptive concurrency after anomalous latency or a rapid quota drop", () => {
    let currentTime = 1_000;
    const coordinator = createQuotaCoordinator({now: () => currentTime});
    coordinator.observe(new Response("[]", {status: 200, headers: {"x-ratelimit-remaining": "100"}}));
    currentTime += 30_000;
    coordinator.observe(new Response("[]", {status: 200, headers: {"x-ratelimit-remaining": "99"}}));
    assert.equal(coordinator.concurrency, 2);
    coordinator.observe(new Response("[]", {status: 200, headers: {"x-ratelimit-remaining": "98"}}), {latencyMs: 30_000});
    assert.equal(coordinator.concurrency, 1);

    currentTime += 30_000;
    coordinator.observe(new Response("[]", {status: 200, headers: {"x-ratelimit-remaining": "90"}}));
    currentTime += 30_000;
    coordinator.observe(new Response("[]", {status: 200, headers: {"x-ratelimit-remaining": "89"}}));
    assert.equal(coordinator.concurrency, 2);
    currentTime += 1_000;
    coordinator.observe(new Response("[]", {status: 200, headers: {"x-ratelimit-remaining": "80"}}));
    assert.equal(coordinator.concurrency, 1);
});

test("starts the network timeout only after shared coordinator acquisition", async () => {
    let allowRequest;
    let fetched = false;
    let signalWasAborted = null;
    const acquisition = new Promise(resolve => { allowRequest = resolve; });
    const coordinator = {
        state: {remaining: null, resetAt: null, retryAt: null, concurrency: 1},
        acquire: async () => { await acquisition; return () => {}; },
        observe: () => {},
    };
    const client = createGithubClient({
        config: config({apiBase: "https://api.test", timeoutMs: 1}),
        fetch: async (_url, options) => {
            fetched = true;
            signalWasAborted = options.signal.aborted;
            return response(200, []);
        },
    });
    const resultPromise = client.fetchEndpoint({
        repository: "public/repo",
        number: 7,
        endpoint: "commits",
        credential: {getToken: () => "fixture-token"},
        coordinator,
    });
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(fetched, false);
    allowRequest();
    const result = await resultPromise;
    assert.equal(result.status, "COMPLETE_EMPTY");
    assert.equal(signalWasAborted, false);
});

test("returns a checkpointable pause when quota reset exceeds the page budget", async () => {
    const client = createGithubClient({
        config: config({apiBase: "https://api.test", pageWaitBudgetMs: 0}),
        now: () => 1_000,
        random: () => 0,
        fetch: async () => new Response(JSON.stringify({message: "rate limited"}), {
            status: 429,
            headers: {"retry-after": "60", "x-ratelimit-remaining": "0", "x-ratelimit-reset": "100"},
        }),
    });
    const result = await client.fetchEndpoint({repository: "public/repo", number: 7, endpoint: "commits", credential: {getToken: () => "fixture-token"}});
    assert.equal(result.status, "PAUSED");
    assert.equal(result.errorCode, "QUOTA_PAUSED");
    assert.equal(result.quota.remaining, 0);
    assert.doesNotMatch(JSON.stringify(result), /rate limited|fixture-token/);
});

test("reuses terminal checkpoint pages without issuing duplicate requests", async () => {
    let requests = 0;
    const client = createGithubClient({
        config: config({apiBase: "https://api.test"}),
        fetch: async () => { requests += 1; return response(200, []); },
    });
    const result = await client.fetchEndpoint({
        repository: "public/repo",
        number: 7,
        endpoint: "commits",
        credential: {getToken: () => "fixture-token"},
        checkpointPages: [{
            endpoint: "commits",
            pageOrdinal: 0,
            state: "COMPLETE_EMPTY",
            normalizedPayload: [],
            normalized: [],
            next: null,
        }],
    });
    assert.equal(result.status, "COMPLETE_EMPTY");
    assert.equal(requests, 0);
});

test("keeps required authorization failures failed and optional unavailable", async () => {
    const client = createGithubClient({
        config: config({apiBase: "https://api.test"}),
        fetch: async url => response(url.includes("timeline") ? 404 : 401, {message: "private body"}),
    });
    const credential = {getToken: () => "fixture-token"};
    const required = await client.fetchEndpoint({repository: "public/repo", number: 7, endpoint: "metadata", credential});
    const optional = await client.fetchEndpoint({repository: "public/repo", number: 7, endpoint: "timeline", credential});
    assert.deepEqual(required, {endpoint: "metadata", status: "FAILED", value: null, errorCode: "AUTHENTICATION_FAILED", httpStatus: 401});
    assert.deepEqual(optional, {endpoint: "timeline", status: "UNAVAILABLE", value: null, errorCode: "NOT_FOUND", httpStatus: 404});
});

test("omits a pull request when every required endpoint returns not found", async () => {
    const client = createGithubClient({
        config: config({apiBase: "https://api.test"}),
        environment: {GITHUB_TOKEN: "fixture-token"},
        fetch: async () => response(404, {message: "Not Found"}),
    });
    const result = await client.fetchPullRequest({repository: "missing/repo", number: 7});
    assert.equal(result.status, "OMITTED");
    assert.equal(result.errorCode, "NOT_FOUND");
    assert.equal(Object.values(result.endpoints).filter(endpoint => endpoint.status === "FAILED").length, 6);
    assert.equal(Object.values(result.endpoints).filter(endpoint => endpoint.status === "UNAVAILABLE").length, 2);
    assert.doesNotMatch(JSON.stringify(result), /Not Found/);
});

test("carries first failed required endpoint errorCode to top-level FAILED result", async () => {
    const client = createGithubClient({
        config: config({apiBase: "https://api.test"}),
        environment: {GITHUB_TOKEN: "fixture-token"},
        fetch: async () => response(503, {message: "service unavailable"}, {"retry-after": "0"}),
    });
    const result = await client.fetchPullRequest({repository: "owner/repo", number: 7});
    assert.equal(result.status, "FAILED");
    assert.equal(result.errorCode, "RETRYABLE_HTTP");
    assert.equal(Object.values(result.endpoints)[0].errorCode, "RETRYABLE_HTTP");
});

test("omits a pull request when metadata is not found despite stale endpoint responses", async () => {
    const client = createGithubClient({
        config: config({apiBase: "https://api.test"}),
        environment: {GITHUB_TOKEN: "fixture-token"},
        fetch: async url => response(url.endsWith("/pulls/7") ? 404 : url.includes("/reviews") ? 200 : 410, []),
    });
    const result = await client.fetchPullRequest({repository: "missing/repo", number: 7});
    assert.equal(result.status, "OMITTED");
    assert.equal(result.endpoints.metadata.errorCode, "NOT_FOUND");
    assert.equal(result.endpoints.issueComments.errorCode, "HTTP_ERROR");
});

test("aggregates all endpoints with bounded concurrency and exact repository routing", async () => {
    let active = 0;
    let peak = 0;
    const requested = [];
    const client = createGithubClient({
        config: config({apiBase: "https://api.test", concurrency: 2}),
        environment: {GITHUB_TOKEN: "shared-token"},
        fetch: async url => {
            active += 1;
            peak = Math.max(peak, active);
            requested.push(new URL(url).pathname);
            await Promise.resolve();
            active -= 1;
            const isMetadata = url.endsWith("/pulls/7");
            return response(200, isMetadata ? {id: 7, title: "fixture"} : []);
        },
    });
    const result = await client.fetchPullRequest({repository: "Private/Repo", number: 7});
    assert.equal(result.status, "COMPLETE");
    assert.equal(result.alias, "default");
    assert.equal(peak, 1);
    assert.equal(requested.length, 8);
});

test("classifies malformed JSON as terminal failure", async () => {
    const client = createGithubClient({
        config: config({apiBase: "https://api.test"}),
        fetch: async () => new Response("not-json", {status: 200}),
    });
    const result = await client.fetchEndpoint({repository: "public/repo", number: 7, endpoint: "commits", credential: {getToken: () => "fixture-token"}});
    assert.equal(result.status, "FAILED");
    assert.equal(result.errorCode, "MALFORMED_JSON");
});

test("exposes deterministic page metadata and detects Link sequence changes", async () => {
    const makeClient = link => createGithubClient({
        config: config({apiBase: "https://api.test"}),
        fetch: async url => url.includes("page=2") || url.includes("page=3") ? response(200, [{id: 2}], {etag: "etag-two"}) : response(200, [{id: 1}], {link, etag: "etag-one"}),
    });
    const credential = {getToken: () => "fixture-token"};
    const first = await makeClient("<https://api.test/page=2>; rel=\"next\"").fetchEndpoint({repository: "public/repo", number: 7, endpoint: "reviews", credential});
    const second = await makeClient("<https://api.test/page=3>; rel=\"next\"").fetchEndpoint({repository: "public/repo", number: 7, endpoint: "reviews", credential});
    assert.equal(first.pageRecords.length, 2);
    assert.deepEqual(Object.keys(first.pageRecords[0]).sort(), [
        "accept", "apiVersion", "endpoint", "etag", "fingerprint", "httpStatus", "itemCount", "next", "nextUrl", "normalized", "normalizedChecksum", "normalizedPayload", "number", "pageOrdinal", "requestFingerprint", "repository", "responseChecksum", "state", "status",
    ].sort());
    assert.equal(first.pageRecords[0].state, "PARTIAL");
    assert.equal(first.pageRecords[1].state, "COMPLETE");
    assert.notEqual(checksumSnapshotManifest({pages: first.pageRecords}), checksumSnapshotManifest({pages: second.pageRecords}));
});

test("keeps mixed and missing ETags page-local", async () => {
    const client = createGithubClient({
        config: config({apiBase: "https://api.test"}),
        fetch: async url => url.includes("page=2") ? response(200, [{id: 2}]) : response(200, [{id: 1}], {link: "<https://api.test/page=2>; rel=\"next\"", etag: "first"}),
    });
    const result = await client.fetchEndpoint({repository: "public/repo", number: 7, endpoint: "reviews", credential: {getToken: () => "fixture-token"}});
    assert.equal(result.pageRecords[0].etag, "first");
    assert.equal(result.pageRecords[1].etag, null);
    assert.equal(result.etag, null);
    assert.equal(result.pageRecords[0].itemCount, 1);
});

test("classifies a 206 diff as truncated without retaining raw response text", async () => {
    const rawDiff = "diff --git a/private.txt b/private.txt";
    const client = createGithubClient({
        config: config({apiBase: "https://api.test"}),
        fetch: async () => new Response(rawDiff, {status: 206, headers: {etag: "diff-etag"}}),
    });
    const result = await client.fetchEndpoint({repository: "public/repo", number: 7, endpoint: "diff", credential: {getToken: () => "fixture-token"}});
    assert.equal(result.status, "TRUNCATED");
    assert.equal(result.pageRecords[0].normalizedPayload, rawDiff);
    assert.equal(Object.hasOwn(result.pageRecords[0], "rawBody"), false);
    assert.equal(JSON.stringify(result).includes("rawBody"), false);
});

test("classifies an oversized complete diff as truncated before reading its body", async () => {
    let bodyRead = false;
    const client = createGithubClient({
        config: config({apiBase: "https://api.test"}),
        fetch: async () => {
            const largeResponse = new Response("oversized diff", {
                status: 200,
                headers: {"content-length": String(MAX_DIFF_BYTES + 1)},
            });
            const originalText = largeResponse.text.bind(largeResponse);
            largeResponse.text = async () => {
                bodyRead = true;
                return originalText();
            };
            return largeResponse;
        },
    });
    const result = await client.fetchEndpoint({repository: "public/repo", number: 7, endpoint: "diff", credential: {getToken: () => "fixture-token"}});
    assert.equal(result.status, "TRUNCATED");
    assert.equal(bodyRead, false);
});

test("rejects malformed JSON and invalid response shape without body leakage", async () => {
    const malformed = createGithubClient({config: config({apiBase: "https://api.test"}), fetch: async () => new Response("private-token-body", {status: 200})});
    const malformedResult = await malformed.fetchEndpoint({repository: "public/repo", number: 7, endpoint: "commits", credential: {getToken: () => "fixture-token"}});
    assert.equal(malformedResult.errorCode, "MALFORMED_JSON");
    assert.equal(JSON.stringify(malformedResult).includes("private-token-body"), false);

    const invalidShape = createGithubClient({config: config({apiBase: "https://api.test"}), fetch: async () => response(200, {unexpected: true})});
    const invalidResult = await invalidShape.fetchEndpoint({repository: "public/repo", number: 7, endpoint: "commits", credential: {getToken: () => "fixture-token"}});
    assert.equal(invalidResult.errorCode, "MALFORMED_JSON");
});

test("canonical checksums ignore object insertion order and preserve run ordinal order", () => {
    assert.equal(checksum({b: 2, a: 1}), checksum({a: 1, b: 2}));
    const pages = [{endpoint: "reviews", pageOrdinal: 0, requestFingerprint: "r", apiVersion: "v", accept: "a", state: "COMPLETE", normalizedPayload: [{id: 1}]}];
    assert.equal(checksumSnapshotManifest({pages}), checksumSnapshotManifest({pages: [...pages].reverse()}));
    const manifest = buildSnapshotManifest({pages, normalizerVersion: "2"});
    assert.equal(checksumSnapshotManifest({pages, normalizerVersion: "2"}), checksum(manifest));
    const snapshots = [{ordinal: 2, snapshotChecksum: "b"}, {ordinal: 1, snapshotChecksum: "a"}];
    assert.deepEqual(buildRunManifest({snapshots}), [{ordinal: 1, snapshotChecksum: "a"}, {ordinal: 2, snapshotChecksum: "b"}]);
    assert.equal(checksumRunManifest({snapshots}), checksumRunManifest({snapshots: [...snapshots].reverse()}));
});

test("only reuses an exact completed-page validator identity", () => {
    const requested = {repository: "public/repo", number: 7, endpoint: "reviews", pageOrdinal: 1, requestFingerprint: "fingerprint", apiVersion: "2022-11-28", accept: "application/vnd.github+json"};
    assert.equal(isExactPageValidatorMatch(requested, {...requested, runState: "COMPLETED", etag: "etag", normalizedPayload: [{id: 1}]}), true);
    assert.equal(isExactPageValidatorMatch(requested, {...requested, pageOrdinal: 2}), false);
    assert.equal(isExactPageValidatorMatch(requested, {...requested, endpoint: "commits"}), false);
    assert.equal(isExactPageValidatorMatch(requested, {...requested, repository: "other/repo"}), false);
    assert.equal(isExactPageValidatorMatch(requested, {...requested, accept: "application/vnd.github.patch"}), false);
    assert.equal(isExactPageValidatorMatch(requested, {...requested, runState: "RUNNING"}), false);
});

test("reuses one exact 304 page and continues with its baseline next URL", async () => {
    const firstClient = createGithubClient({
        config: config({apiBase: "https://api.test"}),
        fetch: async url => url.includes("page=2") ? response(200, [{id: 2}], {etag: "page-two"}) : response(200, [{id: 1}], {link: "<https://api.test/page=2>; rel=\"next\"", etag: "page-one"}),
    });
    const credential = {getToken: () => "fixture-token"};
    const baseline = await firstClient.fetchEndpoint({repository: "public/repo", number: 7, endpoint: "reviews", credential});
    const requests = [];
    const secondClient = createGithubClient({
        config: config({apiBase: "https://api.test"}),
        fetch: async (url, options) => {
            requests.push({url, options});
            if (url.includes("page=2")) return response(200, [{id: 2}], {etag: "page-two"});
            return new Response(null, {status: 304, headers: {etag: "page-one"}});
        },
    });
    const result = await secondClient.fetchEndpoint({repository: "public/repo", number: 7, endpoint: "reviews", credential, baselinePages: baseline.pageRecords});
    assert.equal(result.status, "COMPLETE");
    assert.deepEqual(result.value, [{id: 1}, {id: 2}]);
    assert.equal(result.pageRecords[0].reused, true);
    assert.equal(requests[0].options.headers["If-None-Match"], "page-one");
    assert.equal(requests[1].url, "https://api.test/page=2");
});

test("pauses during pagination and resumes a compatible partial page from its persisted next URL", async () => {
    const requestsBeforePause = [];
    let currentTime = 1_000;
    let resetPassed = false;
    const coordinator = createQuotaCoordinator({now: () => currentTime, sleep: async () => {}, random: () => 0});
    const pausingClient = createGithubClient({
        config: config({apiBase: "https://api.test", pageWaitBudgetMs: 0}),
        fetch: async (url, options) => {
            requestsBeforePause.push({url, options});
            if (!resetPassed && url.includes("page=2")) return response(429, {message: "rate limited"}, {"retry-after": "60"});
            if (resetPassed && url.includes("page=2")) return response(200, [{id: 2}]);
            return response(200, [{id: 1}], {link: "<https://api.test/repos/public/repo/pulls/7/reviews?page=2>; rel=\"next\""});
        },
        random: () => 0,
    });
    const paused = await pausingClient.fetchEndpoint({
        repository: "public/repo",
        number: 7,
        endpoint: "reviews",
        credential: {getToken: () => "fixture-token"},
        coordinator,
    });

    assert.equal(paused.status, "PAUSED");
    assert.equal(paused.pageRecords.length, 1);
    assert.equal(paused.pageRecords[0].state, "PARTIAL");
    assert.equal(paused.pageRecords[0].nextUrl, "https://api.test/repos/public/repo/pulls/7/reviews?page=2");
    assert.equal(requestsBeforePause.length, 2);

    resetPassed = true;
    currentTime = 62_000;
    const resumed = await pausingClient.fetchEndpoint({
        repository: "public/repo",
        number: 7,
        endpoint: "reviews",
        credential: {getToken: () => "fixture-token"},
        checkpointPages: paused.pageRecords,
        coordinator,
    });

    assert.equal(resumed.status, "COMPLETE");
    assert.deepEqual(resumed.value, [{id: 1}, {id: 2}]);
    assert.deepEqual(resumed.pageRecords[0], paused.pageRecords[0]);
    assert.deepEqual(requestsBeforePause.slice(2).map(({url}) => url), ["https://api.test/repos/public/repo/pulls/7/reviews?page=2"]);
});

test("reuses compatible COMPLETE and COMPLETE_EMPTY checkpoint pages without duplicate requests", async () => {
    const credential = {getToken: () => "fixture-token"};
    const firstClient = createGithubClient({
        config: config({apiBase: "https://api.test"}),
        fetch: async url => url.endsWith("/pulls/7") ? response(200, {id: 7}) : response(200, []),
    });
    const metadata = await firstClient.fetchEndpoint({repository: "public/repo", number: 7, endpoint: "metadata", credential});
    const commits = await firstClient.fetchEndpoint({repository: "public/repo", number: 7, endpoint: "commits", credential});
    const requests = [];
    const resumedClient = createGithubClient({
        config: config({apiBase: "https://api.test"}),
        fetch: async url => {
            requests.push(url);
            return response(500, {message: "must not request a compatible checkpoint"});
        },
    });

    const resumedMetadata = await resumedClient.fetchEndpoint({
        repository: "public/repo",
        number: 7,
        endpoint: "metadata",
        credential,
        checkpointPages: metadata.pageRecords,
    });
    const resumedCommits = await resumedClient.fetchEndpoint({
        repository: "public/repo",
        number: 7,
        endpoint: "commits",
        credential,
        checkpointPages: commits.pageRecords,
    });

    assert.equal(metadata.status, "COMPLETE");
    assert.equal(commits.status, "COMPLETE_EMPTY");
    assert.equal(resumedMetadata.status, "COMPLETE");
    assert.equal(resumedCommits.status, "COMPLETE_EMPTY");
    assert.deepEqual(requests, []);
});

test("rejects checkpoint pages with conflicting fingerprints or response checksums", async () => {
    const credential = {getToken: () => "fixture-token"};
    const client = createGithubClient({
        config: config({apiBase: "https://api.test"}),
        fetch: async () => response(200, [{id: 1}]),
    });
    const baseline = await client.fetchEndpoint({repository: "public/repo", number: 7, endpoint: "reviews", credential});
    const conflicts = [
        {...baseline.pageRecords[0], requestFingerprint: "different-fingerprint"},
        {...baseline.pageRecords[0], responseChecksum: "different-response"},
    ];

    const results = [];
    for (const conflict of conflicts) {
        results.push(await client.fetchEndpoint({
            repository: "public/repo",
            number: 7,
            endpoint: "reviews",
            credential,
            checkpointPages: [conflict],
        }));
    }
    assert.deepEqual(results.map(result => result.status), ["FAILED", "FAILED"]);
    assert.deepEqual(results.map(result => result.errorCode), ["CHECKPOINT_CONFLICT", "CHECKPOINT_CONFLICT"]);
});
