import {readFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import {resolveBackupInputs} from "../util/legacy-backup.js";
import {readLegacyInventory} from "../util/legacy-inventory.js";
import {checkRetirementReadiness} from "../util/legacy-retirement.js";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const confirmation = "retire-legacy-labeler";
const actions = [ "--verify-only", "--apply", "--assert-clean" ];
const requestedActions = actions.filter(action => process.argv.includes(action));

if (requestedActions.length !== 1) {
    console.error(`Select exactly one retirement action: ${actions.join(", ")}`);
    process.exitCode = 1;
} else {
    let pool;
    try {
        const inventory = await readLegacyInventory();
        const [ action ] = requestedActions;

        if (action !== "--assert-clean") {
            if (process.env.LEGACY_RETIREMENT_CONFIRM !== confirmation) {
                throw new Error(`Set LEGACY_RETIREMENT_CONFIRM=${confirmation}`);
            }
            const inputs = resolveBackupInputs(process.env, repositoryRoot);
            process.env.DATABASE_HOST = inputs.credentials.host;
            process.env.DATABASE_PORT = inputs.credentials.port;
            process.env.DATABASE_NAME = inputs.credentials.database;
            process.env.DATABASE_USER = inputs.credentials.user;
        }

        ({default: pool} = await import("../util/pg-pool.js"));
        if (action === "--assert-clean") {
            const {tables, views, functions, procedures, types} = inventory.inventory.database;
            const {rows: [ result ]} = await pool.query(
                `SELECT NOT EXISTS (
                     SELECT 1
                     FROM pg_class relation
                     JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
                     WHERE namespace.nspname = 'public'
                       AND ((relation.relkind IN ('r', 'p') AND relation.relname = ANY($1::text[]))
                         OR (relation.relkind IN ('v', 'm') AND relation.relname = ANY($2::text[])))
                     UNION ALL
                     SELECT 1
                     FROM pg_proc routine
                     JOIN pg_namespace namespace ON namespace.oid = routine.pronamespace
                     WHERE namespace.nspname = 'public'
                       AND ((routine.prokind = 'f' AND routine.proname = ANY($3::text[]))
                         OR (routine.prokind = 'p' AND routine.proname = ANY($4::text[])))
                     UNION ALL
                     SELECT 1
                     FROM pg_type type
                     JOIN pg_namespace namespace ON namespace.oid = type.typnamespace
                     WHERE namespace.nspname = 'public' AND type.typname = ANY($5::text[])
                 ) AS clean`,
                [ tables, views, functions, procedures, types ],
            );
            if (!result.clean) {
                throw new Error("Clean deployment mode refuses a database containing legacy labeler objects");
            }
            console.log("Clean deployment mode verified that no legacy labeler objects exist");
        } else {
            const inputs = resolveBackupInputs(process.env, repositoryRoot);
            const state = await checkRetirementReadiness({
                pool,
                archivePath: inputs.archivePath,
                manifestPath: inputs.manifestPath,
                inventory,
                expectedDatabase: inputs.credentials,
            });
            console.log(`Legacy retirement prerequisites verified; database state: ${state}`);

            if (action === "--apply" && state === "ready") {
                const migration = await readFile(
                    new URL("../schema/migrations/002_retire_legacy_labeler.sql", import.meta.url),
                    "utf8",
                );
                await pool.query(migration);
                console.log("Applied migration 002_retire_legacy_labeler");
            } else if (action === "--verify-only") {
                console.log("Verification completed without applying the retirement migration");
            }
        }
    } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
    } finally {
        if (pool) await pool.end();
    }
}
