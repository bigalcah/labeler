import {createReadStream} from "node:fs";
import {parse} from "csv-parse";
import {buildPullRequestCard} from "./pr-card.js";

const readPullRequestCards = async filePath => {
    const cards = [];
    const errors = [];
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
            cards.push(buildPullRequestCard(row));
        } catch (error) {
            errors.push({
                line: parser.info?.lines || null,
                card_id: row.card_id || null,
                message: error.message,
            });
        }
    }

    return {cards, errors};
};

export {readPullRequestCards};
