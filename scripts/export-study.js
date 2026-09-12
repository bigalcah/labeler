import {fileURLToPath} from "node:url";
import pool from "../util/pg-pool.js";
import {resolveStudyExportInputs} from "../util/study-export-input.js";
import {createStudyExport} from "../util/study-export.js";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));

try {
    const inputs = resolveStudyExportInputs(process.argv.slice(2), process.env, repositoryRoot);
    await createStudyExport({pool, ...inputs});
    process.stdout.write("STUDY_EXPORT_PUBLISHED\n");
} catch (_error) {
    process.stderr.write("STUDY_EXPORT_FAILED\n");
    process.exitCode = 1;
} finally {
    await pool.end();
}
