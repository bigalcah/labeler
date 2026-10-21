import {readFile} from "node:fs/promises";
import path from "node:path";
import {pathToFileURL} from "node:url";
import pg from "pg";
import {cutoverCopilot369} from "../util/copilot-369-cutover.js";
import {readSecretFile} from "../util/secret-file.js";

const USAGE = `Usage: node scripts/cutover-copilot-369.js --request /absolute/operator-request.json
Dedicated primary300 -> Copilot369 cutover. No migrations or credentials are provisioned.
The request must contain confirmation="cutover-primary-300-to-copilot-369", maintenance
{applicationStopped:true,preparationStopped:true,enrichmentStopped:true,schemaWritersStopped:true},
expectedStudyId, expectedStudyKey, expectedLegacyConfig, expectedLegacyChecksum,
expectedTargetChecksum, exact expectedLegacyMemberships [{pr_card_id,source_card_id,ordinal,source_checksum}],
legacyCsvPath, targetCsvPath, targetManifestPath and database {host,port,database,user,passwordFile}.
Use an external protected passwordFile, never inline passwords. Migration 014 must already be applied.
An exact existing369 study is verified in REPEATABLE READ READ ONLY; it is never rewritten.
Release remains HOLD. This command does not attest a backup or stop writers for you.`;

const runCutoverCli = async argumentsList => {
    if (argumentsList.length === 1 && argumentsList[0] === "--help") {
        process.stdout.write(`${USAGE}\n`);
        return;
    }
    if (argumentsList.length !== 2 || argumentsList[0] !== "--request" || !path.isAbsolute(argumentsList[1])) {
        throw new Error(USAGE);
    }
    const request = JSON.parse(await readFile(argumentsList[1], "utf8"));
    const database = request.database;
    if (!database || typeof database.host !== "string" || !database.host
        || !Number.isInteger(database.port) || database.port < 1 || database.port > 65535
        || typeof database.database !== "string" || !database.database
        || typeof database.user !== "string" || !database.user
        || Object.keys(database).some(key => !["host", "port", "database", "user", "passwordFile"].includes(key))) {
        throw new Error("Explicit database identity and external passwordFile are required; inline secrets are forbidden");
    }
    const password = readSecretFile(database.passwordFile, "cutover database password");
    const pool = new pg.Pool({host: database.host, port: database.port, database: database.database,
        user: database.user, password, max: 1, connectionTimeoutMillis: 5_000});
    try {
        const {database: _database, ...options} = request;
        const result = await cutoverCopilot369({...options, pool});
        process.stdout.write(`${JSON.stringify(result)}\n`);
    } finally {
        await pool.end();
    }
};

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
    runCutoverCli(process.argv.slice(2)).catch(() => {
        process.stderr.write("Copilot369 cutover failed closed. Check the operator request, maintenance, source, schema, history and locks. No credentials are printed. Use --help for the request contract.\n");
        process.exitCode = 1;
    });
}

export {runCutoverCli};
