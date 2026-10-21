import {createHash} from "node:crypto";
import {readFile} from "node:fs/promises";
import {isDeepStrictEqual} from "node:util";
import {managedMigrations} from "./study-schema.js";
import {readHistorySource, readStudyLedger} from "./study-ledger.js";

const CUTOVER_TABLES = Object.freeze([
    "github_api_telemetry_event", "github_card_snapshot", "github_enrichment_run",
    "github_enrichment_run_card", "github_run_page", "labeler_migration", "participant_account",
    "participant_category", "pr_cards", "pr_classification", "pr_discard", "reviewer", "study",
    "study_card", "study_enrichment_promotion", "study_participant", "study_card_reference", "study_source_membership",
]);
const digest = value => createHash("sha256").update(value).digest("hex");
const userNamespace = "n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'";

const readCopilot369SchemaContract = async (client, {normalizeDependencies = false} = {}) => {
    const queries = {
        namespaces: `SELECT n.nspname FROM pg_namespace n WHERE ${userNamespace} ORDER BY 1`,
        extensions: `SELECT e.extname, e.extversion, n.nspname FROM pg_extension e
            JOIN pg_namespace n ON n.oid = e.extnamespace ORDER BY 1`,
        relations: `SELECT n.nspname, c.relname, c.relkind, c.relpersistence, c.relrowsecurity,
            c.relforcerowsecurity, c.relreplident, c.relispartition, c.reloptions,
            CASE WHEN c.relkind IN ('v', 'm') THEN pg_get_viewdef(c.oid, true) END AS view_definition
            FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE ${userNamespace} ORDER BY 1, 2`,
        columns: `SELECT n.nspname, c.relname, a.attnum, a.attname,
            format_type(a.atttypid, a.atttypmod) AS type, a.attnotnull, a.attidentity, a.attgenerated,
            a.attisdropped, a.attislocal, a.attinhcount, a.attcollation::regcollation::text AS collation,
            pg_get_expr(d.adbin, d.adrelid) AS default_expression
            FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
            JOIN pg_namespace n ON n.oid = c.relnamespace
            LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
            WHERE ${userNamespace} AND a.attnum > 0 ORDER BY 1, 2, 3`,
        constraints: `SELECT n.nspname, c.relname, k.conname, k.contype, k.convalidated,
            k.condeferrable, k.condeferred, pg_get_constraintdef(k.oid, true) AS definition
            FROM pg_constraint k JOIN pg_class c ON c.oid = k.conrelid
            JOIN pg_namespace n ON n.oid = c.relnamespace WHERE ${userNamespace} ORDER BY 1, 2, 3`,
        indexes: `SELECT n.nspname, c.relname, pg_get_indexdef(i.indexrelid) AS definition,
            i.indisvalid, i.indisready, i.indislive, i.indisreplident
            FROM pg_index i JOIN pg_class c ON c.oid = i.indrelid
            JOIN pg_namespace n ON n.oid = c.relnamespace WHERE ${userNamespace} ORDER BY 1, 2, 3`,
        triggers: `SELECT n.nspname, c.relname, t.tgenabled, t.tgisinternal,
            regexp_replace(pg_get_triggerdef(t.oid, true), 'RI_ConstraintTrigger_[ac]_[0-9]+', 'RI_INTERNAL', 'g') AS definition
            FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
            JOIN pg_namespace n ON n.oid = c.relnamespace WHERE ${userNamespace} ORDER BY 1, 2, 5`,
        functions: `SELECT n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) AS arguments,
            pg_get_functiondef(p.oid) AS definition, p.prosecdef, p.provolatile, p.proparallel, p.proconfig
            FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE ${userNamespace}
            ORDER BY 1, 2, 3`,
        dependencies: `SELECT DISTINCT d.deptype,
            regexp_replace(pg_describe_object(d.classid, d.objid, d.objsubid),
                'RI_ConstraintTrigger_[ac]_[0-9]+', 'RI_INTERNAL', 'g') AS dependent,
            regexp_replace(pg_describe_object(d.refclassid, d.refobjid, d.refobjsubid),
                'RI_ConstraintTrigger_[ac]_[0-9]+', 'RI_INTERNAL', 'g') AS referenced
            FROM pg_depend d WHERE
            (d.refclassid = 'pg_class'::regclass AND d.refobjid IN
                (SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE ${userNamespace}))
            OR (d.refclassid = 'pg_proc'::regclass AND d.refobjid IN
                (SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE ${userNamespace}))
            ORDER BY 1, 2, 3`,
        rules: `SELECT n.nspname, c.relname, r.rulename, pg_get_ruledef(r.oid, true) AS definition
            FROM pg_rewrite r JOIN pg_class c ON c.oid = r.ev_class
            JOIN pg_namespace n ON n.oid = c.relnamespace WHERE ${userNamespace} ORDER BY 1, 2, 3`,
        policies: `SELECT n.nspname, c.relname, p.polname, p.polcmd, p.polpermissive,
            pg_get_expr(p.polqual, p.polrelid) AS qualification,
            pg_get_expr(p.polwithcheck, p.polrelid) AS check_expression
            FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
            JOIN pg_namespace n ON n.oid = c.relnamespace WHERE ${userNamespace} ORDER BY 1, 2, 3`,
    };
    const signatures = {};
    for (const [section, query] of Object.entries(queries)) {
        let {rows} = await client.query(query);
        if (normalizeDependencies && section === "dependencies") {
            rows = rows.map(row => ({...row,
                dependent: row.dependent.replace(/toast table pg_toast\.pg_toast_[0-9]+/g, "toast table pg_toast.TOAST"),
                referenced: row.referenced.replace(/toast table pg_toast\.pg_toast_[0-9]+/g, "toast table pg_toast.TOAST"),
            })).sort((left, right) => {
                const leftKey = JSON.stringify([left.deptype, left.dependent, left.referenced]);
                const rightKey = JSON.stringify([right.deptype, right.dependent, right.referenced]);
                return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
            });
        }
        signatures[section] = {count: rows.length, sha256: digest(JSON.stringify(rows))};
    }
    const migrations = [];
    for (const migration of managedMigrations) {
        migrations.push({id: migration.id, sha256: digest(await readFile(migration.url))});
    }
    return {postgresMajor: 17, migrations, signatures};
};

const assertCopilot369SchemaContract = async client => {
    const {contract} = await readHistorySource();
    const pinned = contract.schema;
    const {rows: [version]} = await client.query("SELECT current_setting('server_version_num')::integer AS version");
    if (Math.floor(version.version / 10000) !== pinned.postgresMajor) {
        throw new Error("Cutover requires the pinned PostgreSQL 17 schema contract");
    }
    const {rows: temporary} = await client.query("SELECT 1 FROM pg_class WHERE relpersistence = 't' LIMIT 1");
    const {rows: [replication]} = await client.query("SHOW session_replication_role");
    if (temporary.length || replication.session_replication_role !== "origin") {
        throw new Error("Unknown cutover schema execution context: temporary objects or bypassed triggers");
    }
    const actual = await readCopilot369SchemaContract(client, {normalizeDependencies: true});
    if (!isDeepStrictEqual(actual.migrations, pinned.migrations)
        || digest(JSON.stringify(actual.signatures)) !== pinned.fingerprint) {
        const changed = Object.keys(actual.signatures).filter(key => !isDeepStrictEqual(actual.signatures[key], pinned.signatures[key]));
        throw new Error(`Unknown cutover schema contract: ${changed.join(", ") || "migration source drift"}`);
    }
    if (!(await readStudyLedger(client, {requireComplete: true})).applied016) {
        throw new Error("Cutover requires the verified schema-4 history migration");
    }
};

export {CUTOVER_TABLES, assertCopilot369SchemaContract, readCopilot369SchemaContract};
