import {mkdir, writeFile} from "node:fs/promises";
import path from "node:path";
import {readPullRequestCards} from "../util/csv-pr-provider.js";
import {persistCards} from "../util/pr-card-persistence.js";

const args = process.argv.slice(2);
const inputPath = args[0];
const persist = args.includes("--persist");
const strict = args.includes("--strict");
const outputPath = args.find((argument, index) => index > 0 && !argument.startsWith("--")) || "/tmp/pr-cards.json";

const persistCardsTransaction = async (cards, checksum) => {
    const {default: pool} = await import("../util/pg-pool.js");
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        await persistCards(client, cards, checksum);
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
    console.error("Usage: npm run import:csv -- <input.csv> [output.json] [--persist] [--strict]");
    process.exitCode = 1;
} else {
    const {cards, errors, sourceChecksum} = await readPullRequestCards(
        inputPath,
        strict ? {expectedCardCount: 300} : {},
    );
    await mkdir(path.dirname(outputPath), {recursive: true});
    await writeFile(outputPath, `${JSON.stringify(cards, null, 2)}\n`, "utf8");

    if (persist && errors.length === 0) await persistCardsTransaction(cards, sourceChecksum);

    console.log(`Imported cards: ${cards.length}`);
    console.log(`Rejected rows: ${errors.length}`);
    if (errors.length > 0) console.error(JSON.stringify(errors, null, 2));
    if (cards.length === 0 || errors.length > 0) process.exitCode = 1;
}
