import * as fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "url";
import {config} from "dotenv";
import {createStream as createRotatingFileStream} from "rotating-file-stream";
import morgan from "morgan";
import * as ip from "neoip";
import {createApp} from "./app.js";
import {ProductionConfigError, readProductionConfig} from "./util/production-config.js";

config();

const nodeEnv = process.env.NODE_ENV || "development";
try {
    readProductionConfig(process.env);
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
let server;
if (process.exitCode !== 1) {
    const logsDirectory = path.join(__dirname, "logs");
    if (!fs.existsSync(logsDirectory)) fs.mkdirSync(logsDirectory, {recursive: true});
    const port = process.env.PORT || 3000;
    const {default: pool} = await import("./util/pg-pool.js");
    const logger = morgan(nodeEnv === "development" ? "dev" : "common");
    const fileLogger = morgan("combined", {
        stream: createRotatingFileStream(
            (time, i) => time ? `server.${time.toISOString().split("T")[0]}.${i}.log.gz` : "server.log",
            {
                path: logsDirectory,
                size: "100M",
                interval: "1d",
                compress: "gzip",
            },
        ),
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
    const app = await createApp({pool, logger: (req, res, next) => {
        logger(req, res, () => fileLogger(req, res, next));
    }});

    server = app.listen(port, () => {
        if (nodeEnv === "development") console.debug(`
 App listening on:
 * http://localhost:${port}
 * http://${ip.address()}:${port}
  `);
    });
}

export default server;
