import {createReadStream} from "node:fs";
import {createHash} from "node:crypto";
import {readFile} from "node:fs/promises";
import {parse} from "csv-parse";
import {computeCardChecksum} from "./pr-card-checksum.js";
import {buildPullRequestCard} from "./pr-card.js";

const readPullRequestCards = async (filePath, options = {}) => {
    const cards = [];
    const errors = [];
    const sourceChecksum = createHash("sha256")
        .update(await readFile(filePath))
        .digest("hex");
    const parser = createReadStream(filePath).pipe(parse({
        bom: true,
        columns: true,
        skip_empty_lines: true,
        skip_records_with_error: true,
        trim: true,
    }));

    parser.on("skip", error => {
        errors.push({
            line: error.lines,
            message: error.message,
        });
    });

    for await (const row of parser) {
        try {
            const card = buildPullRequestCard(row);
            cards.push({
                ...card,
                content_checksum: computeCardChecksum(card),
            });
        } catch (error) {
            errors.push({
                line: parser.info?.lines || null,
                card_id: row.card_id || null,
                message: error.message,
            });
        }
    }

    const seen = new Set();
    for (const card of cards) {
        if (seen.has(card.source_card_id)) {
            errors.push({
                line: null,
                card_id: card.source_card_id,
                message: `Duplicate source_card_id: ${card.source_card_id}`,
            });
        }
        seen.add(card.source_card_id);
    }

    if (options.expectedCardCount !== undefined && seen.size !== options.expectedCardCount) {
        errors.push({
            line: null,
            card_id: null,
            message: `Expected ${options.expectedCardCount} unique cards, received ${seen.size}`,
        });
    }

    return {cards, errors, sourceChecksum};
};

export {readPullRequestCards};
