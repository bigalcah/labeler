import pg from "pg";
import {readSecretFile} from "../util/secret-file.js";
import {prepareCopilot369Cutover} from "../util/copilot-369-cutover-preflight.js";

const pool = new pg.Pool({host: process.env.DATABASE_HOST, port: Number(process.env.DATABASE_PORT || 5432),
    database: process.env.DATABASE_NAME, user: process.env.DATABASE_USER,
    password: readSecretFile(process.env.DATABASE_PASS_FILE, "DATABASE_PASS_FILE"), max: 1,
    connectionTimeoutMillis: 5000, statement_timeout: 30000});
let client;
try {
    if (process.argv.length !== 3 || !process.argv[2].startsWith("/")) throw new Error("External password path required");
    client = await pool.connect();
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const {rows: [study]} = await client.query("SELECT id, config, source_checksum FROM public.study WHERE study_key=$1",
        ["pr-card-sorting-local"]);
    if (!study) throw new Error("Historical primary required");
    const {rows: [decisions]} = await client.query(`SELECT EXISTS (
        SELECT 1 FROM public.pr_classification WHERE study_id=$1
        UNION ALL SELECT 1 FROM public.pr_discard WHERE study_id=$1
    ) AS present`, [study.id]);
    if (decisions.present) throw new Error("Primary decisions block automatic cutover");
    const {rows: memberships} = await client.query(
        "SELECT pr_card_id, source_card_id, ordinal, source_checksum FROM public.study_card WHERE study_id=$1 ORDER BY ordinal", [study.id]);
    const request = {confirmation: "cutover-primary-300-to-copilot-369",
        maintenance: {applicationStopped: true, preparationStopped: true, enrichmentStopped: true, schemaWritersStopped: true},
        expectedStudyId: study.id, expectedStudyKey: "pr-card-sorting-local", expectedLegacyConfig: study.config,
        expectedLegacyChecksum: study.source_checksum,
        expectedTargetChecksum: "fad0881b9e40b1b68a577e84ad60c90d48fcebe79db8d55d05613fc1746794fb",
        expectedLegacyMemberships: memberships, legacyCsvPath: "/labeling/data/pr-cards.csv",
        targetCsvPath: "/labeling/data/copilot-369-cards.csv", targetManifestPath: "/labeling/data/copilot-369-cards.manifest.json",
        database: {host: process.env.DATABASE_HOST, port: Number(process.env.DATABASE_PORT || 5432),
            database: process.env.DATABASE_NAME, user: process.env.DATABASE_USER, passwordFile: process.argv[2]}};
    await prepareCopilot369Cutover(request);
    await client.query("COMMIT");
    process.stdout.write(`${JSON.stringify(request)}\n`);
} catch {
    if (client) await client.query("ROLLBACK");
    process.stderr.write("Automatic cutover request rejected; source, configuration or memberships differ.\n");
    process.exitCode = 1;
} finally {
    client?.release();
    await pool.end();
}
