import pool from "../util/pg-pool.js";
import {parseThrough, runStudyMigrations} from "../util/study-schema.js";

try {
    const through = parseThrough(process.argv.slice(2));
    await runStudyMigrations(pool, through);
    console.log("Study schema migration complete");
} finally {
    await pool.end();
}
