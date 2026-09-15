import assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {once} from "node:events";
import {access} from "node:fs/promises";
import test from "node:test";
import {promisify} from "node:util";
import {createApp} from "../app.js";

const executeFile = promisify(execFile);
const chromeCandidates = [
    process.env.CHROME_BIN,
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
].filter(Boolean);
const authenticatedContext = Object.freeze({
    accountId: "account-1",
    studyId: "study-1",
    participantId: 12,
    participantKey: "participant-a",
});

class HomePool {
    async query(sql) {
        throw new Error(`Unexpected pool query: ${sql}`);
    }
}

const browserHomeProbe = `
const visible = element => {
    const style = getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden" && element.getClientRects().length > 0;
};
const links = selector => [...document.querySelectorAll(selector)].map(link => link.getAttribute("href"));
const visibleText = text => [...document.querySelectorAll("main p")]
    .some(paragraph => paragraph.textContent.trim().includes(text) && visible(paragraph));
const progressPhrase = [...document.querySelectorAll("main *")]
    .find(element => element.textContent.trim() === "track your progress." && visible(element));
const result = {
    viewportWidth: window.innerWidth,
    hasHorizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
    anonymous: {
        welcomeVisible: [...document.querySelectorAll("main")]
            .some(main => /welcome/i.test(main.textContent) && visible(main)),
        loginVisible: [...document.querySelectorAll('a[href="/login"]')].some(visible),
        categoryConceptVisible: visibleText("classifying pull requests into categories created by each participant."),
        privacyConceptVisible: visibleText("Your work is private to you."),
        startConceptVisible: visibleText("Log in to begin reviewing PR cards"),
        progressPhraseNoWrap: progressPhrase?.classList.contains("text-nowrap") === true,
        headerCount: document.querySelectorAll("header").length,
        privateNavigationLinks: links('header a[href="/queue"], header a[href="/progress"]'),
        privateActionLinks: links('main a[href="/queue"], main a[href="/progress"]'),
    },
    authenticated: {
        headerCount: document.querySelectorAll("header").length,
        identityEmitted: [...document.querySelectorAll("header *")]
            .some(element => element.textContent.trim() === "participant-a"),
        privateNavigationLinks: links('header a[href="/queue"], header a[href="/progress"]'),
        privateActionLinks: links('main a[href="/queue"], main a[href="/progress"]'),
        loginLinks: links('a[href="/login"]'),
    },
};
setTimeout(() => {
    const output = document.createElement("output");
    output.id = "home-login-probe";
    output.textContent = JSON.stringify(result);
    document.body.append(output);
}, 50);
`;

const createFixtureSessionMiddleware = sessionContext => (req, res, next) => {
    req.sessionContext = sessionContext;
    res.locals.sessionContext = sessionContext;
    res.locals.csrfToken = sessionContext ? "fixture-csrf-token" : null;
    next();
};

const browserHomeProbeMiddleware = (req, res, next) => {
    if (req.path === "/browser-home-probe.js") {
        res.type("application/javascript").send(browserHomeProbe);
        return;
    }
    const render = res.render.bind(res);
    res.render = (view, options) => render(view, options, (error, html) => {
        if (error) return next(error);
        return res.send(html.replace("</body>", "<script src=\"/browser-home-probe.js\"></script></body>"));
    });
    next();
};

const startServer = async sessionContext => {
    const app = await createApp({
        pool: new HomePool(),
        sessionMiddleware: createFixtureSessionMiddleware(sessionContext),
        middleware: [browserHomeProbeMiddleware],
    });
    const server = app.listen(0);
    await once(server, "listening");
    return server;
};

const closeServer = server => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));

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

const runBrowser = (chrome, arguments_) => executeFile(chrome, [
    "--headless=new",
    "--disable-background-networking",
    "--disable-default-apps",
    "--disable-extensions",
    "--no-first-run",
    "--virtual-time-budget=1000",
    "--dump-dom",
    ...arguments_,
], {maxBuffer: 1024 * 1024});

const readHomeProbe = stdout => {
    const match = stdout.match(/<output id="home-login-probe">([^<]+)<\/output>/);
    assert.ok(match, "The browser Home probe did not report rendered page state");
    return JSON.parse(match[1]);
};

const viewportWidths = [375, 768, 1280];

const assertNoHorizontalOverflow = ({layout, viewport}) => {
    assert.equal(layout.hasHorizontalOverflow, false, `Home must not overflow horizontally at ${viewport}px`);
};

test("Given an anonymous server session When Chromium renders Home Then only the welcome and Login entry point are emitted", async () => {
    const chrome = await findChrome();
    const server = await startServer(null);
    const url = `http://127.0.0.1:${server.address().port}/`;

    try {
        for (const viewport of viewportWidths) {
            const {stdout} = await runBrowser(chrome, [`--window-size=${viewport},800`, url]);
            const layout = readHomeProbe(stdout);

            assert.equal(layout.anonymous.headerCount, 0, `${viewport}px anonymous Home must not emit a header`);
            assert.deepEqual(layout.anonymous.privateNavigationLinks, [], `${viewport}px anonymous Home must not emit private navigation`);
            assert.deepEqual(layout.anonymous.privateActionLinks, [], `${viewport}px anonymous Home must not emit private action cards`);
            assert.equal(layout.anonymous.welcomeVisible, true, `${viewport}px anonymous Home must show a welcome`);
            assert.equal(layout.anonymous.loginVisible, true, `${viewport}px anonymous Home must show Login`);
            assert.equal(layout.anonymous.categoryConceptVisible, true, `${viewport}px anonymous Home must explain participant-created categories`);
            assert.equal(layout.anonymous.privacyConceptVisible, true, `${viewport}px anonymous Home must explain that work is private`);
            assert.equal(layout.anonymous.startConceptVisible, true, `${viewport}px anonymous Home must direct visitors to begin reviewing PR cards`);
            assert.equal(layout.anonymous.progressPhraseNoWrap, true, `${viewport}px anonymous Home must keep "track your progress." together`);
            assertNoHorizontalOverflow({layout, viewport});
        }
    } finally {
        await closeServer(server);
    }
});

test("Given an authenticated server session When Chromium renders Home Then identity and private actions are emitted without Login", async () => {
    const chrome = await findChrome();
    const server = await startServer(authenticatedContext);
    const url = `http://127.0.0.1:${server.address().port}/`;

    try {
        for (const viewport of viewportWidths) {
            const {stdout} = await runBrowser(chrome, [`--window-size=${viewport},800`, url]);
            const layout = readHomeProbe(stdout);

            assert.equal(layout.authenticated.headerCount, 1, `${viewport}px authenticated Home must emit its header`);
            assert.equal(layout.authenticated.identityEmitted, true, `${viewport}px authenticated Home must emit participant-a`);
            assert.deepEqual(layout.authenticated.privateNavigationLinks, ["/queue", "/progress"], `${viewport}px authenticated Home must emit private navigation`);
            assert.deepEqual(layout.authenticated.privateActionLinks, ["/queue", "/queue", "/progress"], `${viewport}px authenticated Home must emit private action cards`);
            assert.deepEqual(layout.authenticated.loginLinks, [], `${viewport}px authenticated Home must not emit Login`);
            assertNoHorizontalOverflow({layout, viewport});
        }
    } finally {
        await closeServer(server);
    }
});
