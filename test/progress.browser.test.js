import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {once} from "node:events";
import {access, mkdtemp, readFile, rm} from "node:fs/promises";
import test from "node:test";
import {tmpdir} from "node:os";
import path from "node:path";
import {createApp} from "../app.js";

const aliceSession = Object.freeze({
    accountId: "account-alice",
    studyId: "study-1",
    participantId: 11,
    participantKey: "participant-a",
});
const cardId = index => `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
const cardTitle = index => `Alice card ${index}`;
const cardState = (index, status, ownCategory = null, discardReason = null) => ({
    id: cardId(index),
    ordinal: index,
    title: cardTitle(index),
    html_url: `https://example.test/pr/${index}`,
    status,
    own_category: ownCategory,
    discard_reason: discardReason,
});

const aliceRows = [
    cardState(0, "CLASSIFIED", "Alpha"),
    cardState(1, "PENDING"),
    cardState(2, "DISCARDED", null, "duplicate"),
    cardState(3, "CLASSIFIED", "Beta"),
    cardState(4, "PENDING"),
    cardState(5, "CLASSIFIED", "Alpha"),
    cardState(6, "PENDING"),
    cardState(7, "DISCARDED"),
    cardState(8, "PENDING"),
    cardState(9, "CLASSIFIED", "Alpha"),
    cardState(10, "PENDING"),
    cardState(11, "PENDING"),
];
const aliceCategories = [
    {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
        raw_name: "Alpha",
        total: 3,
        cards: [0, 5, 9].map(index => ({id: cardId(index), ordinal: index, title: cardTitle(index), html_url: aliceRows[index].html_url})),
    },
    {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2",
        raw_name: "Beta",
        total: 1,
        cards: [3].map(index => ({id: cardId(index), ordinal: index, title: cardTitle(index), html_url: aliceRows[index].html_url})),
    },
    {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3",
        raw_name: "Zero",
        total: 0,
        cards: [],
    },
];
const aliceProgress = {total: 12, classified: 4, discarded: 2, pending: 6};
const bobSession = Object.freeze({
    accountId: "account-bob",
    studyId: "study-1",
    participantId: 22,
    participantKey: "participant-b",
});
const bobRows = aliceRows.map((row, index) => ({
    id: row.id,
    ordinal: row.ordinal,
    title: row.title,
    html_url: row.html_url,
    status: index === 0 ? "CLASSIFIED" : "PENDING",
    own_category: index === 0 ? "Bob private category" : null,
    discard_reason: null,
}));
const bobCategories = [{
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1",
    raw_name: "Bob private category",
    total: 1,
    cards: [{id: cardId(0), ordinal: 0, title: cardTitle(0), html_url: "https://example.test/pr/0"}],
}];
const bobProgress = {total: 12, classified: 1, discarded: 0, pending: 11};

class ProgressPool {
    constructor() {
        this.queries = [];
    }

    async query(sql, parameters = []) {
        this.queries.push({sql, parameters});
        const participantId = parameters[1];
        const state = participantId === aliceSession.participantId || participantId === undefined
            ? {rows: aliceRows, categories: aliceCategories, progress: aliceProgress}
            : {rows: bobRows, categories: bobCategories, progress: bobProgress};
        if (sql.includes("COUNT(study_card.pr_card_id)")) return {rows: [state.progress]};
        if (sql.includes("jsonb_agg(")) return {rows: state.categories};
        if (/COUNT\(\*\)::INTEGER AS total/.test(sql)) return {rows: [{total: state.rows.length}]};
        if (sql.includes("study_card.pr_card_id AS id")) {
            const [, , limit, offset] = parameters;
            return {rows: state.rows.slice(offset, offset + limit)};
        }
        throw new Error(`Unexpected progress query: ${sql}`);
    }
}

const startServer = async (sessionContext = aliceSession) => {
    const pool = new ProgressPool();
    const navigationRequests = [];
    const app = await createApp({
        pool,
        sessionMiddleware: (req, res, next) => {
            req.sessionContext = sessionContext;
            req.csrfToken = "fixture-csrf-token";
            res.locals.sessionContext = sessionContext;
            res.locals.csrfToken = req.csrfToken;
            next();
        },
        middleware: [
            (req, res, next) => {
                if (/^\/queue\/[^/]+$/.test(req.path)) {
                    navigationRequests.push(req.originalUrl);
                    res.type("html").send("<!DOCTYPE html><html lang=\"en\"><head><title>Fixture card</title></head><body><p data-card-target=\"true\">Fixture card route</p></body></html>");
                    return;
                }
                next();
            },
        ],
    });
    const server = app.listen(0);
    await once(server, "listening");
    return {server, pool, navigationRequests};
};

const closeServer = server => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));

const chromeCandidates = [
    process.env.CHROME_BIN,
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
].filter(Boolean);

const findChrome = async () => {
    for (const candidate of chromeCandidates) {
        try {
            await access(candidate);
            return candidate;
        } catch (_error) {
            continue;
        }
    }
    throw new Error("A Chrome or Chromium executable is required; set CHROME_BIN to run the browser regression");
};

const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

class DevToolsConnection {
    constructor(socket) {
        this.socket = socket;
        this.nextRequestId = 1;
        this.pending = new Map();
        this.waiters = [];
        socket.addEventListener("message", event => this.handleMessage(JSON.parse(event.data)));
    }

    handleMessage(message) {
        if (message.id !== undefined) {
            const pending = this.pending.get(message.id);
            if (!pending) return;
            this.pending.delete(message.id);
            if (message.error) pending.reject(new Error(`${pending.method} failed: ${message.error.message}`));
            else pending.resolve(message.result);
            return;
        }
        this.waiters = this.waiters.filter(waiter => {
            if (waiter.method !== message.method || (waiter.sessionId && waiter.sessionId !== message.sessionId)) return true;
            clearTimeout(waiter.timer);
            waiter.resolve(message.params);
            return false;
        });
    }

    send(method, params = {}, sessionId) {
        const id = this.nextRequestId++;
        const payload = sessionId ? {id, method, params, sessionId} : {id, method, params};
        this.socket.send(JSON.stringify(payload));
        return new Promise((resolve, reject) => this.pending.set(id, {resolve, reject, method}));
    }

    waitFor(method, sessionId, timeoutMilliseconds = 15000) {
        return new Promise((resolve, reject) => {
            const waiter = {method, sessionId, resolve};
            waiter.timer = setTimeout(() => {
                this.waiters = this.waiters.filter(entry => entry !== waiter);
                reject(new Error(`Timed out waiting for ${method}`));
            }, timeoutMilliseconds);
            this.waiters.push(waiter);
        });
    }

    close() {
        this.socket.close();
    }
}

const readDevToolsActivePort = async file => {
    for (let attempt = 0; attempt < 200; attempt += 1) {
        try {
            return await readFile(file, "utf8");
        } catch (_error) {
            await delay(50);
        }
    }
    throw new Error("Chrome did not expose its DevTools port");
};

const stopBrowserProcess = async child => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    child.kill("SIGTERM");
    await Promise.race([once(child, "exit"), delay(2000)]);
    if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
        await once(child, "exit");
    }
};

const launchBrowser = async chrome => {
    const userDataDirectory = await mkdtemp(path.join(tmpdir(), "labeler-progress-chrome-"));
    const child = spawn(chrome, [
        "--headless=new",
        "--disable-background-networking",
        "--disable-default-apps",
        "--disable-extensions",
        "--hide-scrollbars",
        "--no-first-run",
        "--remote-allow-origins=*",
        "--remote-debugging-port=0",
        `--user-data-dir=${userDataDirectory}`,
        "about:blank",
    ], {stdio: ["ignore", "ignore", "pipe"]});

    try {
        const activePort = await readDevToolsActivePort(path.join(userDataDirectory, "DevToolsActivePort"));
        const [port, websocketPath] = activePort.trim().split("\n");
        const socket = new WebSocket(`ws://127.0.0.1:${port}${websocketPath}`);
        await once(socket, "open");
        const connection = new DevToolsConnection(socket);
        return {
            connection,
            close: async () => {
                connection.close();
                await stopBrowserProcess(child);
                await rm(userDataDirectory, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
            },
        };
    } catch (error) {
        child.kill("SIGKILL");
        await rm(userDataDirectory, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
        throw error;
    }
};

const progressProbe = `(() => {
    const text = element => element ? element.textContent.trim() : null;
    const rows = [ ...document.querySelectorAll("[data-progress-row]") ].map(row => {
        const link = row.querySelector("a");
        return {
            ordinal: Number(row.getAttribute("data-ordinal")),
            cardId: row.getAttribute("data-card-id"),
            status: row.getAttribute("data-status"),
            href: link ? link.getAttribute("href") : null,
            title: text(link ? link.querySelector(".fw-semibold") : null),
            detail: text(link ? link.querySelector(".text-muted") : null),
            badge: text(link ? link.querySelector(".badge") : null),
        };
    });
    const groups = [ ...document.querySelectorAll("[data-category-group]") ].map(group => ({
        id: group.getAttribute("data-category-id"),
        name: group.getAttribute("data-category-name"),
        count: Number(group.getAttribute("data-category-count")),
        badge: text(group.querySelector(".badge")),
        empty: text(group.querySelector("[data-category-empty]")),
        cards: [ ...group.querySelectorAll("[data-category-card]") ].map(card => ({
            cardId: card.getAttribute("data-card-id"),
            ordinal: Number(card.getAttribute("data-ordinal")),
            href: card.getAttribute("href"),
        })),
    }));
    const disabledControls = [ ...document.querySelectorAll(".pagination .page-item.disabled .page-link") ].map(link => link.textContent.trim());
    const ariaDisabledControls = [ ...document.querySelectorAll(".pagination .page-link[aria-disabled='true']") ].map(link => link.textContent.trim());
    const emptyState = document.querySelector("[data-progress-empty]");
    return JSON.stringify({
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        hasHorizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
        rows,
        groups,
        activePage: text(document.querySelector("[aria-current='page']")),
        previousHref: document.querySelector(".pagination [rel='prev']")?.getAttribute("href") ?? null,
        nextHref: document.querySelector(".pagination [rel='next']")?.getAttribute("href") ?? null,
        previousDisabled: disabledControls.includes("Previous"),
        nextDisabled: disabledControls.includes("Next"),
        ariaDisabledControls,
        paginationNavLabel: document.querySelector("nav[aria-label='Progress pages']")?.getAttribute("aria-label") ?? null,
        paginationLinks: [ ...document.querySelectorAll(".pagination a") ].map(link => link.getAttribute("href")),
        pageMetadata: text(document.querySelector("[data-progress-page]")),
        emptyState: text(emptyState),
        emptyRole: emptyState ? emptyState.getAttribute("role") : null,
        totalBadge: text(document.querySelector("[data-progress-total]")),
        hrefs: [ ...document.querySelectorAll("a[href]") ].map(link => link.getAttribute("href")),
        identityControls: document.querySelectorAll("select, input[name*='participant'], input[name*='study'], input[name*='reviewer']").length,
        bodyText: document.body.innerText,
        bodyHtml: document.body.innerHTML,
    });
})()`;

const openPage = async (browser, url, {width, height}) => {
    const {connection} = browser;
    const {targetId} = await connection.send("Target.createTarget", {url: "about:blank"});
    const {sessionId} = await connection.send("Target.attachToTarget", {targetId, flatten: true});
    await connection.send("Emulation.setDeviceMetricsOverride", {width, height, deviceScaleFactor: 1, mobile: false}, sessionId);
    await connection.send("Page.enable", {}, sessionId);
    const loaded = connection.waitFor("Page.loadEventFired", sessionId);
    await connection.send("Page.navigate", {url}, sessionId);
    await loaded;
    return {targetId, sessionId};
};

const closePage = async (browser, targetId) => {
    try {
        await browser.connection.send("Target.closeTarget", {targetId});
    } catch (_error) {
        // Browser teardown closes the target as well.
    }
};

const evaluate = async (browser, sessionId, expression) => {
    const {result, exceptionDetails} = await browser.connection.send("Runtime.evaluate", {expression, returnByValue: true}, sessionId);
    if (exceptionDetails) throw new Error(`Browser evaluation failed: ${exceptionDetails.exception?.description ?? exceptionDetails.text}`);
    return result.value;
};

const readProgressPage = async (browser, url, viewport) => {
    const page = await openPage(browser, url, {width: viewport, height: 800});
    try {
        return JSON.parse(await evaluate(browser, page.sessionId, progressProbe));
    } finally {
        await closePage(browser, page.targetId);
    }
};

const assertCanonicalLinks = (layout, viewport) => {
    for (const href of layout.hrefs) {
        assert.doesNotMatch(href, /instances|participant|study|reviewer/i, `${viewport}px progress must not emit legacy or identity links: ${href}`);
    }
    assert.equal(layout.identityControls, 0, `${viewport}px progress must not emit participant or study selectors`);
    assert.ok(!layout.bodyHtml.includes("/instances"), `${viewport}px progress must not reference the legacy instances surface`);
};

const assertNoOtherParticipant = (layout, viewport) => {
    assert.ok(!layout.bodyText.includes("participant-b"), `${viewport}px progress must not render the other participant identity`);
    assert.ok(!layout.bodyText.includes("Bob private"), `${viewport}px progress must not render the other participant data`);
};

const assertCategorySummary = (layout, viewport) => {
    assert.deepEqual(layout.groups.map(group => group.name), ["Alpha", "Beta", "Zero"], `${viewport}px progress must render every current category including unused ones`);
    assert.deepEqual(layout.groups.map(group => group.count), [3, 1, 0], `${viewport}px progress must render whole-membership counts including zero`);
    assert.deepEqual(layout.groups[0].cards.map(card => card.ordinal), [0, 5, 9], `${viewport}px grouped cards must stay in ordinal order`);
    assert.deepEqual(layout.groups[1].cards.map(card => card.ordinal), [3], `${viewport}px each category must group only its own classified cards`);
    assert.deepEqual(layout.groups[2].cards, [], `${viewport}px unused categories must not invent cards`);
    assert.match(layout.groups[2].empty ?? "", /No classified cards in this category yet/, `${viewport}px unused categories must render an accessible empty group`);
    const groupedIds = layout.groups.flatMap(group => group.cards.map(card => card.cardId));
    assert.equal(new Set(groupedIds).size, groupedIds.length, `${viewport}px each classified card must appear exactly once across groups`);
    for (const card of layout.groups.flatMap(group => group.cards)) {
        assert.equal(card.href, `/queue/${card.cardId}`, `${viewport}px grouped cards must link to the canonical queue route`);
    }
};

const viewportWidths = [375, 768, 1280];

test("Given an authenticated participant When Chromium renders progress Then the private listing, paginator and full category summary hold at real viewports", async () => {
    const chrome = await findChrome();
    const {server, pool} = await startServer();
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const browser = await launchBrowser(chrome);

    try {
        for (const viewport of viewportWidths) {
            const firstPage = await readProgressPage(browser, `${baseUrl}/progress?page=1&limit=5`, viewport);
            const expectedRows = aliceRows.slice(0, 5);

            assert.equal(firstPage.viewportWidth, viewport, `${viewport}px progress must render in a real CSS viewport`);
            assert.equal(firstPage.viewportHeight, 800, `${viewport}px progress must render in a real 800px tall CSS viewport`);
            assert.deepEqual(firstPage.rows.map(row => row.ordinal), [0, 1, 2, 3, 4], `${viewport}px the first page must list the first five ordinals in order`);
            assert.deepEqual(firstPage.rows.map(row => row.cardId), expectedRows.map(row => row.id), `${viewport}px every row must carry its canonical card identifier`);
            assert.deepEqual(firstPage.rows.map(row => row.status), ["CLASSIFIED", "PENDING", "DISCARDED", "CLASSIFIED", "PENDING"], `${viewport}px every row must expose its private status`);
            assert.deepEqual(firstPage.rows.map(row => row.badge), ["CLASSIFIED", "PENDING", "DISCARDED", "CLASSIFIED", "PENDING"], `${viewport}px every row must render a status badge`);
            assert.deepEqual(firstPage.rows.map(row => row.href), expectedRows.map(row => `/queue/${row.id}`), `${viewport}px every row must link to /queue/:id without identity`);
            assert.deepEqual(firstPage.rows.map(row => row.title), expectedRows.map(row => row.title), `${viewport}px every row must render its card title`);
            assert.deepEqual(
                firstPage.rows.map(row => row.detail),
                [
                    "Classified as Alpha",
                    "Pending your private response",
                    "Discarded: duplicate",
                    "Classified as Beta",
                    "Pending your private response",
                ],
                `${viewport}px classified, pending and discarded rows must show only their own private decision`,
            );
            assert.equal(firstPage.totalBadge, "12 assigned cards", `${viewport}px the listing must expose the whole membership total`);
            assertCategorySummary(firstPage, viewport);
            assertCanonicalLinks(firstPage, viewport);
            assertNoOtherParticipant(firstPage, viewport);
            assert.equal(firstPage.hasHorizontalOverflow, false, `${viewport}px the progress page must not overflow horizontally`);

            assert.equal(firstPage.activePage, "1", `${viewport}px the active page must be marked`);
            assert.equal(firstPage.paginationNavLabel, "Progress pages", `${viewport}px the paginator must expose its accessible name`);
            assert.deepEqual(firstPage.ariaDisabledControls, ["Previous"], `${viewport}px page one must mark only the previous control as aria-disabled`);
            assert.equal(firstPage.emptyRole, null, `${viewport}px a non-empty page must not render the empty state`);
            assert.equal(firstPage.previousHref, null, `${viewport}px page one must not link to a previous page`);
            assert.equal(firstPage.previousDisabled, true, `${viewport}px page one must expose a disabled previous control`);
            assert.equal(firstPage.nextHref, "/progress?page=2&limit=5", `${viewport}px page one must link to the next page with normalized parameters`);
            assert.equal(firstPage.nextDisabled, false, `${viewport}px page one must expose an enabled next control`);
            assert.equal(firstPage.pageMetadata, "Page 1 of 3 · 12 assigned cards · up to 5 per page", `${viewport}px the paginator must expose the effective page metadata`);
            for (const href of firstPage.paginationLinks) {
                assert.match(href, /^\/progress\?page=\d+&limit=5$/, `${viewport}px pagination links must carry only normalized page and limit`);
            }

            const secondPage = await readProgressPage(browser, `${baseUrl}/progress?page=2&limit=5`, viewport);
            assert.deepEqual(secondPage.rows.map(row => row.ordinal), [5, 6, 7, 8, 9], `${viewport}px the second page must continue the ordinal order without gaps`);
            assert.deepEqual(secondPage.groups, firstPage.groups, `${viewport}px the category summary must not depend on the page`);
            assert.equal(secondPage.activePage, "2", `${viewport}px the second page must be marked as active`);
            assert.deepEqual(secondPage.ariaDisabledControls, [], `${viewport}px an interior page must not aria-disable either control`);
            assert.equal(secondPage.previousHref, "/progress?page=1&limit=5", `${viewport}px the second page must link back to page one`);
            assert.equal(secondPage.nextHref, "/progress?page=3&limit=5", `${viewport}px the second page must link to page three`);

            const normalizedLimit = await readProgressPage(browser, `${baseUrl}/progress?page=1&limit=1000`, viewport);
            assert.equal(normalizedLimit.rows.length, 12, `${viewport}px a hostile limit must fall back to the normalized maximum`);
            assert.equal(normalizedLimit.pageMetadata, "Page 1 of 1 · 12 assigned cards · up to 100 per page", `${viewport}px the listing must expose the normalized limit`);
            assert.deepEqual(normalizedLimit.ariaDisabledControls, ["Previous", "Next"], `${viewport}px a single-page listing must aria-disable both controls`);
            assert.deepEqual(normalizedLimit.groups, firstPage.groups, `${viewport}px normalizing the limit must not change the category summary`);

            const outOfRange = await readProgressPage(browser, `${baseUrl}/progress?page=9&limit=5`, viewport);
            assert.deepEqual(outOfRange.rows, [], `${viewport}px an out-of-range page must not render rows`);
            assert.match(outOfRange.emptyState ?? "", /No cards on this page\./, `${viewport}px an out-of-range page must render an accessible empty state`);
            assert.equal(outOfRange.emptyRole, "status", `${viewport}px the empty state must expose a status role`);
            assert.deepEqual(outOfRange.groups, firstPage.groups, `${viewport}px the category summary must survive an out-of-range page`);
            assert.equal(outOfRange.activePage, "9", `${viewport}px the requested out-of-range page must stay active`);
            assert.deepEqual(outOfRange.ariaDisabledControls, ["Next"], `${viewport}px the empty page must aria-disable only the next control`);
            assert.equal(outOfRange.previousHref, "/progress?page=8&limit=5", `${viewport}px the empty page must keep previous navigation`);
            assert.equal(outOfRange.nextHref, null, `${viewport}px the empty page must not offer a next link past the membership`);
            assert.equal(outOfRange.nextDisabled, true, `${viewport}px the empty page must disable the next control`);
            assert.equal(outOfRange.pageMetadata, "Page 9 of 3 · 12 assigned cards · up to 5 per page", `${viewport}px the empty page must preserve the requested metadata`);

            const hostile = await readProgressPage(
                browser,
                `${baseUrl}/progress?page=1&limit=5&participant=participant-b&participant_id=22&study=study-2&study_id=study-2&reviewer_id=22`,
                viewport,
            );
            assert.deepEqual(hostile.rows.map(row => row.cardId), expectedRows.map(row => row.id), `${viewport}px hostile identity parameters must not change the listed rows`);
            assertNoOtherParticipant(hostile, viewport);
        }

        for (const {parameters} of pool.queries) {
            assert.equal(parameters[0], aliceSession.studyId, "every progress query must be scoped to the session study");
            assert.ok(!parameters.includes(22), "no progress query may use the other participant identifier");
            assert.ok(!parameters.includes("participant-b") && !parameters.includes("study-2"), "no progress query may use hostile identity values");
        }
    } finally {
        await browser.close();
        await closeServer(server);
    }
});

test("Given two participants of the same study When each Chromium session renders progress Then only the session participant private decisions are visible", async () => {
    const chrome = await findChrome();
    const aliceServer = await startServer(aliceSession);
    const bobServer = await startServer(bobSession);
    const aliceBaseUrl = `http://127.0.0.1:${aliceServer.server.address().port}`;
    const bobBaseUrl = `http://127.0.0.1:${bobServer.server.address().port}`;
    const browser = await launchBrowser(chrome);

    try {
        for (const viewport of [375, 1280]) {
            const alicePage = await readProgressPage(browser, `${aliceBaseUrl}/progress?page=1&limit=5`, viewport);
            const bobPage = await readProgressPage(browser, `${bobBaseUrl}/progress?page=1&limit=5`, viewport);

            assert.deepEqual(alicePage.rows.map(row => row.status), ["CLASSIFIED", "PENDING", "DISCARDED", "CLASSIFIED", "PENDING"], `${viewport}px Alice must keep her own decisions`);
            assert.equal(alicePage.rows[0].detail, "Classified as Alpha", `${viewport}px Alice must see her own category`);
            assert.ok(!alicePage.bodyText.includes("Bob private category"), `${viewport}px Alice must not see Bob private data`);

            assert.deepEqual(bobPage.rows.map(row => row.cardId), alicePage.rows.map(row => row.cardId), `${viewport}px both participants must keep the same membership`);
            assert.deepEqual(bobPage.rows.map(row => row.ordinal), alicePage.rows.map(row => row.ordinal), `${viewport}px both participants must keep the same ordinal order`);
            assert.deepEqual(bobPage.rows.map(row => row.status), ["CLASSIFIED", "PENDING", "PENDING", "PENDING", "PENDING"], `${viewport}px Bob must see only his own decisions`);
            assert.equal(bobPage.rows[0].detail, "Classified as Bob private category", `${viewport}px Bob must see his own category`);
            assert.deepEqual(bobPage.groups.map(group => group.name), ["Bob private category"], `${viewport}px Bob must see only his own category summary`);
            assert.deepEqual(bobPage.groups[0].cards.map(card => card.ordinal), [0], `${viewport}px Bob must group only his own classified card`);
            assert.equal(bobPage.totalBadge, "12 assigned cards", `${viewport}px Bob must see the shared membership total`);
            assert.ok(bobPage.bodyText.includes("participant-b"), `${viewport}px Bob must see his own session identity`);
            assert.ok(!bobPage.bodyText.includes("participant-a"), `${viewport}px Bob must not see Alice session identity`);
            assert.ok(!bobPage.bodyText.includes("Classified as Alpha") && !bobPage.bodyText.includes("duplicate"), `${viewport}px Bob must not see Alice private decisions`);
            assert.ok(!bobPage.bodyText.includes("Alpha") && !bobPage.bodyText.includes("Beta") && !bobPage.bodyText.includes("Zero"), `${viewport}px Bob must not see Alice category names`);
        }

        for (const {parameters} of bobServer.pool.queries) {
            assert.equal(parameters[0], bobSession.studyId, "every Bob query must be scoped to the session study");
            assert.ok(!parameters.includes(aliceSession.participantId), "no Bob query may use Alice participant identifier");
            assert.ok(!parameters.includes("participant-a") && !parameters.includes("study-2"), "no Bob query may use hostile identity values");
        }
    } finally {
        await browser.close();
        await closeServer(aliceServer.server);
        await closeServer(bobServer.server);
    }
});

test("Given the progress listing When a card is activated Then the browser requests the canonical queue route without identity", async () => {
    const chrome = await findChrome();
    const {server, navigationRequests} = await startServer();
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const browser = await launchBrowser(chrome);

    try {
        for (const viewport of viewportWidths) {
            const page = await openPage(browser, `${baseUrl}/progress?page=1&limit=5`, {width: viewport, height: 800});
            try {
                const href = await evaluate(browser, page.sessionId, "document.querySelector('[data-progress-row] a').getAttribute('href')");
                assert.equal(href, `/queue/${aliceRows[0].id}`, `${viewport}px the first row must expose the canonical queue route`);

                const loaded = browser.connection.waitFor("Page.loadEventFired", page.sessionId).catch(() => null);
                const {exceptionDetails} = await browser.connection.send("Runtime.evaluate", {
                    expression: "document.querySelector('[data-progress-row] a').click()",
                }, page.sessionId);
                assert.equal(exceptionDetails, undefined, `${viewport}px the progress listing must render a clickable card row`);
                await loaded;

                const destination = JSON.parse(await evaluate(browser, page.sessionId, "JSON.stringify({pathname: location.pathname, search: location.search, marker: document.querySelector('[data-card-target]')?.textContent.trim() ?? null})"));
                assert.equal(destination.pathname, `/queue/${aliceRows[0].id}`, `${viewport}px activating a card must navigate to its canonical queue route`);
                assert.equal(destination.search, "", `${viewport}px the queue navigation must not carry identity parameters`);
                assert.equal(destination.marker, "Fixture card route", `${viewport}px the canonical queue route must receive the navigation`);
                assert.equal(navigationRequests.at(-1), `/queue/${aliceRows[0].id}`, `${viewport}px the server must receive the canonical queue request`);
            } finally {
                await closePage(browser, page.targetId);
            }
        }
    } finally {
        await browser.close();
        await closeServer(server);
    }
});
