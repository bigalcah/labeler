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
const rect = selector => {
    const {top, bottom} = control(selector).getBoundingClientRect();
    return {top, bottom};
};
const error = control("#login-error");
const form = control("#login-form");
const username = control("#username");
const password = control("#password");
const submit = control('#login-form button[type="submit"]');
const result = {
    alert: {role: error.getAttribute("role"), text: error.textContent.trim(), ...rect("#login-error")},
    alertBeforeForm: Boolean(error.compareDocumentPosition(form) & Node.DOCUMENT_POSITION_FOLLOWING),
    form: {ariaDescribedBy: form.getAttribute("aria-describedby"), ...rect("#login-form")},
    bootstrapGridEnabled: getComputedStyle(form).display === "flex",
    labels: {
        username: username.labels.length === 1 && username.labels[0].htmlFor === username.id,
        password: password.labels.length === 1 && password.labels[0].htmlFor === password.id,
    },
    controls: {
        username: rect("#username"),
        password: rect("#password"),
        submit: rect('#login-form button[type="submit"]'),
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
    assert.ok(controls.username.top < controls.password.top, `${viewport}px username must be above password`);
    assert.ok(controls.username.bottom <= controls.password.top, `${viewport}px username must not overlap password`);
    assert.ok(controls.password.top < controls.submit.top, `${viewport}px password must be above submit`);
    assert.ok(controls.password.bottom <= controls.submit.top, `${viewport}px password must not overlap submit`);
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

test("Given invalid login credentials When the browser renders the error Then controls remain vertically ordered at narrow and wide viewports", async () => {
    const chrome = await findChrome();
    const server = await startServer();
    const url = `http://127.0.0.1:${server.address().port}/browser-login-submit`;

    try {
        for (const viewport of [375, 1280]) {
            const {stdout} = await runBrowser(chrome, [`--window-size=${viewport},800`, url]);
            const layout = readLayoutProbe(stdout);

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
