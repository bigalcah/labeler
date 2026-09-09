import * as fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "url";
import {config} from "dotenv";
import {createStream as createRotatingFileStream} from "rotating-file-stream";
import morgan from "morgan";
import * as ip from "neoip";
import {createApp} from "./app.js";
import {redactRequestLog} from "./util/log-redaction.js";
import {ProductionConfigError, readProductionConfig} from "./util/production-config.js";
import {createGracefulShutdown, installShutdownHandlers, startExpiredAuthenticationCleanup} from "./util/runtime-maintenance.js";

config();

const nodeEnv = process.env.NODE_ENV || "development";
let sessionPolicy;
try {
    sessionPolicy = readProductionConfig(process.env);
} catch (error) {
    if (error instanceof ProductionConfigError) {
        console.error(error.message);
        process.exitCode = 1;
    } else {
        throw error;
    }
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const formatRequestLog = (tokens, req, res) => redactRequestLog([
    tokens.method(req, res),
    tokens.url(req, res),
    tokens.status(req, res),
    tokens.res(req, res, "content-length") || "-",
    `${tokens["response-time"](req, res)}ms`,
].join(" "));
let server;
if (process.exitCode !== 1) {
    const logsDirectory = path.join(__dirname, "logs");
    if (!fs.existsSync(logsDirectory)) fs.mkdirSync(logsDirectory, {recursive: true});
    const port = process.env.PORT || 3000;
    const {default: pool} = await import("./util/pg-pool.js");
    const logger = morgan(formatRequestLog);
    const logStream = createRotatingFileStream(
        (time, i) => time ? `server.${time.toISOString().split("T")[0]}.${i}.log.gz` : "server.log",
        {
            path: logsDirectory,
            size: "100M",
            interval: "1d",
            compress: "gzip",
        },
    );
    const fileLogger = morgan(formatRequestLog, {
        stream: logStream,
        skip: (req, _) => {
            switch (req.connection.remoteAddress) {
            case "::1":
            case "::ffff:127.0.0.1":
                return true;
            default:
                return false;
            }
        }
    });
    const app = await createApp({pool, sessionPolicy, logger: (req, res, next) => {
        logger(req, res, () => fileLogger(req, res, next));
    }});

    server = app.listen(port, () => {
        if (nodeEnv === "development") console.debug(`
 App listening on:
 * http://localhost:${port}
 * http://${ip.address()}:${port}
        `);
    });
    const stopCleanup = startExpiredAuthenticationCleanup({pool});
    const shutdown = createGracefulShutdown({server, pool, logStream, stopCleanup});
    installShutdownHandlers({shutdown});
}

export default server;
