import {fileURLToPath} from "node:url";
import pg from "pg";
import {restoreAndVerifyStudyBackup} from "../util/study-backup.js";
import {resolveStudyRestoreInputs} from "../util/study-backup-input.js";
import {inspectEncryptedArchive, restoreEncryptedArchive} from "../util/study-backup-process.js";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const {Pool} = pg;
let pool;

try {
    const inputs = resolveStudyRestoreInputs(process.env, repositoryRoot);
    process.env.PGPASSFILE = inputs.environment.PGPASSFILE;
    pool = new Pool(inputs.targetDatabase);
    await restoreAndVerifyStudyBackup({
        ...inputs,
        targetPool: pool,
        inspectEncryptedArchive: options => inspectEncryptedArchive({...options, environment: inputs.environment}),
        restoreEncryptedArchive,
    });
    process.stdout.write("ISOLATED_STUDY_RESTORE_VERIFIED\n");
} catch (_error) {
    process.stderr.write("ISOLATED_STUDY_RESTORE_FAILED\n");
    process.exitCode = 1;
} finally {
    if (pool) await pool.end();
}
