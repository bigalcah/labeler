import {mkdir, writeFile} from "node:fs/promises";
import {createHash} from "node:crypto";
import {readFile} from "node:fs/promises";
import path from "node:path";
import {readPullRequestCards} from "../util/csv-pr-provider.js";

const args = process.argv.slice(2);
const inputPath = args[0];
const persist = args.includes("--persist");
const outputPath = args.find((argument, index) => index > 0 && argument !== "--persist") || "/tmp/pr-cards.json";

const persistCards = async (cards, checksum) => {
    const {default: pool} = await import("../util/pg-pool.js");
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        for (const card of cards) {
            await client.query(
                `INSERT INTO pr_cards(
                    source_card_id, source_pr_id, repository, pr_number, title, body, author,
                    language, state, merged, html_url, created_at_source, closed_at_source,
                    merged_at_source, summary, evidence, raw_payload, source_type, source_checksum
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
                ON CONFLICT (source_card_id) DO UPDATE SET
                    source_pr_id = EXCLUDED.source_pr_id,
                    repository = EXCLUDED.repository,
                    pr_number = EXCLUDED.pr_number,
                    title = EXCLUDED.title,
                    body = EXCLUDED.body,
                    author = EXCLUDED.author,
                    language = EXCLUDED.language,
                    state = EXCLUDED.state,
                    merged = EXCLUDED.merged,
                    html_url = EXCLUDED.html_url,
                    created_at_source = EXCLUDED.created_at_source,
                    closed_at_source = EXCLUDED.closed_at_source,
                    merged_at_source = EXCLUDED.merged_at_source,
                    summary = EXCLUDED.summary,
                    evidence = EXCLUDED.evidence,
                    raw_payload = EXCLUDED.raw_payload,
                    source_type = EXCLUDED.source_type,
                    source_checksum = EXCLUDED.source_checksum,
                    updated_at = NOW()`,
                [
                    card.source_card_id,
                    card.source_pr_id?.toString() || null,
                    card.repository,
                    card.pr_number,
                    card.title,
                    card.body,
                    card.author,
                    card.language,
                    card.state,
                    card.merged,
                    card.html_url,
                    card.dates.created_at,
                    card.dates.closed_at,
                    card.dates.merged_at,
                    card.summary,
                    card.evidence,
                    card.raw_payload,
                    card.source_type,
                    checksum,
                ],
            );
        }
        await client.query("COMMIT");
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
        await pool.end();
    }
};

if (!inputPath) {
    console.error("Usage: npm run import:csv -- <input.csv> [output.json] [--persist]");
    process.exitCode = 1;
} else {
    const {cards, errors} = await readPullRequestCards(inputPath);
    const checksum = createHash("sha256")
        .update(await readFile(inputPath))
        .digest("hex");
    await mkdir(path.dirname(outputPath), {recursive: true});
    await writeFile(outputPath, `${JSON.stringify(cards, null, 2)}\n`, "utf8");

    if (persist && errors.length === 0) await persistCards(cards, checksum);

    console.log(`Imported cards: ${cards.length}`);
    console.log(`Rejected rows: ${errors.length}`);
    if (errors.length > 0) console.error(JSON.stringify(errors, null, 2));
    if (cards.length === 0 || errors.length > 0) process.exitCode = 1;
}
