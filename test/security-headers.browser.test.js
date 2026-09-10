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
        throw new Error(`Unexpected pool query: ${sql}`);
    }
}

const startServer = async () => {
    const app = await createApp({
        pool: new BrowserSecurityPool(),
        sessionMiddleware: (_req, _res, next) => next(),
        csrf: {createCsrfToken: () => "a".repeat(43)},
    });
    const server = app.listen(0);
    await once(server, "listening");
    return server;
};

const closeServer = server => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));

test("browser loads the login page without CSP violations", async () => {
    let chrome = null;
    for (const candidate of chromeCandidates) {
        try {
            await access(candidate);
            chrome = candidate;
            break;
        } catch (_error) {
            continue;
        }
    }
    if (!chrome) throw new Error("A Chrome or Chromium executable is required; set CHROME_BIN to run the browser regression");
    const server = await startServer();
    const url = `http://127.0.0.1:${server.address().port}/login`;

    try {
        const {stdout, stderr} = await executeFile(chrome, [
            "--headless=new",
            "--disable-background-networking",
            "--disable-default-apps",
            "--disable-extensions",
            "--enable-logging=stderr",
            "--no-first-run",
            "--virtual-time-budget=500",
            "--dump-dom",
            url,
        ], {maxBuffer: 1024 * 1024});

        assert.match(stdout, /<h1[^>]*>Login<\/h1>/);
        assert.doesNotMatch(stderr, /Content Security Policy|Refused to .*violat/i);
    } finally {
        await closeServer(server);
    }
});
