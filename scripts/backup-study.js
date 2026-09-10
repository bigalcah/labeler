import {fileURLToPath} from "node:url";
import pg from "pg";
import {createStudyBackup, resolveStudyBackupInputs} from "../util/study-backup.js";
import {createEncryptedArchive, inspectEncryptedArchive} from "../util/study-backup-process.js";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const {Pool} = pg;
let pool;

try {
    const inputs = resolveStudyBackupInputs(process.env, repositoryRoot);
    pool = new Pool(inputs.database);
    await createStudyBackup({inputs, pool, createEncryptedArchive, inspectEncryptedArchive});
    process.stdout.write("STUDY_BACKUP_VERIFIED\n");
} catch (_error) {
    process.stderr.write("STUDY_BACKUP_FAILED\n");
    process.exitCode = 1;
} finally {
    if (pool) await pool.end();
}
