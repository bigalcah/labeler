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

class BrowserSecurityPool {
    constructor() {
        this.contexts = new Map();
        this.ipAttempts = 0;
    }

    async query(sql, parameters = []) {
        if (sql.startsWith("INSERT INTO login_csrf_context")) {
            this.contexts.set(parameters[0], {token: parameters[1], expires_at: parameters[2]});
            return {rows: []};
        }
        if (sql.startsWith("SELECT token, expires_at FROM login_csrf_context")) {
            const context = this.contexts.get(parameters[0]);
            return {rows: context ? [context] : []};
        }
        if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) return {rows: []};
        if (sql.startsWith("INSERT INTO login_ip_attempt")) {
            this.ipAttempts += 1;
            return {rows: [{attempt_count: this.ipAttempts, window_started_at: new Date("2026-01-01T00:00:00.000Z")} ]};
        }
        if (sql.includes("FROM participant_account account")) return {rows: []};
        throw new Error(`Unexpected pool query: ${sql}`);
    }

    async connect() {
        return {
            query: (sql, parameters) => this.query(sql, parameters),
            release: () => {},
        };
    }
}

const browserLayoutProbe = `
const control = selector => document.querySelector(selector);
const rect = element => {
    if (!element) return null;
    const {top, right, bottom, left, width, height} = element.getBoundingClientRect();
    return {top, right, bottom, left, width, height};
};
const error = control("#login-error");
const form = control("#login-form");
const username = control("#username");
const password = control("#password");
const submit = control('#login-form button[type="submit"]');
const main = control("main");
const cards = [...document.querySelectorAll("main .card")];
const links = selector => [...document.querySelectorAll(selector)].map(link => link.getAttribute("href"));
const result = {
    viewportWidth: window.innerWidth,
    hasHorizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
    main: rect(main),
    cardCount: cards.length,
    card: rect(cards[0]),
    cardContainsForm: cards[0]?.contains(form) === true,
    alert: error ? {role: error.getAttribute("role"), text: error.textContent.trim(), ...rect(error)} : null,
    alertBeforeForm: error ? Boolean(error.compareDocumentPosition(form) & Node.DOCUMENT_POSITION_FOLLOWING) : false,
    headerCount: document.querySelectorAll("header").length,
    privateNavigationLinks: links('a[href="/queue"], a[href="/progress"]'),
    logoutActionCount: document.querySelectorAll('form[action="/logout"]').length,
    form: {ariaDescribedBy: form.getAttribute("aria-describedby"), ...rect(form)},
    formSemantics: {
        action: form.getAttribute("action"),
        method: form.getAttribute("method"),
        autocomplete: form.getAttribute("autocomplete"),
        usernameAutocomplete: username.getAttribute("autocomplete"),
        passwordAutocomplete: password.getAttribute("autocomplete"),
        hasCsrfToken: control('input[type="hidden"][name="csrf_token"]') !== null,
    },
    bootstrapGridEnabled: getComputedStyle(form).display === "flex",
    labels: {
        username: username.labels.length === 1 && username.labels[0].htmlFor === username.id,
        password: password.labels.length === 1 && password.labels[0].htmlFor === password.id,
    },
    controls: {
        usernameInputGroup: rect(username.closest(".input-group")),
        password: rect(password),
        submit: rect(submit),
    },
};
requestAnimationFrame(() => requestAnimationFrame(() => {
    const output = document.createElement("output");
    output.id = "login-layout-probe";
    output.textContent = JSON.stringify(result);
    document.body.append(output);
}));
`;

const browserLoginProbeMiddleware = (req, res, next) => {
    if (req.path === "/browser-login-submit") {
        res.type("html").send(`
            <form action="/login" method="post">
                <input name="username" value="participant-a">
                <input name="password" type="password" value="wrong-password">
                <input name="csrf_token" value="${"a".repeat(43)}">
            </form>
            <script src="/browser-login-submit.js"></script>
        `);
        return;
    }
    if (req.path === "/browser-login-submit.js") {
        res.type("application/javascript").send("document.forms[0].submit();");
        return;
    }
    if (req.path === "/browser-layout-probe.js") {
        res.type("application/javascript").send(browserLayoutProbe);
        return;
    }
    const render = res.render.bind(res);
    res.render = (view, options) => render(view, options, (error, html) => {
        if (error) return next(error);
        return res.send(html.replace("</body>", "<script src=\"/browser-layout-probe.js\"></script></body>"));
    });
    next();
};

const startServer = async () => {
    const app = await createApp({
        pool: new BrowserSecurityPool(),
        sessionMiddleware: (_req, _res, next) => next(),
        passwordVerifier: async () => false,
        csrf: {
            createCsrfToken: () => "a".repeat(43),
            validateLoginCsrfToken: async () => true,
        },
        middleware: [browserLoginProbeMiddleware],
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
    "--enable-logging=stderr",
    "--no-first-run",
    "--virtual-time-budget=1000",
    "--dump-dom",
    ...arguments_,
], {maxBuffer: 1024 * 1024});

const readLayoutProbe = stdout => {
    const match = stdout.match(/<output id="login-layout-probe">([^<]+)<\/output>/);
    assert.ok(match, "The browser layout probe did not report a rendered login error state");
    return JSON.parse(match[1]);
};

const assertVerticalControlOrder = ({viewport, controls}) => {
    assert.ok(controls.usernameInputGroup.top < controls.password.top, `${viewport}px username must be above password`);
    assert.ok(controls.usernameInputGroup.bottom <= controls.password.top, `${viewport}px username must not overlap password`);
    assert.ok(controls.password.top < controls.submit.top, `${viewport}px password must be above submit`);
    assert.ok(controls.password.bottom <= controls.submit.top, `${viewport}px password must not overlap submit`);
};

const assertCenteredCard = ({viewport, viewportWidth, main, card}) => {
    const centerTolerancePx = 16;
    assert.ok(card, `${viewport}px login must render a card`);
    assert.ok(Math.abs((card.left + card.right) / 2 - viewportWidth / 2) <= centerTolerancePx,
        `${viewport}px login card must be horizontally centered`);
    assert.ok(Math.abs((card.top + card.bottom) / 2 - (main.top + main.bottom) / 2) <= centerTolerancePx,
        `${viewport}px login card must be vertically centered within main`);
};

const assertEqualControlWidths = ({viewport, controls}) => {
    const widthTolerancePx = 1;
    const widths = [controls.usernameInputGroup.width, controls.password.width, controls.submit.width];
    assert.ok(widths.every(width => Math.abs(width - widths[0]) <= widthTolerancePx),
        `${viewport}px username, password, and Start! must have equal rendered widths`);
};

test("browser loads the login page without CSP violations", async () => {
    const chrome = await findChrome();
    const server = await startServer();
    const url = `http://127.0.0.1:${server.address().port}/login`;

    try {
        const {stdout, stderr} = await runBrowser(chrome, [url]);

        assert.match(stdout, /<h1[^>]*>Login<\/h1>/);
        assert.doesNotMatch(stderr, /Content Security Policy|Refused to .*violat/i);
    } finally {
        await closeServer(server);
    }
});

test("Given an anonymous GET login When Chromium renders the default state Then the public card is centered and semantic", async () => {
    const chrome = await findChrome();
    const server = await startServer();
    const url = `http://127.0.0.1:${server.address().port}/login`;

    try {
        for (const viewport of [375, 768, 1280]) {
            const {stdout} = await runBrowser(chrome, [`--window-size=${viewport},800`, url]);
            const layout = readLayoutProbe(stdout);

            assert.equal(layout.headerCount, 0, `${viewport}px anonymous login must not render a header`);
            assert.deepEqual(layout.privateNavigationLinks, [], `${viewport}px anonymous login must not render private navigation`);
            assert.equal(layout.logoutActionCount, 0, `${viewport}px anonymous login must not render logout`);
            assert.equal(layout.hasHorizontalOverflow, false, `${viewport}px login must not overflow horizontally`);
            assert.equal(layout.cardCount, 1, `${viewport}px login must render exactly one card`);
            assert.equal(layout.cardContainsForm, true, `${viewport}px login card must contain the form`);
            assertCenteredCard({viewport, viewportWidth: layout.viewportWidth, main: layout.main, card: layout.card});
            assertEqualControlWidths({viewport, controls: layout.controls});
            assert.equal(layout.alert, null, `${viewport}px default login must not render an alert`);
            assert.equal(layout.alertBeforeForm, false, `${viewport}px default login must not reserve an alert position`);
            assert.equal(layout.form.ariaDescribedBy, "");
            assert.deepEqual(layout.formSemantics, {
                action: "/login",
                method: "post",
                autocomplete: "on",
                usernameAutocomplete: "username",
                passwordAutocomplete: "current-password",
                hasCsrfToken: true,
            });
            assert.equal(layout.labels.username, true);
            assert.equal(layout.labels.password, true);
            assert.equal(layout.bootstrapGridEnabled, true, `${viewport}px requires the Bootstrap grid stylesheet`);
            assertVerticalControlOrder({viewport, controls: layout.controls});
        }
    } finally {
        await closeServer(server);
    }
});

test("Given invalid login credentials When the browser renders the error Then the public Bootstrap card remains centered and accessible", async () => {
    const chrome = await findChrome();
    const server = await startServer();
    const url = `http://127.0.0.1:${server.address().port}/browser-login-submit`;

    try {
        for (const viewport of [375, 768, 1280]) {
            const {stdout} = await runBrowser(chrome, [`--window-size=${viewport},800`, url]);
            const layout = readLayoutProbe(stdout);

            assert.equal(layout.hasHorizontalOverflow, false, `${viewport}px login must not overflow horizontally`);
            assert.equal(layout.cardCount, 1, `${viewport}px login must render exactly one card`);
            assert.equal(layout.cardContainsForm, true, `${viewport}px login card must contain the form`);
            assertCenteredCard({viewport, viewportWidth: layout.viewportWidth, main: layout.main, card: layout.card});
            assertEqualControlWidths({viewport, controls: layout.controls});
            assert.equal(layout.alert.role, "alert");
            assert.match(layout.alert.text, /Invalid username or password\./);
            assert.equal(layout.alertBeforeForm, true);
            assert.ok(layout.alert.bottom <= layout.form.top, `${viewport}px alert must render above the form`);
            assert.equal(layout.form.ariaDescribedBy, "login-error");
            assert.equal(layout.labels.username, true);
            assert.equal(layout.labels.password, true);
            assert.equal(layout.bootstrapGridEnabled, true, `${viewport}px requires the Bootstrap grid stylesheet`);
            assertVerticalControlOrder({viewport, controls: layout.controls});
        }
    } finally {
        await closeServer(server);
    }
});
