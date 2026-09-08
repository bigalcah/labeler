import compression from "compression";
import express from "express";
import paginate from "express-paginate";
import actuator from "express-actuator";
import minifyHTML from "express-minify-html-2";
import {minify as minifyJS} from "uglify-js";
import bodyParser from "body-parser";
import {router} from "express-file-routing";
import {fileURLToPath} from "url";
import path from "node:path";
import {parse as parseUserAgent} from "useragent";
import HTTPStatus from "./util/http-status.js";
import {renderSafeMarkdown} from "./util/safe-markdown.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const noopMiddleware = (_req, _res, next) => next();
const asyncHandler = handler => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
const wrapAsyncRoutes = fileRouter => {
    fileRouter.stack.forEach(layer => {
        if (!layer.route) return;
        layer.route.stack.forEach(routeLayer => {
            routeLayer.handle = asyncHandler(routeLayer.handle);
        });
    });
    return fileRouter;
};

export const createApp = async ({
    pool,
    sessionMiddleware = noopMiddleware,
    clock = () => new Date(),
    logger = noopMiddleware,
    middleware = [],
    nodeEnv = process.env.NODE_ENV || "development",
} = {}) => {
    const app = express();

    app.locals.pool = pool;
    app.locals.sessionMiddleware = sessionMiddleware;
    app.locals.clock = clock;
    app.locals.logger = logger;
    app.locals.dependencies = {pool, sessionMiddleware, clock, logger};

    app.use(logger);
    app.use(sessionMiddleware);
    app.set("views", path.join(__dirname, "views"));
    app.set("view engine", "ejs");

    app.use("/", express.static(path.join(__dirname, "public")));
    app.use(bodyParser.json());
    app.use(bodyParser.urlencoded({extended: true}));
    app.use(paginate.middleware(10, 50));
    app.use((req, res, next) => {
        res.locals.path = req.baseUrl + req.path;
        const userAgent = req.headers["user-agent"];
        res.locals.os = parseUserAgent(userAgent).os.family;
        res.locals.renderSafeMarkdown = renderSafeMarkdown;
        next();
    });
    app.use(
        minifyHTML({
            override: true,
            exceptionUrls: false,
            htmlMinifier: {
                removeComments: true,
                collapseWhitespace: true,
                collapseBooleanAttributes: true,
                removeAttributeQuotes: true,
                removeEmptyAttributes: true,
            }
        })
    );
    app.use((req, res, next) => {
        const originalSend = res.send;
        res.send = function (body) {
            if (typeof body === "string") {
                const minified = body.replace(
                    /<script>([\s\S]*?)<\/script>/gi,
                    (match, content) => `<script>${(minifyJS(content).code)}</script>`
                );
                originalSend.call(this, minified);
            } else {
                originalSend.call(this, body);
            }
        };
        next();
    });
    app.use(compression());
    app.use(actuator({basePath: "/actuator"}));
    middleware.forEach(configuredMiddleware => app.use(configuredMiddleware));
    app.use("/", wrapAsyncRoutes(await router()));

    app.use((err, _req, res, _next) => {
        const message = nodeEnv === "production"
            ? err.message
            : (err.stack || err.message || "Internal Server Error")
                .split("\n")
                .map(line => line.trimStart())
                .join("\n");
        res.status(HTTPStatus.INTERNAL_SERVER_ERROR).render("error", {message});
    });

    return app;
};
