import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {once} from "node:events";
import {access, mkdtemp, mkdir, readFile, readdir, rm, writeFile} from "node:fs/promises";
import test from "node:test";
import {tmpdir} from "node:os";
import path from "node:path";
import {parse} from "csv-parse/sync";
import {createApp} from "../app.js";

const csrfToken = "s".repeat(43);
const sessionContext = Object.freeze({
    accountId: "account-a",
    studyId: "study-a",
    participantId: 11,
    participantKey: "participant-a",
});
const participantRows = [
    {participant_id: 11, participant_key: "participant-a", participant_ordinal: 0},
    {participant_id: 22, participant_key: "participant-b", participant_ordinal: 1},
    {participant_id: 33, participant_key: "participant-c", participant_ordinal: 2},
];
const cards = Array.from({length: 30}, (_value, ordinal) => ({
    pr_card_id: `card-${ordinal}`,
    source_card_id: `PR-${ordinal}`,
    card_ordinal: ordinal,
}));
const chromeCandidates = [
    process.env.CHROME_BIN,
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
].filter(Boolean);

class ExportClient {
    constructor(pool) {
        this.pool = pool;
    }

    async query(sql, parameters = []) {
        if (sql.startsWith("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY") || sql === "COMMIT" || sql === "ROLLBACK") {
            return {rows: []};
        }
        if (sql.includes("study-export:study")) {
            return {rows: parameters[0] === "study-a" ? [{
                id: "study-a",
                bootstrap_state: "READY",
                expected_card_count: 30,
                config: {participants: participantRows.map(row => row.participant_key)},
            }] : []};
        }
        if (sql.includes("study-export:participants")) return {rows: participantRows};
        if (sql.includes("study-export:cards")) return {rows: cards};
        if (sql.includes("study-export:terminal-summary")) {
            return {rows: participantRows.flatMap(participant => cards.map(card => {
                const complete = this.pool.completeOrdinals.includes(participant.participant_ordinal);
                const classified = complete && card.card_ordinal % 2 === 0;
                return {
                    participant_id: participant.participant_id,
                    participant_ordinal: participant.participant_ordinal,
                    card_ordinal: card.card_ordinal,
                    classification_count: Number(classified),
                    discard_count: Number(complete && !classified),
                    category_reference_count: Number(classified),
                    valid_category_count: Number(classified),
                };
            }))};
        }
        if (sql.includes("study-export:comparison-rows")) {
            const included = new Set(parameters[1]);
            return {rows: participantRows.filter(participant => included.has(participant.participant_id))
                .flatMap(participant => cards.map(card => {
                    const classified = card.card_ordinal % 2 === 0;
                    return {
                        participant_id: participant.participant_id,
                        participant_ordinal: participant.participant_ordinal,
                        card_ordinal: card.card_ordinal,
                        source_card_id: card.source_card_id,
                        source_html_url: `https://csv.example/pr/${card.card_ordinal}`,
                        promoted_html_url: null,
                        decision: classified ? "CLASSIFIED" : "DISCARDED",
                        category_id: classified ? `category-${participant.participant_id}` : null,
                        valid_category_id: classified ? `category-${participant.participant_id}` : null,
                        category_name: classified ? `Private category ${participant.participant_id}` : null,
                        category_definition: classified ? "Definition, with commas" : null,
                        classification_remarks: classified ? "Unicode note: café" : null,
                    };
                }))};
        }
        throw new Error(`Unexpected export query: ${sql}`);
    }

    release() {}
}

class ExportPool {
    constructor(completeOrdinals) {
        this.completeOrdinals = completeOrdinals;
        this.responses = [];
        this.posts = [];
        this.validatedPosts = [];
        this.getCount = 0;
        this.sessionExpired = false;
        this.delayNextPost = 0;
    }

    async connect() {
        return new ExportClient(this);
    }
}

const createSessionMiddleware = pool => (req, res, next) => {
    const context = pool.sessionExpired ? null : sessionContext;
    if (req.path === "/export/download" && req.method === "POST") {
        pool.posts.push({context, csrfValidated: req.csrfValidated, origin: req.get("Origin")});
    }
    req.sessionContext = context;
    req.csrfToken = context ? csrfToken : null;
    res.locals.sessionContext = context;
    res.locals.csrfToken = context ? csrfToken : null;
    next();
};

const createProbeMiddleware = pool => (req, res, next) => {
    if (req.path === "/export" && req.method === "GET") pool.getCount += 1;
    if (req.path !== "/export/download" || req.method !== "POST") {
        next();
        return;
    }
    pool.validatedPosts.push({csrfValidated: req.csrfValidated, origin: req.get("Origin")});
    const response = pool.responses.shift();
    if (response) {
        res.status(response.status).type(response.type).send(response.body);
        return;
    }
    if (pool.delayNextPost) {
        const delay = pool.delayNextPost;
        pool.delayNextPost = 0;
        setTimeout(next, delay);
        return;
    }
    next();
};

const startServer = async completeOrdinals => {
    const pool = new ExportPool(completeOrdinals);
    const app = await createApp({
        pool,
        sessionMiddleware: createSessionMiddleware(pool),
        middleware: [createProbeMiddleware(pool)],
    });
    const server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    return {server, pool, baseUrl: `http://127.0.0.1:${server.address().port}`};
};

const closeServer = server => new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
    server.closeAllConnections();
});

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
            clearTimeout(pending.timer);
            if (message.error) pending.reject(new Error(`${pending.method} failed: ${message.error.message}`));
            else pending.resolve(message.result);
            return;
        }
        this.waiters = this.waiters.filter(waiter => {
            if (waiter.method !== message.method || (waiter.sessionId && waiter.sessionId !== message.sessionId)
                || !waiter.predicate(message.params)) return true;
            clearTimeout(waiter.timer);
            waiter.resolve(message.params);
            return false;
        });
    }

    send(method, params = {}, sessionId) {
        const id = this.nextRequestId++;
        this.socket.send(JSON.stringify(sessionId ? {id, method, params, sessionId} : {id, method, params}));
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error(`${method} timed out`));
            }, 15000);
            this.pending.set(id, {resolve, reject, method, timer});
        });
    }

    waitFor(method, sessionId, predicate = () => true, timeout = 15000) {
        return new Promise((resolve, reject) => {
            const waiter = {method, sessionId, predicate, resolve, reject};
            waiter.timer = setTimeout(() => {
                this.waiters = this.waiters.filter(entry => entry !== waiter);
                reject(new Error(`Timed out waiting for ${method}`));
            }, timeout);
            this.waiters.push(waiter);
        });
    }
}

const readActivePort = async file => {
    for (let attempt = 0; attempt < 200; attempt += 1) {
        try {
            return await readFile(file, "utf8");
        } catch (_error) {
            await delay(50);
        }
    }
    throw new Error("Chrome did not expose its DevTools port");
};

const launchBrowser = async chrome => {
    const profile = await mkdtemp(path.join(tmpdir(), "labeler-study-export-chrome-"));
    const downloads = await mkdtemp(path.join(tmpdir(), "labeler-study-export-downloads-"));
    const child = spawn(chrome, [
        "--password-store=basic",
        "--headless=new", "--disable-background-networking", "--disable-default-apps", "--disable-extensions",
        "--hide-scrollbars", "--no-first-run", "--remote-allow-origins=*", "--remote-debugging-port=0",
        `--user-data-dir=${profile}`, "about:blank",
    ], {detached: true, stdio: "ignore"});
    let connection;
    try {
        const [port, websocketPath] = (await readActivePort(path.join(profile, "DevToolsActivePort"))).trim().split("\n");
        const socket = new WebSocket(`ws://127.0.0.1:${port}${websocketPath}`);
        await once(socket, "open");
        connection = new DevToolsConnection(socket);
        await connection.send("Browser.setDownloadBehavior", {behavior: "allow", downloadPath: downloads, eventsEnabled: true});
        return {
            connection,
            downloads,
            close: async () => {
                try {
                    process.kill(-child.pid, "SIGTERM");
                } catch (_error) {
                    child.kill("SIGTERM");
                }
                await Promise.race([once(child, "exit"), delay(2000)]);
                if (child.exitCode === null && child.signalCode === null) {
                    try {
                        process.kill(-child.pid, "SIGKILL");
                    } catch (_error) {
                        child.kill("SIGKILL");
                    }
                }
                socket.close();
                await rm(profile, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
            },
        };
    } catch (error) {
        if (connection) connection.socket.close();
        child.kill("SIGKILL");
        await rm(profile, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
        await rm(downloads, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
        throw error;
    }
};

const openPage = async (browser, url, width) => {
    const {connection} = browser;
    const {targetId} = await connection.send("Target.createTarget", {url: "about:blank"});
    const {sessionId} = await connection.send("Target.attachToTarget", {targetId, flatten: true});
    await connection.send("Emulation.setDeviceMetricsOverride", {width, height: 800, deviceScaleFactor: 1, mobile: false}, sessionId);
    await connection.send("Page.enable", {}, sessionId);
    const loaded = connection.waitFor("Page.loadEventFired", sessionId);
    await connection.send("Page.navigate", {url}, sessionId);
    await loaded;
    return {targetId, sessionId};
};

const navigatePage = async (browser, page, url) => {
    const loaded = browser.connection.waitFor("Page.loadEventFired", page.sessionId);
    await browser.connection.send("Page.navigate", {url}, page.sessionId);
    await loaded;
};

const evaluate = async (browser, sessionId, expression) => {
    const {result, exceptionDetails} = await browser.connection.send("Runtime.evaluate", {
        expression,
        awaitPromise: true,
        returnByValue: true,
    }, sessionId);
    if (exceptionDetails) throw new Error(`Browser evaluation failed: ${exceptionDetails.exception?.description ?? exceptionDetails.text}`);
    return result.value;
};

const readExportState = async (browser, sessionId) => evaluate(browser, sessionId, `JSON.stringify({
    title: document.querySelector("main h1")?.textContent.trim() ?? null,
    sectionName: document.querySelector("main section[aria-labelledby]")?.getAttribute("aria-labelledby") ?? null,
    sectionHeading: document.querySelector("main section[aria-labelledby]")?.querySelector("h1")?.textContent.trim() ?? null,
    sectionLabel: document.querySelector("main section[aria-labelledby]")?.textContent.trim() ?? "",
    button: document.querySelector("#study-export-download")?.textContent.trim() ?? null,
    buttonTag: document.querySelector("#study-export-download")?.tagName ?? null,
    status: document.querySelector("[data-export-status]")?.textContent.trim() ?? null,
    statusRole: document.querySelector("[data-export-status]")?.getAttribute("role") ?? null,
    statusLive: document.querySelector("[data-export-status]")?.getAttribute("aria-live") ?? null,
    statusAtomic: document.querySelector("[data-export-status]")?.getAttribute("aria-atomic") ?? null,
    statusHasBusyAncestor: Boolean(document.querySelector("[data-export-status]")?.closest("[aria-busy]")),
    alert: document.querySelector("[data-export-error]")?.classList.contains("d-none") === false
        ? document.querySelector("[data-export-error-message]")?.textContent.trim() ?? null
        : null,
    alertRole: document.querySelector("[data-export-error]")?.getAttribute("role") ?? null,
    loginHref: document.querySelector("[data-export-login]")?.getAttribute("href") ?? null,
    busy: document.querySelector("[data-export-panel]")?.getAttribute("aria-busy") ?? null,
    buttonBusy: document.querySelector("#study-export-download")?.getAttribute("aria-busy") ?? null,
    buttonDisabled: document.querySelector("#study-export-download")?.getAttribute("aria-disabled") ?? null,
    disabledStyle: document.querySelector("#study-export-download")?.classList.contains("disabled") ?? null,
    focus: document.activeElement?.id ?? null,
    overflow: document.documentElement.scrollWidth > window.innerWidth,
    text: document.body.innerText,
    controls: document.querySelectorAll("select, input[name*=participant], input[name*=study]").length,
})`);

const waitForPageText = async (browser, page, text, timeout = 5000) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        const state = JSON.parse(await readExportState(browser, page.sessionId));
        if (state.text.includes(text)) return state;
        await delay(50);
    }
    throw new Error(`Timed out waiting for export page text: ${text}`);
};

const pressKey = async (browser, page, key) => {
    const code = key === " " ? "Space" : key;
    await browser.connection.send("Input.dispatchKeyEvent", {
        type: "keyDown", key, code, text: key === "Enter" ? "\r" : undefined,
        windowsVirtualKeyCode: key === "Enter" ? 13 : key === "Tab" ? 9 : 32,
        nativeVirtualKeyCode: key === "Enter" ? 13 : key === "Tab" ? 9 : 32,
    }, page.sessionId);
    await browser.connection.send("Input.dispatchKeyEvent", {
        type: "keyUp", key, code,
        windowsVirtualKeyCode: key === "Enter" ? 13 : key === "Tab" ? 9 : 32,
        nativeVirtualKeyCode: key === "Enter" ? 13 : key === "Tab" ? 9 : 32,
    }, page.sessionId);
};

const captureViewport = async (browser, page, width) => {
    const outputDirectory = process.env.STUDY_EXPORT_SCREENSHOT_DIR;
    if (!outputDirectory) return;
    await mkdir(outputDirectory, {recursive: true});
    const {data} = await browser.connection.send("Page.captureScreenshot", {format: "png", captureBeyondViewport: false}, page.sessionId);
    const filename = path.join(outputDirectory, `study-export-ready-${width}.png`);
    await writeFile(filename, Buffer.from(data, "base64"));
};

const clickDownload = (browser, page) => evaluate(browser, page.sessionId, "document.querySelector('#study-export-download').click()")
    .then(() => delay(75));

test("Given authenticated participants When the export page renders Then privacy states and responsive layout hold", async () => {
    const chrome = await findChrome();
    const browser = await launchBrowser(chrome);
    const cases = [
        {completeOrdinals: [1, 2], state: "incomplete", copy: "Complete all of your assigned cards in PR cards, then return here."},
        {completeOrdinals: [0], state: "waiting", copy: "Your work is complete. The export will be available when at least one other participant in this study has completed all assigned cards."},
        {completeOrdinals: [0, 2], state: "ready", copy: "Only participants who have completed all assigned cards are included. The CSV contains PR IDs and URLs, and each included participant’s category, description, and comment. Discarded cards are marked DESCARTADO."},
    ];

    try {
        for (const scenario of cases) {
            const fixture = await startServer(scenario.completeOrdinals);
            try {
                for (const width of [375, 768, 1280]) {
                    const page = await openPage(browser, `${fixture.baseUrl}/export`, width);
                    const state = JSON.parse(await readExportState(browser, page.sessionId));
                    assert.equal(state.title, "Export", `${width}px must have a named Export h1`);
                    assert.equal(state.sectionName, "export-title", `${width}px the export section must reference its accessible heading`);
                    assert.equal(state.sectionHeading, "Export", `${width}px the named section heading must be Export`);
                    assert.ok(state.sectionLabel.includes(scenario.copy), `${width}px must show only the ${scenario.state} copy`);
                    assert.equal(state.overflow, false, `${width}px export page must not overflow horizontally`);
                    assert.equal(state.controls, 0, `${width}px export page must not offer participant or study selectors`);
                    assert.equal(state.text.includes("participant-b"), false, `${width}px must not expose incomplete participant identities`);
                    assert.equal(state.text.includes("Private category 22"), false, `${width}px must not expose incomplete categories`);
                    if (scenario.state === "ready") {
                        assert.equal(state.button, "Download CSV", `${width}px ready state must offer a native download button`);
                        assert.equal(state.buttonTag, "BUTTON", `${width}px the download control must be a native button`);
                        assert.match(state.sectionLabel, /2 participants included/i, `${width}px may show only the included participant count`);
                        assert.match(state.sectionLabel, /30 PR cards/i, `${width}px ready state must show the sample size`);
                        assert.equal(state.status, "", `${width}px status should be empty before activation`);
                        assert.deepEqual([state.statusRole, state.statusLive, state.statusAtomic], ["status", "polite", "true"],
                            `${width}px the status region must be polite and atomic`);
                        assert.equal(state.statusHasBusyAncestor, false, `${width}px the live region must not have a busy ancestor`);
                        assert.equal(state.alert, null, `${width}px ready state should not start with an error`);
                        await captureViewport(browser, page, width);
                    } else {
                        assert.equal(state.button, null, `${width}px ${scenario.state} state must not offer a download`);
                        assert.doesNotMatch(state.sectionLabel, /\b\d+\b/, `${width}px ${scenario.state} state must not reveal counts`);
                    }
                    await browser.connection.send("Target.closeTarget", {targetId: page.targetId});
                }
            } finally {
                await closeServer(fixture.server);
            }
        }
    } finally {
        await browser.close();
    }
});

test("Given an eligible participant When they use the keyboard Then one authorized CSV download starts", async () => {
    const chrome = await findChrome();
    const fixture = await startServer([0, 2]);
    const browser = await launchBrowser(chrome);
    try {
        fixture.pool.delayNextPost = 700;
        const page = await openPage(browser, `${fixture.baseUrl}/export`, 768);
        await evaluate(browser, page.sessionId, `(() => {
            const panel = document.querySelector("[data-export-panel]");
            const status = document.querySelector("[data-export-status]");
            window.exportAnnouncementEvents = [];
            const observer = new MutationObserver(records => {
                for (const record of records) {
                    if (record.type === "attributes") {
                        window.exportAnnouncementEvents.push({
                            kind: "busy",
                            value: record.oldValue === "true" ? "false" : "true",
                        });
                    } else {
                        const text = Array.from(record.addedNodes, node => node.textContent).join("");
                        if (text) window.exportAnnouncementEvents.push({kind: "status", text});
                    }
                }
            });
            observer.observe(panel, {attributes: true, attributeFilter: ["aria-busy"], attributeOldValue: true});
            observer.observe(status, {childList: true});
            return true;
        })()`);
        let state = JSON.parse(await readExportState(browser, page.sessionId));
        assert.equal(state.button, "Download CSV", "ready page must expose the download button");
        for (let tab = 0; tab < 12 && state.focus !== "study-export-download"; tab += 1) {
            await pressKey(browser, page, "Tab");
            state = JSON.parse(await readExportState(browser, page.sessionId));
        }
        assert.equal(state.focus, "study-export-download", "Tab must reach the native download button");
        await pressKey(browser, page, "Enter");
        state = await waitForPageText(browser, page, "Preparing your download…");
        assert.equal(state.busy, "true", "the export panel must announce its busy state");
        assert.equal(state.buttonBusy, "true", "the button must announce its busy state");
        assert.equal(state.buttonDisabled, "true", "the button must expose its disabled state while the request runs");
        assert.equal(state.disabledStyle, true, "the button must render its disabled appearance while the request runs");
        assert.deepEqual([state.statusRole, state.statusLive, state.statusAtomic], ["status", "polite", "true"],
            "the loading message must use the polite atomic status region");
        assert.equal(state.focus, "study-export-download", "loading must not move keyboard focus");
        const downloadStarted = browser.connection.waitFor("Browser.downloadWillBegin", null, () => true, 15000);
        await pressKey(browser, page, " ");
        await delay(100);
        assert.equal(fixture.pool.posts.length, 1, "a second keyboard activation must not duplicate the POST");
        const download = await downloadStarted;
        const completed = await browser.connection.waitFor("Browser.downloadProgress", null,
            event => event.guid === download.guid && event.state === "completed", 20000);
        assert.equal(completed.state, "completed", "Chrome must finish the actual CSV download");
        state = await waitForPageText(browser, page, "Download started. Check your browser’s downloads. The file may not be saved yet.");
        assert.equal(state.focus, "study-export-download", "the success announcement must preserve focus");
        const announcementEvents = JSON.parse(await evaluate(browser, page.sessionId, "JSON.stringify(window.exportAnnouncementEvents)"));
        const panelIdleIndex = announcementEvents.findIndex(event => event.kind === "busy" && event.value === "false");
        const successUpdateIndex = announcementEvents.findIndex(event => event.kind === "status"
            && event.text === "Download started. Check your browser’s downloads. The file may not be saved yet.");
        assert.ok(panelIdleIndex >= 0, "the busy panel must become idle before success is announced");
        assert.ok(successUpdateIndex > panelIdleIndex,
            "the live-region success update must occur after aria-busy is cleared");
        assert.equal(fixture.pool.posts.length, 1, "one keyboard action must produce exactly one POST");
        assert.equal(fixture.pool.validatedPosts[0].csrfValidated, true, "the same-origin POST must pass the session CSRF middleware");
        assert.equal(fixture.pool.validatedPosts[0].origin, fixture.baseUrl, "the POST must carry the browser's same origin");
        const csvPath = path.join(browser.downloads, download.suggestedFilename);
        const records = parse(await readFile(csvPath), {bom: false, columns: false, record_delimiter: "\r\n"});
        assert.equal(records.length, 31, "the actual downloaded CSV must contain the header and all 30 sample rows");
        assert.equal(records[0].length, 8, "only two complete participants must be represented in the CSV");
        assert.ok(records[0].includes("categoria_usuario_1"));
        assert.ok(records[0].includes("categoria_usuario_3"));
        assert.equal(records.flat().some(value => /participant-b|Private category 22/.test(value)), false,
            "the CSV must omit the incomplete participant entirely");
        assert.equal(records[1][0], "PR-0", "the browser download must contain parsed CSV fields, not an HTML response");
    } finally {
        await browser.close();
        await closeServer(fixture.server);
    }
});

test("Given stale eligibility and error responses When download is attempted Then it never saves HTML and retries stay manual", async () => {
    const chrome = await findChrome();
    const fixture = await startServer([0, 2]);
    const browser = await launchBrowser(chrome);
    try {
        const page = await openPage(browser, `${fixture.baseUrl}/export`, 375);
        fixture.pool.sessionExpired = true;
        await clickDownload(browser, page);
        let state = await waitForPageText(browser, page, "Your session has expired. Log in to continue.");
        assert.ok(state.text.includes("Login"), "an expired session must provide an accessible Login link");
        assert.equal(state.loginHref, "/login", "the expired-session link must use the public Login route");
        assert.equal(fixture.pool.posts.length, 1, "the expired request must not be retried");
        assert.deepEqual(await readdir(browser.downloads), [], "a 401 response must not create a download");

        fixture.pool.sessionExpired = false;
        await navigatePage(browser, page, `${fixture.baseUrl}/export`);
        await waitForPageText(browser, page, "Download CSV");
        fixture.pool.completeOrdinals = [0];
        await clickDownload(browser, page);
        state = await waitForPageText(browser, page, "The export will be available when at least one other participant");
        assert.equal(fixture.pool.posts.length, 2, "a stale 403 must not trigger another POST");
        assert.equal(fixture.pool.getCount, 3, "a stale 403 must issue a fresh GET export state request");
        assert.equal(state.button, null, "the GET refresh must display the newly waiting state");

        fixture.pool.completeOrdinals = [0, 2];
        fixture.pool.responses.push(
            {status: 200, type: "text/html", body: "<!doctype html><title>Login</title>Unexpected HTML"},
            {status: 409, type: "text/plain", body: "stale export"},
            {status: 500, type: "text/html", body: "<html>internal error</html>"},
        );
        await navigatePage(browser, page, `${fixture.baseUrl}/export`);
        await waitForPageText(browser, page, "Download CSV");
        for (let attempt = 0; attempt < 3; attempt += 1) {
            await clickDownload(browser, page);
            state = await waitForPageText(browser, page, "We couldn’t prepare the export. Please try again.");
            assert.equal(state.alert, "We couldn’t prepare the export. Please try again.", "HTML and server errors must use generic alert copy");
            assert.equal(state.alertRole, "alert", "recoverable errors must be announced as alerts");
            assert.equal(fixture.pool.posts.length, 3 + attempt, "an error must not submit an automatic retry");
            assert.deepEqual(await readdir(browser.downloads), [], "non-CSV responses must never create a download");
        }
    } finally {
        await browser.close();
        await closeServer(fixture.server);
    }
});
