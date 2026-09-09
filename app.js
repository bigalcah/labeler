import compression from "compression";
import express from "express";
import paginate from "express-paginate";
import actuator from "express-actuator";
import minifyHTML from "express-minify-html-2";
import bodyParser from "body-parser";
import {router} from "express-file-routing";
import {fileURLToPath} from "url";
import path from "node:path";
import {parse as parseUserAgent} from "useragent";
import HTTPStatus from "./util/http-status.js";
import {renderSafeMarkdown} from "./util/safe-markdown.js";
import {createSessionMiddleware} from "./util/session-middleware.js";
import {createCsrfToken, ensureLoginCsrfContext, validateLoginCsrfToken, validateSessionCsrfToken} from "./util/csrf.js";
import {createMutationSecurityMiddleware} from "./util/mutation-security.js";
import {createSecurityHeadersMiddleware} from "./util/security-headers.js";
import {DEFAULT_DEVELOPMENT_ORIGINS} from "./util/production-config.js";

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
    sessionMiddleware,
    sessionPolicy,
    passwordVerifier,
    clock = () => new Date(),
    logger = noopMiddleware,
    middleware = [],
    csrf = {},
    nodeEnv = process.env.NODE_ENV || "development",
    originPolicy = {},
} = {}) => {
    const app = express();
    app.set("trust proxy", sessionPolicy?.trustProxyHops ?? 0);
    const resolvedSessionMiddleware = sessionMiddleware || createSessionMiddleware({
        pool,
        clock,
        policy: sessionPolicy,
    });

    app.locals.pool = pool;
    app.locals.sessionMiddleware = resolvedSessionMiddleware;
    app.locals.clock = clock;
    app.locals.logger = logger;
    app.locals.dependencies = {
        pool,
        sessionMiddleware: resolvedSessionMiddleware,
        sessionPolicy,
        passwordVerifier,
        clock,
        logger,
        csrf: {
            createCsrfToken,
            ensureLoginCsrfContext,
            validateLoginCsrfToken,
            validateSessionCsrfToken,
            ...csrf,
        },
    };

    const resolvedOriginPolicy = Object.freeze({
        nodeEnv,
        appOrigin: originPolicy.appOrigin ?? sessionPolicy?.appOrigin ?? null,
        developmentOrigins: originPolicy.developmentOrigins ?? sessionPolicy?.developmentOrigins ?? DEFAULT_DEVELOPMENT_ORIGINS,
    });
    app.locals.originPolicy = resolvedOriginPolicy;

    app.use(logger);
    app.use(resolvedSessionMiddleware);
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
    app.use(createSecurityHeadersMiddleware({nodeEnv}));
    app.use(asyncHandler(createMutationSecurityMiddleware({
        pool,
        clock,
        csrf: app.locals.dependencies.csrf,
        originPolicy: resolvedOriginPolicy,
    })));
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
