import pool from "../util/pg-pool.js";
import {applyStudySchema} from "../util/study-schema.js";

try {
    await applyStudySchema(pool);
    console.log("Study schema migration complete");
} finally {
    await pool.end();
}
