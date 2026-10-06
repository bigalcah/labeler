import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {once} from "node:events";
import {access, copyFile, mkdtemp, readFile, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {pathToFileURL} from "node:url";
import test from "node:test";
import ejs from "ejs";
import {projectCardV2} from "../util/study-card-projection.js";
import {renderSafeMarkdown} from "../util/safe-markdown.js";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const cardTemplatePath = path.join(root, "views/partials/instance/data.ejs");
const prCardScriptPath = path.join(root, "public/js/pr-card.js");
const mainCssPath = path.join(root, "public/css/main.css");

const baseCard = {
    id: "browser-card",
    source_card_id: "browser-card",
    repository: "owner/repo",
    pr_number: 7,
    ordinal: 0,
    title: "Browser disclosure card",
    body: "CSV body",
    author: "csv-author",
    language: "JavaScript",
    state: "open",
    merged: false,
    html_url: "https://github.com/owner/repo/pull/7",
    created_at_source: "2024-01-01",
    closed_at_source: null,
    merged_at_source: null,
    summary: {},
    evidence: {selected: "CSV evidence"},
};

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
    const userDataDirectory = await mkdtemp(path.join(tmpdir(), "labeler-pr-card-chrome-"));
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

const openSections = browser => sessionId => evaluate(browser, sessionId, "document.querySelectorAll('details[data-local-section]').forEach(details => { details.open = true; })");

const sectionProbe = name => `(() => {
    const section = document.querySelector('[data-local-section="${name}"]');
    if (!section) return JSON.stringify({missing: true});
    const items = [ ...section.querySelectorAll("[data-local-item]") ];
    const button = section.querySelector(".pr-event-list button");
    const badge = section.querySelector("summary .badge");
    return JSON.stringify({
        items: items.length,
        hidden: items.map(item => item.hidden),
        visible: items.filter(item => !item.hidden).length,
        buttonLabel: button ? button.textContent.trim() : null,
        buttonType: button ? button.getAttribute("type") : null,
        badge: badge ? badge.textContent.trim() : null,
        state: section.querySelector(".pr-unavailable-state")?.textContent.trim() ?? null,
        text: items.map(item => item.textContent).join(" "),
    });
})()`;

const readSection = async (browser, sessionId, name) => JSON.parse(await evaluate(browser, sessionId, sectionProbe(name)));

const focusButton = (browser, sessionId, name) => evaluate(browser, sessionId, `(() => {
    const button = document.querySelector('[data-local-section="${name}"] .pr-event-list button');
    if (!button) return false;
    button.focus();
    return document.activeElement === button;
})()`);

const clickButton = (browser, sessionId, name) => evaluate(browser, sessionId, `document.querySelector('[data-local-section="${name}"] .pr-event-list button').click()`);

const focusProbe = "JSON.stringify({tag: document.activeElement.tagName, section: document.activeElement.closest ? (document.activeElement.closest('[data-local-section]')?.getAttribute('data-local-section') ?? null) : null})";

const keyDescriptors = {
    Enter: {
        down: {type: "keyDown", key: "Enter", code: "Enter", text: "\r", unmodifiedText: "\r", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13},
        up: {type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13},
    },
    " ": {
        down: {type: "keyDown", key: " ", code: "Space", text: " ", unmodifiedText: " ", windowsVirtualKeyCode: 32, nativeVirtualKeyCode: 32},
        up: {type: "keyUp", key: " ", code: "Space", windowsVirtualKeyCode: 32, nativeVirtualKeyCode: 32},
    },
};

const pressKey = async (browser, sessionId, name) => {
    const descriptor = keyDescriptors[name];
    await browser.connection.send("Page.bringToFront", {}, sessionId);
    await browser.connection.send("Input.dispatchKeyEvent", descriptor.down, sessionId);
    await browser.connection.send("Input.dispatchKeyEvent", descriptor.up, sessionId);
};

const buildPages = ({reviews = 0, issue_comments = 0, review_comments = 0, blankReviews = 0}) => {
    const reviewPayload = [];
    for (let index = 0; index < reviews; index += 1) {
        reviewPayload.push({
            id: index + 1,
            state: index === 0 ? "CHANGES_REQUESTED" : "APPROVED",
            body: `Review body ${index + 1}`,
            submitted_at: `2024-01-${String(index + 1).padStart(2, "0")}`,
        });
    }
    for (let index = 0; index < blankReviews; index += 1) {
        reviewPayload.push({
            id: 100 + index,
            user: {login: `blank-reviewer-${index}`},
            state: "APPROVED",
            body: index % 2 === 0 ? null : "   ",
        });
    }
    const comments = count => Array.from({length: count}, (_, index) => ({id: index + 1, body: `Comment body ${index + 1}`}));
    return [
        {endpoint: "reviews", state: "COMPLETE", normalized_payload: reviewPayload},
        {endpoint: "issueComments", state: "COMPLETE", normalized_payload: comments(issue_comments)},
        {endpoint: "reviewComments", state: "COMPLETE", normalized_payload: comments(review_comments)},
    ];
};

test("Given the participant card When Chromium loads it Then GitHub evidence uses cumulative 3-item batches with keyboard-operable disclosure and managed focus", async () => {
    const chrome = await findChrome();
    const directory = await mkdtemp(path.join(tmpdir(), "labeler-pr-card-browser-"));
    let browser = null;

    try {
        const template = await readFile(cardTemplatePath, "utf8");
        await Promise.all([
            copyFile(prCardScriptPath, path.join(directory, "pr-card.js")),
            copyFile(mainCssPath, path.join(directory, "main.css")),
        ]);

        const renderFixture = counts => {
            const projected = projectCardV2(baseCard, {run_id: "run", snapshot_checksum: "checksum", pages: buildPages(counts)});
            const cardHtml = ejs.render(template, {data: {...baseCard, card_v2: projected}, renderSafeMarkdown});
            return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>PR card fixture</title><link rel="stylesheet" href="main.css"></head><body><main class="container">${cardHtml}</main><script src="pr-card.js"></script></body></html>`;
        };

        const fixtures = {
            "counts-0.html": renderFixture({}),
            "counts-1.html": renderFixture({reviews: 1}),
            "counts-3.html": renderFixture({reviews: 3}),
            "counts-4.html": renderFixture({reviews: 4}),
            "counts-6.html": renderFixture({reviews: 6}),
            "counts-7.html": renderFixture({reviews: 7}),
            "independent.html": renderFixture({reviews: 4, issue_comments: 6, review_comments: 7}),
            "blank-body.html": renderFixture({reviews: 5, blankReviews: 2}),
            "blank-only.html": renderFixture({blankReviews: 4}),
            "keyboard.html": renderFixture({reviews: 4}),
            "space.html": renderFixture({reviews: 7}),
        };
        for (const [name, html] of Object.entries(fixtures)) {
            await writeFile(path.join(directory, name), html);
        }

        browser = await launchBrowser(chrome);
        const fileUrl = name => pathToFileURL(path.join(directory, name)).href;

        for (const count of [0, 1, 3, 4, 6, 7]) {
            const page = await openPage(browser, fileUrl(`counts-${count}.html`), {width: 1280, height: 900});
            try {
                await openSections(browser)(page.sessionId);
                const reviews = await readSection(browser, page.sessionId, "reviews");
                assert.equal(reviews.items, count, `reviews with ${count} eligible records must render exactly ${count} items`);
                assert.equal(reviews.visible, Math.min(3, count), `reviews with ${count} eligible records must start with min(3, count) visible items`);
                const expectedLabel = count > 3 ? `Show ${Math.min(3, count - 3)} more` : null;
                assert.equal(reviews.buttonLabel, expectedLabel, `reviews with ${count} eligible records must announce ${expectedLabel ?? "no control"}`);
                if (expectedLabel) assert.equal(reviews.buttonType, "button", "the disclosure control must be a real button element");

                if (expectedLabel) {
                    await clickButton(browser, page.sessionId, "reviews");
                    const afterBatch = await readSection(browser, page.sessionId, "reviews");
                    assert.equal(afterBatch.visible, Math.min(6, count), `reviews with ${count} eligible records must reveal min(3, remaining) more on activation`);
                    assert.ok(afterBatch.buttonLabel === null || afterBatch.visible < count, `reviews with ${count} eligible records must never dump every item at once`);
                    assert.equal(afterBatch.buttonLabel, count > 6 ? `Show ${Math.min(3, count - 6)} more` : null, `reviews with ${count} eligible records must re-announce the remaining batch`);
                }
            } finally {
                await closePage(browser, page.targetId);
            }
        }

        const independentPage = await openPage(browser, fileUrl("independent.html"), {width: 1280, height: 900});
        try {
            await openSections(browser)(independentPage.sessionId);
            const expectations = {
                reviews: {items: 4, visible: 3, label: "Show 1 more"},
                issue_comments: {items: 6, visible: 3, label: "Show 3 more"},
                review_comments: {items: 7, visible: 3, label: "Show 3 more"},
            };
            for (const [name, expected] of Object.entries(expectations)) {
                const section = await readSection(browser, independentPage.sessionId, name);
                assert.equal(section.items, expected.items, `${name} must render its own eligible item count`);
                assert.equal(section.visible, expected.visible, `${name} must render its own initial preview`);
                assert.equal(section.buttonLabel, expected.label, `${name} must announce its own remaining batch`);
            }
            await clickButton(browser, independentPage.sessionId, "reviews");
            const reviewsAfter = await readSection(browser, independentPage.sessionId, "reviews");
            const commentsAfter = await readSection(browser, independentPage.sessionId, "issue_comments");
            assert.equal(reviewsAfter.buttonLabel, null, "finishing one section must remove only its own control");
            assert.equal(commentsAfter.visible, 3, "finishing one section must not reveal another section's items");
            assert.equal(commentsAfter.buttonLabel, "Show 3 more", "finishing one section must not disturb another section's control");
        } finally {
            await closePage(browser, independentPage.targetId);
        }

        const blankPage = await openPage(browser, fileUrl("blank-body.html"), {width: 1280, height: 900});
        try {
            await openSections(browser)(blankPage.sessionId);
            const blank = await readSection(browser, blankPage.sessionId, "reviews");
            assert.equal(blank.items, 5, "reviews without a written body must not be eligible");
            assert.ok(!blank.text.includes("blank-reviewer"), "a review without a written body must not render an entry");
            assert.match(blank.badge, /· 7$/, "the captured_count badge must keep the snapshot count including bodyless reviews");
            assert.equal(blank.visible, 3, "the eligible-only preview must ignore bodyless reviews");
            assert.equal(blank.buttonLabel, "Show 2 more", "the batch announcement must be computed from eligible reviews only");
        } finally {
            await closePage(browser, blankPage.targetId);
        }

        const blankOnlyPage = await openPage(browser, fileUrl("blank-only.html"), {width: 1280, height: 900});
        try {
            await openSections(browser)(blankOnlyPage.sessionId);
            const blankOnly = await readSection(browser, blankOnlyPage.sessionId, "reviews");
            assert.equal(blankOnly.items, 0, "captured reviews with no written body must not render entries");
            assert.equal(blankOnly.visible, 0, "no review entry must be visible");
            assert.equal(blankOnly.buttonLabel, null, "captured-but-empty reviews must not offer a batch control");
            assert.match(blankOnly.state, /No written review explanations/, "the explicit empty state must appear inside the section when opened");
            assert.match(blankOnly.state, /The local snapshot captured 4 review events without written text\./, "the explicit state must name the captured count");
            assert.match(blankOnly.badge, /· 4$/, "the badge must keep the captured snapshot count");
        } finally {
            await closePage(browser, blankOnlyPage.targetId);
        }

        const keyboardPage = await openPage(browser, fileUrl("keyboard.html"), {width: 1280, height: 900});
        try {
            await openSections(browser)(keyboardPage.sessionId);
            assert.equal(await focusButton(browser, keyboardPage.sessionId, "reviews"), true, "the disclosure button must be focusable");
            assert.equal((await readSection(browser, keyboardPage.sessionId, "reviews")).visible, 3, "the reviews preview must start with three visible items");
            await pressKey(browser, keyboardPage.sessionId, "Enter");
            const afterEnter = await readSection(browser, keyboardPage.sessionId, "reviews");
            assert.equal(afterEnter.visible, 4, "pressing Enter on the button must reveal the final batch");
            assert.equal(afterEnter.buttonLabel, null, "the control must be removed after the final batch");
            const focusAfterEnter = JSON.parse(await evaluate(browser, keyboardPage.sessionId, focusProbe));
            assert.equal(focusAfterEnter.tag, "SUMMARY", "focus must move to the section summary when the final control disappears");
            assert.equal(focusAfterEnter.section, "reviews", "focus must stay within the affected section");
        } finally {
            await closePage(browser, keyboardPage.targetId);
        }

        const spacePage = await openPage(browser, fileUrl("space.html"), {width: 1280, height: 900});
        try {
            await openSections(browser)(spacePage.sessionId);
            assert.equal(await focusButton(browser, spacePage.sessionId, "reviews"), true, "the disclosure button must be focusable");
            await pressKey(browser, spacePage.sessionId, " ");
            const afterSpace = await readSection(browser, spacePage.sessionId, "reviews");
            assert.equal(afterSpace.visible, 6, "pressing Space must reveal exactly one batch");
            assert.equal(afterSpace.buttonLabel, "Show 1 more", "the control must announce the final remaining batch");
            assert.equal(afterSpace.buttonType, "button", "the control must remain a real button between batches");
            await pressKey(browser, spacePage.sessionId, "Enter");
            const afterFinal = await readSection(browser, spacePage.sessionId, "reviews");
            assert.equal(afterFinal.visible, 7, "the final activation must reveal the last item");
            assert.equal(afterFinal.buttonLabel, null, "the control must be removed once every item is visible");
            const focusAfterFinal = JSON.parse(await evaluate(browser, spacePage.sessionId, focusProbe));
            assert.equal(focusAfterFinal.tag, "SUMMARY", "focus must be managed after the final control disappears");
            assert.equal(focusAfterFinal.section, "reviews", "focus must remain in the affected section after the final batch");
        } finally {
            await closePage(browser, spacePage.targetId);
        }

        for (const width of [375, 768, 1280]) {
            const layoutPage = await openPage(browser, fileUrl("counts-7.html"), {width, height: 900});
            try {
                await openSections(browser)(layoutPage.sessionId);
                const layout = JSON.parse(await evaluate(browser, layoutPage.sessionId, "JSON.stringify({viewport: window.innerWidth, overflow: document.documentElement.scrollWidth > window.innerWidth})"));
                assert.equal(layout.viewport, width, `${width}px card must render in a real CSS viewport`);
                assert.equal(layout.overflow, false, `${width}px compact card must not overflow horizontally`);
            } finally {
                await closePage(browser, layoutPage.targetId);
            }
        }
    } finally {
        if (browser) await browser.close();
        await rm(directory, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
    }
});
