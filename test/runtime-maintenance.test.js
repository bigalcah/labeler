import assert from "node:assert/strict";
import test from "node:test";
import {
    cleanupQueries,
    createGracefulShutdown,
    installShutdownHandlers,
    runExpiredAuthenticationCleanup,
    startExpiredAuthenticationCleanup,
} from "../util/runtime-maintenance.js";

test("expired authentication cleanup uses restrictive expiry predicates with one timestamp", async () => {
    const queries = [];
    const now = new Date("2026-01-01T12:00:00.000Z");
    const pool = {
        query: async (sql, parameters) => queries.push({sql, parameters}),
    };

    assert.equal(await runExpiredAuthenticationCleanup({pool, now}), true);
    assert.deepEqual(queries.map(({sql}) => sql), cleanupQueries);
    assert.equal(queries.every(({parameters}) => parameters[0] === now), true);
    assert.match(cleanupQueries[0], /WHERE expires_at <= \$1/);
    assert.match(cleanupQueries[1], /WHERE window_started_at <= \$1 - INTERVAL '15 minutes'/);
    assert.match(cleanupQueries[2], /WHERE expires_at <= \$1/);
    assert.equal(cleanupQueries.every(sql => /WHERE/.test(sql)), true);
});

test("cleanup does not run or schedule work without a queryable pool", async () => {
    let scheduled = false;
    assert.equal(await runExpiredAuthenticationCleanup(), false);
    assert.equal(startExpiredAuthenticationCleanup({
        setIntervalFn: () => {
            scheduled = true;
        },
    }), null);
    assert.equal(scheduled, false);
});

test("scheduled cleanup is unref'd and reports generic failures", async () => {
    let callback;
    let unrefCalled = false;
    let cleared;
    const reports = [];
    const interval = {
        unref: () => {
            unrefCalled = true;
        },
    };
    const stop = startExpiredAuthenticationCleanup({
        pool: {query: async () => {
            throw new Error("session-secret-value");
        }},
        setIntervalFn: handler => {
            callback = handler;
            return interval;
        },
        reporter: message => reports.push(message),
    });

    callback();
    await new Promise(resolve => setImmediate(resolve));
    stop();
    assert.equal(unrefCalled, true);
    assert.equal(cleared, undefined);
    assert.deepEqual(reports, [ "Authentication cleanup failed" ]);
});

test("graceful shutdown is idempotent and closes every resource after errors", async () => {
    const calls = [];
    const reports = [];
    const shutdown = createGracefulShutdown({
        server: {close: callback => {
            calls.push("server");
            callback(new Error("server-secret"));
        }},
        pool: {end: async () => {
            calls.push("pool");
            throw new Error("pool-secret");
        }},
        logStream: {end: callback => {
            calls.push("logs");
            callback(new Error("log-secret"));
        }},
        stopCleanup: () => calls.push("stop"),
        reporter: message => reports.push(message),
    });

    await Promise.all([ shutdown(), shutdown() ]);
    assert.deepEqual(calls, [ "stop", "server", "pool", "logs" ]);
    assert.deepEqual(reports, [
        "Unable to close HTTP server during shutdown",
        "Unable to close PostgreSQL pool during shutdown",
        "Unable to close log stream during shutdown",
    ]);
});

test("SIGTERM and SIGINT use the shared shutdown handler", async () => {
    const handlers = new Map();
    const processRef = {
        once: (signal, handler) => handlers.set(signal, handler),
        removeListener: signal => handlers.delete(signal),
    };
    let shutdownCalls = 0;
    const uninstall = installShutdownHandlers({
        shutdown: () => {
            shutdownCalls += 1;
            return Promise.resolve();
        },
        processRef,
    });

    handlers.get("SIGTERM")();
    handlers.get("SIGINT")();
    uninstall();
    assert.equal(shutdownCalls, 2);
    assert.equal(handlers.size, 0);
});
