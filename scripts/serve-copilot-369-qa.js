#!/usr/bin/env node
import {once} from "node:events";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {createApp} from "../app.js";
import {addCardDates, sessionParticipant} from "../util/study-runtime.js";
import {createStudyService} from "../util/study-service.js";
import {closeCopilot369Database} from "../test/support/copilot-369-fixture.js";
import {
    createCopilot369QaSessionPolicy,
    createCopilot369Runtime,
} from "../test/support/copilot-369-runtime.js";

const usage = `Usage: node scripts/serve-copilot-369-qa.js

Starts a fresh PostgreSQL 17.6 tmpfs container and the real app on 127.0.0.1.
Only synthetic accounts and source fixtures are used. Stop with Ctrl-C or SIGTERM.`;

const listen = async app => {
    const server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    return server;
};

const closeServer = server => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));

const createCopilot369QaCasesMiddleware = ({pool, primaryStudyId, cardId}) => async (req, res, next) => {
    const variant = new Map([
        ["/__qa/copilot-369/cases/missing-language", "missing-language"],
        ["/__qa/copilot-369/cases/unsafe-markdown", "unsafe-markdown"],
    ]).get(req.path);
    if (!variant) return next();
    if (req.method !== "GET" || req.sessionContext?.studyId !== primaryStudyId) {
        res.status(404).end();
        return;
    }
    try {
        const {card, categories, progress} = await createStudyService({pool}).loadReviewCardData(req.sessionContext, cardId);
        const previewCard = variant === "missing-language"
            ? {...addCardDates(card), card_v2: {...card.card_v2,
                dataset_language: {...card.card_v2.dataset_language, value: null}}}
            : {...addCardDates(card), card_v2: {...card.card_v2,
                csv_evidence: {...card.card_v2.csv_evidence,
                    body: "**Synthetic safe Markdown**\n\n<img src=x onerror=alert(1)>\n\n[unsafe link](javascript:alert(1))"}}};
        const participant = sessionParticipant(req.sessionContext);
        res.locals.participant = participant;
        res.render("review", {participant, categories, card: previewCard, progress, total: progress.total,
            navigation: {previousId: card.previous_card_id, nextId: card.next_card_id}});
    } catch (error) {
        next(error);
    }
};

const runQaServer = async () => {
    let runtime;
    let server;
    let shutdownPromise;
    const shutdown = () => {
        if (shutdownPromise) return shutdownPromise;
        shutdownPromise = (async () => {
            if (server?.listening) await closeServer(server);
            if (runtime) {
                await closeCopilot369Database(runtime);
                runtime = null;
            }
        })();
        return shutdownPromise;
    };
    const onSignal = () => {
        process.stdout.write("Stopping isolated Copilot 369 QA server and owned database.\n");
        shutdown().catch(error => {
            process.stderr.write(`${error.message}\n`);
            process.exitCode = 1;
        });
    };

    process.once("SIGINT", onSignal);
    process.once("SIGTERM", onSignal);
    try {
        runtime = await createCopilot369Runtime();
        const {rows: [firstCard]} = await runtime.pool.query(
            "SELECT pr_card_id FROM study_card WHERE study_id = $1 ORDER BY ordinal LIMIT 1",
            [runtime.primaryStudyId],
        );
        const app = await createApp({
            pool: runtime.pool,
            sessionPolicy: createCopilot369QaSessionPolicy(),
            nodeEnv: "development",
            originPolicy: {appOrigin: null, developmentOrigins: ["http://127.0.0.1", "http://localhost"]},
            middleware: [createCopilot369QaCasesMiddleware({
                pool: runtime.pool,
                primaryStudyId: runtime.primaryStudyId,
                cardId: firstCard.pr_card_id,
            })],
        });
        server = await listen(app);
        const url = `http://127.0.0.1:${server.address().port}`;
        process.stdout.write(`Isolated Copilot 369 QA: ${url}\n`);
        process.stdout.write(`Owned temporary database container: ${runtime.containerName}\n`);
        process.stdout.write("Synthetic login credentials (not production credentials):\n");
        for (const account of runtime.accounts) {
            process.stdout.write(`  ${account.normalizedUsername} / ${runtime.passwords[account.participantKey]}\n`);
        }
        process.stdout.write(`Manual cases: ${url}/queue, ${url}/progress, ${url}/__qa/copilot-369/cases/missing-language, ${url}/__qa/copilot-369/cases/unsafe-markdown\n`);
        process.stdout.write("The session cookie is explicitly non-Secure for this loopback-only HTTP fixture.\n");
        await once(server, "close");
        await shutdown();
    } catch (error) {
        await shutdown();
        throw error;
    } finally {
        process.off("SIGINT", onSignal);
        process.off("SIGTERM", onSignal);
    }
};

const main = async () => {
    const args = process.argv.slice(2);
    if (args.length === 1 && args[0] === "--help") {
        process.stdout.write(`${usage}\n`);
        return;
    }
    if (args.length > 0) throw new Error(`Unexpected arguments.\n${usage}`);
    await runQaServer();
};

export {createCopilot369QaCasesMiddleware};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main().catch(error => {
        process.stderr.write(`${error.message}\n`);
        process.exitCode = 1;
    });
}
