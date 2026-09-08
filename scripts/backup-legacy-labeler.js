import path from "node:path";
import {fileURLToPath} from "node:url";
import {
    createLegacyBackup,
    resolveBackupInputs,
    verifyLegacyBackup,
} from "../util/legacy-backup.js";
import {readLegacyInventory} from "../util/legacy-inventory.js";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));

try {
    const inventory = await readLegacyInventory();
    const inputs = resolveBackupInputs(process.env, repositoryRoot);
    await createLegacyBackup({inputs, inventory});
    await verifyLegacyBackup({
        archivePath: inputs.archivePath,
        manifestPath: inputs.manifestPath,
        inventory,
    });
    console.log(`Verified legacy backup: ${path.basename(inputs.archivePath)}`);
} catch (error) {
    console.error(error.message);
    process.exitCode = 1;
}
