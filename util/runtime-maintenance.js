const LOGIN_IP_ATTEMPT_WINDOW = "15 minutes";

const cleanupQueries = Object.freeze([
    `DELETE FROM login_csrf_context
     WHERE expires_at <= $1`,
    `DELETE FROM login_ip_attempt
     WHERE window_started_at <= $1 - INTERVAL '${LOGIN_IP_ATTEMPT_WINDOW}'`,
    `DELETE FROM app_session
     WHERE expires_at <= $1`,
]);

const reportFailure = (reporter, resource) => {
    reporter(`Unable to close ${resource} during shutdown`);
};

const closeWithCallback = (resource, method) => new Promise((resolve, reject) => {
    resource[method](error => error ? reject(error) : resolve());
});

const closeResource = async ({resource, method, name, reporter}) => {
    if (!resource || typeof resource[method] !== "function") return;
    try {
        if (method === "end" && name === "PostgreSQL pool") await resource.end();
        else await closeWithCallback(resource, method);
    } catch (_error) {
        reportFailure(reporter, name);
    }
};

const runExpiredAuthenticationCleanup = async ({pool, now = new Date()} = {}) => {
    if (!pool || typeof pool.query !== "function") return false;
    for (const query of cleanupQueries) await pool.query(query, [ now ]);
    return true;
};

const startExpiredAuthenticationCleanup = ({
    pool,
    intervalMs = 60 * 60 * 1000,
    setIntervalFn = setInterval,
    reporter = () => {},
} = {}) => {
    if (!pool || typeof pool.query !== "function") return null;
    const interval = setIntervalFn(() => {
        void runExpiredAuthenticationCleanup({pool}).catch(_error => {
            reporter("Authentication cleanup failed");
        });
    }, intervalMs);
    interval.unref?.();
    return () => clearInterval(interval);
};

const createGracefulShutdown = ({
    server,
    pool,
    logStream,
    stopCleanup,
    reporter = message => process.stderr.write(`${message}\n`),
} = {}) => {
    let shutdownPromise;
    return () => {
        if (shutdownPromise) return shutdownPromise;
        shutdownPromise = (async () => {
            if (typeof stopCleanup === "function") stopCleanup();
            await closeResource({resource: server, method: "close", name: "HTTP server", reporter});
            await closeResource({resource: pool, method: "end", name: "PostgreSQL pool", reporter});
            await closeResource({resource: logStream, method: "end", name: "log stream", reporter});
        })();
        return shutdownPromise;
    };
};

const installShutdownHandlers = ({
    shutdown,
    processRef = process,
    signals = [ "SIGTERM", "SIGINT" ],
} = {}) => {
    if (typeof shutdown !== "function") return () => {};
    const handler = () => {
        void shutdown();
    };
    signals.forEach(signal => processRef.once(signal, handler));
    return () => signals.forEach(signal => processRef.removeListener(signal, handler));
};

export {
    cleanupQueries,
    createGracefulShutdown,
    installShutdownHandlers,
    runExpiredAuthenticationCleanup,
    startExpiredAuthenticationCleanup,
};
