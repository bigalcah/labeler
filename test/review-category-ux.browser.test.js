import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {once} from "node:events";
import {access, mkdtemp, readFile, rm} from "node:fs/promises";
import http from "node:http";
import {tmpdir} from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
import test from "node:test";
import ejs from "ejs";
import {CATEGORY_PALETTE} from "../util/category-palette.js";
import {CONTENT_SECURITY_POLICY} from "../util/security-headers.js";
import {renderSafeMarkdown} from "../util/safe-markdown.js";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const reviewView = path.join(root, "views/review.ejs");
const reviewScriptPath = path.join(root, "public/js/review.js");
const prCardScriptPath = path.join(root, "public/js/pr-card.js");
const mainCssPath = path.join(root, "public/css/main.css");

const cardId = "550e8400-e29b-41d4-a716-446655440000";
const alphaId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const betaId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const csrfToken = "t".repeat(43);

const categoryFixture = (id, rawName, definition = null, colorSlot = 0) => ({
    id,
    raw_name: rawName,
    definition,
    color_slot: colorSlot,
    updated_at: "2026-01-01T00:00:00.000Z",
});

const alpha = categoryFixture(alphaId, "Alpha", "Alpha definition", 0);
const beta = categoryFixture(betaId, "Beta", null, 1);

const cardFixture = ({categoryId = null, status = "PENDING", ownCategory = null} = {}) => ({
    id: cardId,
    ordinal: 0,
    status,
    revision: status === "CLASSIFIED" ? 1 : 0,
    category_id: categoryId,
    own_category: ownCategory,
    discard_reason: null,
    remarks: "",
    title: "Fixture card title",
    html_url: "https://example.test/pr/1",
    card_v2: {
        identity: {source_card_id: cardId, repository: "owner/repo", pr_number: 1},
        fields: {
            title: {value: "Fixture card title", availability: "PRESENT"},
            html_url: {value: "https://example.test/pr/1", availability: "PRESENT"},
            author: {value: "author", availability: "PRESENT"},
            state: {value: "open", availability: "PRESENT"},
            merged: {value: false, availability: "PRESENT"},
        },
        dates: {created_at: {value: "2024-01-01"}, closed_at: {value: null}, merged_at: {value: null}},
        dataset_language: {value: "JavaScript"},
        snapshot: null,
        csv_evidence: {body: "CSV body", selected: "Selected CSV evidence"},
        github_evidence: {},
    },
});

const renderReview = ({card, categories}) => ejs.renderFile(reviewView, {
    participant: {name: "participant-a"},
    card,
    categories,
    progress: {total: 1, classified: card.status === "CLASSIFIED" ? 1 : 0, discarded: 0, pending: card.status === "CLASSIFIED" ? 0 : 1, completed: card.status === "CLASSIFIED" ? 1 : 0},
    total: 1,
    navigation: {previousId: null, nextId: null},
    csrfToken,
    sessionContext: {studyId: "study-1", participantId: 11, participantKey: "participant-a"},
    path: `/queue/${cardId}`,
    os: "Linux",
    renderSafeMarkdown,
});

const readRequestBody = request => new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", chunk => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
});

const send = (response, {status, contentType, body}, extraHeaders = {}) => {
    response.writeHead(status, {"content-type": contentType, "content-security-policy": CONTENT_SECURITY_POLICY, ...extraHeaders});
    response.end(body);
};

const defaultCreate = body => ({status: 201, body: {id: "created-category", raw_name: body.name, definition: body.definition || null, color_slot: 5, color: CATEGORY_PALETTE[5], updated_at: "2026-01-01T00:00:01.000Z"}});
const defaultRename = (id, body) => ({status: 200, body: {id, raw_name: body.name, definition: body.definition || null, color_slot: 1, color: CATEGORY_PALETTE[1], updated_at: "2026-01-01T00:00:02.000Z"}});

const startFixtureServer = async (html, handlers = {}) => {
    const server = http.createServer(async (request, response) => {
        const url = new URL(request.url, "http://127.0.0.1");
        try {
            if (request.method === "GET" && url.pathname === "/js/review.js") return send(response, {status: 200, contentType: "text/javascript", body: await readFile(reviewScriptPath)});
            if (request.method === "GET" && url.pathname === "/js/pr-card.js") return send(response, {status: 200, contentType: "text/javascript", body: await readFile(prCardScriptPath)});
            if (request.method === "GET" && url.pathname === "/css/main.css") return send(response, {status: 200, contentType: "text/css", body: await readFile(mainCssPath)});
            if (request.method === "GET" && (url.pathname === "/" || url.pathname.startsWith("/queue/"))) return send(response, {status: 200, contentType: "text/html; charset=utf-8", body: html});
            if (request.method === "POST" && url.pathname === "/categories") {
                const body = JSON.parse(await readRequestBody(request) || "{}");
                const result = (handlers.create || defaultCreate)(body);
                return send(response, {status: result.status, contentType: "application/json", body: JSON.stringify(result.body)});
            }
            if (request.method === "PATCH" && url.pathname.startsWith("/categories/")) {
                const body = JSON.parse(await readRequestBody(request) || "{}");
                const id = decodeURIComponent(url.pathname.slice("/categories/".length));
                const result = (handlers.rename || defaultRename)(id, body);
                return send(response, {status: result.status, contentType: "application/json", body: JSON.stringify(result.body)});
            }
            return send(response, {status: 404, contentType: "text/plain", body: ""});
        } catch (error) {
            return send(response, {status: 500, contentType: "text/plain", body: String(error?.message || error)});
        }
    });
    server.listen(0);
    await once(server, "listening");
    return server;
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
    const userDataDirectory = await mkdtemp(path.join(tmpdir(), "labeler-review-category-chrome-"));
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

const cspInitScript = `
window.__cspViolations = [];
window.__xss = undefined;
document.addEventListener("securitypolicyviolation", event => {
    window.__cspViolations.push({directive: event.violatedDirective, blockedURI: event.blockedURI, sample: event.sample});
});
`;

const openPage = async (browser, url, {width, height}) => {
    const {connection} = browser;
    const {targetId} = await connection.send("Target.createTarget", {url: "about:blank"});
    const {sessionId} = await connection.send("Target.attachToTarget", {targetId, flatten: true});
    await connection.send("Emulation.setDeviceMetricsOverride", {width, height, deviceScaleFactor: 1, mobile: false}, sessionId);
    await connection.send("Emulation.setFocusEmulationEnabled", {enabled: true}, sessionId);
    await connection.send("Page.enable", {}, sessionId);
    await connection.send("Page.addScriptToEvaluateOnNewDocument", {source: cspInitScript}, sessionId);
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

const waitForExpression = async (browser, sessionId, expression, timeoutMilliseconds = 5000) => {
    const startedAt = Date.now();
    for (;;) {
        const value = await evaluate(browser, sessionId, expression);
        if (value) return value;
        if (Date.now() - startedAt > timeoutMilliseconds) throw new Error(`Timed out waiting for expression: ${expression}`);
        await delay(50);
    }
};

const reviewProbe = `(() => {
    const text = element => element ? element.textContent.trim() : null;
    const slotOf = element => element ? (element.className.match(/category-slot-\\d+/) || [null])[0] : null;
    const parseRgb = value => (value.match(/\\d+/g) || []).slice(0, 3).map(Number);
    const luminance = rgb => {
        const channels = rgb.map(channel => channel / 255).map(channel => channel <= 0.03928 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4));
        return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
    };
    const contrast = (foreground, background) => {
        const first = luminance(foreground);
        const second = luminance(background);
        return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
    };
    const options = [ ...document.querySelectorAll("[data-category-option]") ].map(item => {
        const radio = item.querySelector("[data-category-radio]");
        const indicator = item.querySelector(".category-selected-indicator");
        const button = item.querySelector("[data-category-rename]");
        const rowStyle = getComputedStyle(item);
        const rowBorderLeftColor = rowStyle.borderLeftColor;
        return {
            id: item.getAttribute("data-category-option"),
            radioName: radio ? radio.getAttribute("name") : null,
            radioValue: radio ? radio.value : null,
            required: radio ? radio.required : null,
            checked: radio ? radio.checked : null,
            selectedClass: item.classList.contains("is-selected"),
            rowSlot: slotOf(item),
            rowInlineStyle: item.getAttribute("style"),
            rowBorderLeftColor,
            rowBorderLeftWidth: rowStyle.borderLeftWidth,
            rowBorderContrast: rowBorderLeftColor ? contrast(parseRgb(rowBorderLeftColor), [255, 255, 255]) : null,
            indicatorDisplay: indicator ? getComputedStyle(indicator).display : null,
            indicatorText: text(indicator),
            name: text(item.querySelector(".category-name")),
            definition: text(item.querySelector(".category-definition")),
            definitionHidden: item.querySelector(".category-definition") ? item.querySelector(".category-definition").hidden : null,
            buttonInsideLabel: button ? Boolean(button.closest("label")) : null,
            labelContainsButton: button ? Boolean(item.querySelector("label")?.contains(button)) : null,
        };
    });
    const form = document.querySelector('form[action$="/classify"]');
    const focusedOption = document.activeElement ? document.activeElement.closest("[data-category-option]") : null;
    return JSON.stringify({
        options,
        optionCount: options.length,
        hasList: Boolean(document.querySelector("[data-category-list]")),
        emptyState: text(document.querySelector("[data-category-empty]")),
        dotCount: document.querySelectorAll(".category-color-dot").length,
        inlineStyleElements: document.querySelectorAll("#category-list [style], [data-category-radio][style], .category-option[style]").length,
        formValid: form ? form.checkValidity() : null,
        cspViolations: window.__cspViolations || [],
        xss: window.__xss === undefined ? null : window.__xss,
        activeTag: document.activeElement ? document.activeElement.tagName : null,
        activeRadioChecked: document.activeElement && document.activeElement.matches("[data-category-radio]") ? document.activeElement.checked : null,
        focusedOptionBorderLeft: focusedOption ? getComputedStyle(focusedOption).borderLeftColor : null,
        focusedOptionBoxShadow: focusedOption ? getComputedStyle(focusedOption).boxShadow : null,
        focusedOptionId: focusedOption ? focusedOption.getAttribute("data-category-option") : null,
        focusWithin: focusedOption ? focusedOption.matches(":focus-within") : null,
        overflow: document.documentElement.scrollWidth > window.innerWidth,
        viewportWidth: window.innerWidth,
        cardPresent: Boolean(document.querySelector(".pr-card")),
    });
})()`;

const readReview = async (browser, sessionId) => JSON.parse(await evaluate(browser, sessionId, reviewProbe));

const focusRadio = (browser, sessionId, index) => evaluate(browser, sessionId, `(() => {
    const radios = [ ...document.querySelectorAll("[data-category-radio]") ];
    if (!radios[${index}]) return false;
    radios[${index}].focus();
    return document.activeElement === radios[${index}];
})()`);

const keyDescriptors = {
    ArrowDown: {key: "ArrowDown", code: "ArrowDown", windowsVirtualKeyCode: 40, nativeVirtualKeyCode: 40},
    ArrowUp: {key: "ArrowUp", code: "ArrowUp", windowsVirtualKeyCode: 38, nativeVirtualKeyCode: 38},
    " ": {key: " ", code: "Space", text: " ", unmodifiedText: " ", windowsVirtualKeyCode: 32, nativeVirtualKeyCode: 32},
};

const pressKey = async (browser, sessionId, name) => {
    const descriptor = keyDescriptors[name];
    await browser.connection.send("Page.bringToFront", {}, sessionId);
    await browser.connection.send("Input.dispatchKeyEvent", {type: "keyDown", ...descriptor}, sessionId);
    await browser.connection.send("Input.dispatchKeyEvent", {type: "keyUp", ...descriptor}, sessionId);
    await delay(50);
};

const submitCategoryForm = (browser, sessionId, {formId, name, definition}) => evaluate(browser, sessionId, `(() => {
    const form = document.getElementById(${JSON.stringify(formId)});
    if (!form) return false;
    const nameInput = form.querySelector("input[name=name], #${formId === "new-category-form" ? "category-name" : "rename-category-name"}");
    if (nameInput) nameInput.value = ${JSON.stringify(name)};
    if (${JSON.stringify(definition)} !== null) {
        const definitionInput = form.querySelector("textarea[name=definition]");
        if (definitionInput) definitionInput.value = ${JSON.stringify(definition)};
    }
    form.dispatchEvent(new Event("submit", {cancelable: true, bubbles: true}));
    return true;
})()`);

const clickEditButton = (browser, sessionId, optionId) => evaluate(browser, sessionId, `(() => {
    const item = document.querySelector('[data-category-option="${optionId}"]');
    const button = item ? item.querySelector("[data-category-rename]") : null;
    if (!button) return false;
    button.click();
    return true;
})()`);

const assertCleanSurface = (layout, context) => {
    assert.deepEqual(layout.cspViolations, [], `${context} must render without CSP violations`);
    assert.equal(layout.inlineStyleElements, 0, `${context} must not emit any inline style attributes`);
    assert.equal(layout.dotCount, 0, `${context} must not render any isolated color dot`);
    assert.equal(layout.xss, null, `${context} must not execute hostile category text`);
};

const assertPaletteColor = (option, context) => {
    assert.ok(/^category-slot-\d+$/.test(option.rowSlot ?? ""), `${context} must expose a palette slot class on the row`);
    const slot = Number(option.rowSlot.slice("category-slot-".length));
    const expected = CATEGORY_PALETTE[slot];
    const [ red, green, blue ] = expected.slice(1).match(/.{2}/g).map(component => parseInt(component, 16));
    assert.equal(option.rowBorderLeftColor, `rgb(${red}, ${green}, ${blue})`, `${context} must render the palette color on the row bar for ${expected}`);
    assert.equal(option.rowInlineStyle, null, `${context} must not inline the row color`);
    assert.ok(option.rowBorderContrast >= 3, `${context} row bar must keep at least 3:1 contrast, measured ${option.rowBorderContrast?.toFixed(2)}:1`);
};

test("Given a pending card When Chromium renders the category list Then native radios, palette classes and untouched CSP work together", async () => {
    const chrome = await findChrome();
    const html = await renderReview({card: cardFixture(), categories: [alpha, beta]});
    const server = await startFixtureServer(html);
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const browser = await launchBrowser(chrome);

    try {
        const page = await openPage(browser, `${baseUrl}/queue/${cardId}`, {width: 1280, height: 900});
        try {
            const initial = await readReview(browser, page.sessionId);
            assert.equal(initial.optionCount, 2, "both server-rendered categories must appear as selection rows");
            assert.equal(initial.hasList, true, "the category list must be present");
            assert.deepEqual(initial.options.map(option => option.radioName), ["category_id", "category_id"], "every row must use the category_id field");
            assert.deepEqual(initial.options.map(option => option.required), [true, true], "with no selection the radios must be required");
            assert.deepEqual(initial.options.map(option => option.checked), [false, false], "no row may start selected");
            assert.deepEqual(initial.options.map(option => option.name), ["Alpha", "Beta"], "rows must render their category names");
            assert.deepEqual(initial.options.map(option => option.definition), ["Alpha definition", null], "rows must render their definition when present");
            assert.equal(initial.formValid, false, "the classify form must be invalid until a category is selected");
            for (const [index, option] of initial.options.entries()) {
                assertPaletteColor(option, `SSR row ${index}`);
                assert.equal(option.buttonInsideLabel, false, `row ${index} edit button must live outside the radio label`);
                assert.equal(option.labelContainsButton, false, `row ${index} label must not contain the edit button`);
            }
            assertCleanSurface(initial, "the server-rendered list");

            await browser.connection.send("Page.bringToFront", {}, page.sessionId);
            assert.equal(await focusRadio(browser, page.sessionId, 0), true, "the first radio must be focusable");
            await delay(250);
            const focused = await readReview(browser, page.sessionId);
            assert.equal(focused.activeTag, "INPUT", "focus must remain visible on the radio");
            assert.equal(focused.focusedOptionId, alphaId, "focus must stay within the first option");
            assert.equal(focused.focusWithin, true, "focus must be visible through the option focus ring");
            assert.equal(focused.focusedOptionBorderLeft, "rgb(78, 121, 167)", "the focused option must keep its category color bar");
            assert.match(focused.focusedOptionBoxShadow, /rgba\(47, 75, 124, 0\.18\)/, "the focused option must show a visible focus ring");
            assert.deepEqual(focused.options.map(option => option.checked), [false, false], "focusing a radio must not silently select it");

            await pressKey(browser, page.sessionId, " ");
            const afterSpace = await readReview(browser, page.sessionId);
            assert.deepEqual(afterSpace.options.map(option => option.checked), [true, false], "Space must confirm the focused radio");
            assert.deepEqual(afterSpace.options.map(option => option.selectedClass), [true, false], "confirming must refresh the selected-state indicator");
            assert.equal(afterSpace.options[0].indicatorDisplay, "flex", "the selected row must show the check indicator");
            assert.equal(afterSpace.options[0].indicatorText, "Selected", "the selected row must announce the Selected text");
            assert.equal(afterSpace.options[1].indicatorDisplay, "none", "unselected rows must hide the check indicator");
            assert.equal(afterSpace.formValid, true, "the form must become valid once a category is selected");

            await pressKey(browser, page.sessionId, "ArrowDown");
            const afterDown = await readReview(browser, page.sessionId);
            assert.deepEqual(afterDown.options.map(option => option.checked), [false, true], "ArrowDown must move and confirm the next radio");
            assert.deepEqual(afterDown.options.map(option => option.selectedClass), [false, true], "ArrowDown must refresh the selected-state indicator");

            await pressKey(browser, page.sessionId, "ArrowUp");
            const afterUp = await readReview(browser, page.sessionId);
            assert.deepEqual(afterUp.options.map(option => option.checked), [true, false], "ArrowUp must move the selection back");

            const selectedBeforeEdit = afterUp.options.map(option => option.checked);
            assert.equal(await clickEditButton(browser, page.sessionId, betaId), true, "the edit button must be clickable");
            const afterEditClick = await readReview(browser, page.sessionId);
            assert.deepEqual(afterEditClick.options.map(option => option.checked), selectedBeforeEdit, "activating an edit button must never change the selected category");
            assert.equal(afterEditClick.options[1].selectedClass, false, "opening the editor for another row must not mark it selected");
        } finally {
            await closePage(browser, page.targetId);
        }
    } finally {
        await browser.close();
        await closeServer(server);
    }
});

test("Given no categories When the participant creates one Then a hostile definition stays inert text and the new row becomes selected", async () => {
    const chrome = await findChrome();
    const html = await renderReview({card: cardFixture(), categories: []});
    const server = await startFixtureServer(html);
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const browser = await launchBrowser(chrome);
    const hostileName = "<img src=x onerror=\"window.__xss=1\">";
    const hostileDefinition = "<script>window.__xss=2</script> & \"quoted\"";

    try {
        const page = await openPage(browser, `${baseUrl}/queue/${cardId}`, {width: 1280, height: 900});
        try {
            const empty = await readReview(browser, page.sessionId);
            assert.equal(empty.optionCount, 0, "a participant without categories must start with an empty list");
            assert.match(empty.emptyState ?? "", /You have not created any personal categories yet/, "the empty state must point at category creation");

            assert.equal(await submitCategoryForm(browser, page.sessionId, {formId: "new-category-form", name: hostileName, definition: hostileDefinition}), true);
            await waitForExpression(browser, page.sessionId, "document.querySelectorAll('[data-category-option]').length === 1");

            const created = await readReview(browser, page.sessionId);
            assert.equal(created.optionCount, 1, "creating a category must add exactly one selection row");
            assert.equal(created.emptyState, null, "the empty state must disappear after the first category is created");
            assert.deepEqual(created.options.map(option => option.checked), [true], "the newly created category must be selected");
            assert.equal(created.options[0].selectedClass, true, "the new row must carry the selected state");
            assert.equal(created.options[0].indicatorDisplay, "flex", "the new selected row must show the check indicator");
            assert.equal(created.options[0].indicatorText, "Selected", "the new selected row must announce Selected");
            assert.equal(created.options[0].name, hostileName, "hostile names must be inserted as literal text");
            assert.equal(created.options[0].definition, hostileDefinition, "hostile definitions must be inserted as literal text");
            assertPaletteColor(created.options[0], "the JS-created row");
            assert.equal(await evaluate(browser, page.sessionId, "document.querySelectorAll('#category-list script, #category-list img').length"), 0, "hostile markup must not become elements");
            assertCleanSurface(created, "the JS-created row");
        } finally {
            await closePage(browser, page.targetId);
        }
    } finally {
        await browser.close();
        await closeServer(server);
    }
});

test("Given a classified card When a category is edited Then text updates, selection holds and a failed edit preserves the form", async () => {
    const chrome = await findChrome();
    const html = await renderReview({card: cardFixture({categoryId: alphaId, status: "CLASSIFIED", ownCategory: "Alpha"}), categories: [alpha, beta]});
    const server = await startFixtureServer(html, {
        rename: (id, body) => body.name === "Conflict" ? {status: 409, body: {}} : defaultRename(id, body),
    });
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const browser = await launchBrowser(chrome);

    try {
        const page = await openPage(browser, `${baseUrl}/queue/${cardId}`, {width: 1280, height: 900});
        try {
            const initial = await readReview(browser, page.sessionId);
            assert.deepEqual(initial.options.map(option => option.checked), [true, false], "the saved classification must preselect its category");
            assert.equal(initial.options[0].selectedClass, true, "the saved selection must render the Selected state");

            await clickEditButton(browser, page.sessionId, betaId);
            const populated = await evaluate(browser, page.sessionId, "JSON.stringify({name: document.getElementById('rename-category-name').value, definition: document.getElementById('rename-category-definition').value})");
            assert.deepEqual(JSON.parse(populated), {name: "Beta", definition: ""}, "opening the editor must populate the name and a safe empty definition");
            const afterOpen = await readReview(browser, page.sessionId);
            assert.deepEqual(afterOpen.options.map(option => option.checked), [true, false], "opening the editor must not change the selection");

            await submitCategoryForm(browser, page.sessionId, {formId: "rename-category-form", name: "Beta renamed", definition: "Beta definition new"});
            await waitForExpression(browser, page.sessionId, "document.querySelector('[data-category-option=\"" + betaId + "\"] .category-name').textContent.trim() === 'Beta renamed'");

            const renamed = await readReview(browser, page.sessionId);
            assert.equal(renamed.options[1].name, "Beta renamed", "editing must update the row name through textContent");
            assert.equal(renamed.options[1].definition, "Beta definition new", "editing must update the row definition");
            assert.equal(renamed.options[1].rowSlot, "category-slot-1", "editing must keep the stable palette slot on the row");
            assert.deepEqual(renamed.options.map(option => option.checked), [true, false], "editing a category must not change the selection");
            assertPaletteColor(renamed.options[1], "the edited row");
            assertCleanSurface(renamed, "the edited row");

            await clickEditButton(browser, page.sessionId, alphaId);
            await submitCategoryForm(browser, page.sessionId, {formId: "rename-category-form", name: "Conflict", definition: "Alpha preserved"});
            await waitForExpression(browser, page.sessionId, "!document.getElementById('rename-category-error').classList.contains('d-none')");

            const failed = await evaluate(browser, page.sessionId, "JSON.stringify({name: document.getElementById('rename-category-name').value, definition: document.getElementById('rename-category-definition').value, errorHidden: document.getElementById('rename-category-error').classList.contains('d-none')})");
            const failedState = JSON.parse(failed);
            assert.equal(failedState.errorHidden, false, "a failed edit must surface the existing error message");
            assert.equal(failedState.name, "Conflict", "a failed edit must preserve the attempted name");
            assert.equal(failedState.definition, "Alpha preserved", "a failed edit must preserve the attempted definition");
            const afterFailure = await readReview(browser, page.sessionId);
            assert.equal(afterFailure.options[0].name, "Alpha", "a failed edit must not rewrite the row");
            assert.deepEqual(afterFailure.options.map(option => option.checked), [true, false], "a failed edit must not change the selection");
            assertCleanSurface(afterFailure, "the failed edit surface");
        } finally {
            await closePage(browser, page.targetId);
        }
    } finally {
        await browser.close();
        await closeServer(server);
    }
});

test("Given the integrated category card When Chromium renders it Then the layout holds at 375, 768 and 1280px", async () => {
    const chrome = await findChrome();
    const html = await renderReview({card: cardFixture({categoryId: alphaId, status: "CLASSIFIED", ownCategory: "Alpha"}), categories: [alpha, beta]});
    const server = await startFixtureServer(html);
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const browser = await launchBrowser(chrome);

    try {
        for (const viewport of [375, 768, 1280]) {
            const page = await openPage(browser, `${baseUrl}/queue/${cardId}`, {width: viewport, height: 900});
            try {
                const layout = await readReview(browser, page.sessionId);
                assert.equal(layout.viewportWidth, viewport, `${viewport}px review must render in a real CSS viewport`);
                assert.equal(layout.cardPresent, true, `${viewport}px review must render the PR card`);
                assert.equal(layout.hasList, true, `${viewport}px review must render the category list`);
                assert.equal(layout.optionCount, 2, `${viewport}px review must render both categories`);
                assert.equal(layout.overflow, false, `${viewport}px the review page must not overflow horizontally`);
                assert.equal(layout.options[0].indicatorDisplay, "flex", `${viewport}px the selected row must stay distinguishable`);
                for (const [index, option] of layout.options.entries()) {
                    assertPaletteColor(option, `${viewport}px row ${index}`);
                }
                assertCleanSurface(layout, `${viewport}px review`);
            } finally {
                await closePage(browser, page.targetId);
            }
        }
    } finally {
        await browser.close();
        await closeServer(server);
    }
});
