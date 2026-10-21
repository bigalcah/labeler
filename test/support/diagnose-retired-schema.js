import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFile, writeFile} from "node:fs/promises";
import pg from "pg";
import {readReadinessSchemaContract} from "../../util/study-readiness-schema.js";
import {managedMigrations} from "../../util/study-schema.js";

const queries = {
    namespaces: `SELECT n.nspname FROM pg_namespace n
        WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema' ORDER BY 1`,
    extensions: `SELECT e.extname, e.extversion, n.nspname FROM pg_extension e
        JOIN pg_namespace n ON n.oid = e.extnamespace ORDER BY 1`,
    relations: `SELECT n.nspname, c.relname, c.relkind, c.relpersistence, c.relrowsecurity,
        c.relforcerowsecurity, c.relreplident, c.relispartition, c.reloptions,
        CASE WHEN c.relkind IN ('v', 'm') THEN pg_get_viewdef(c.oid, true) END AS view_definition
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema' ORDER BY 1, 2`,
    columns: `SELECT n.nspname, c.relname, a.attnum, a.attname,
        format_type(a.atttypid, a.atttypmod) AS type, a.attnotnull, a.attidentity, a.attgenerated,
        a.attisdropped, a.attislocal, a.attinhcount, a.attcollation::regcollation::text AS collation,
        pg_get_expr(d.adbin, d.adrelid) AS default_expression
        FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
        WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema' AND a.attnum > 0 ORDER BY 1, 2, 3`,
    constraints: `SELECT n.nspname, c.relname, k.conname, k.contype, k.convalidated,
        k.condeferrable, k.condeferred, pg_get_constraintdef(k.oid, true) AS definition
        FROM pg_constraint k JOIN pg_class c ON c.oid = k.conrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema' ORDER BY 1, 2, 3`,
    indexes: `SELECT n.nspname, c.relname, pg_get_indexdef(i.indexrelid) AS definition,
        i.indisvalid, i.indisready, i.indislive, i.indisreplident
        FROM pg_index i JOIN pg_class c ON c.oid = i.indrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema' ORDER BY 1, 2, 3`,
    triggers: `SELECT n.nspname, c.relname, t.tgenabled, t.tgisinternal,
        regexp_replace(pg_get_triggerdef(t.oid, true), 'RI_ConstraintTrigger_[ac]_[0-9]+', 'RI_INTERNAL', 'g') AS definition
        FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema' ORDER BY 1, 2, 5`,
    functions: `SELECT n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) AS arguments,
        pg_get_functiondef(p.oid) AS definition, p.prosecdef, p.provolatile, p.proparallel, p.proconfig
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema' ORDER BY 1, 2, 3`,
    dependencies: `SELECT DISTINCT d.deptype,
        regexp_replace(pg_describe_object(d.classid, d.objid, d.objsubid),
            'RI_ConstraintTrigger_[ac]_[0-9]+', 'RI_INTERNAL', 'g') AS dependent,
        regexp_replace(pg_describe_object(d.refclassid, d.refobjid, d.refobjsubid),
            'RI_ConstraintTrigger_[ac]_[0-9]+', 'RI_INTERNAL', 'g') AS referenced
        FROM pg_depend d WHERE
        (d.refclassid = 'pg_class'::regclass AND d.refobjid IN
            (SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'))
        OR (d.refclassid = 'pg_proc'::regclass AND d.refobjid IN
            (SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'))
        ORDER BY 1, 2, 3`,
    rules: `SELECT n.nspname, c.relname, r.rulename, pg_get_ruledef(r.oid, true) AS definition
        FROM pg_rewrite r JOIN pg_class c ON c.oid = r.ev_class
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema' ORDER BY 1, 2, 3`,
    policies: `SELECT n.nspname, c.relname, p.polname, p.polcmd, p.polpermissive,
        pg_get_expr(p.polqual, p.polrelid) AS qualification,
        pg_get_expr(p.polwithcheck, p.polrelid) AS check_expression
        FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema' ORDER BY 1, 2, 3`,
};

const sha256 = value => createHash("sha256").update(value).digest("hex");
const normalizedDependencies = rows => rows.map(row => ({...row,
    dependent: row.dependent.replace(/toast table pg_toast\.pg_toast_[0-9]+/g, "toast table pg_toast.TOAST"),
    referenced: row.referenced.replace(/toast table pg_toast\.pg_toast_[0-9]+/g, "toast table pg_toast.TOAST"),
})).sort((left, right) => {
    const leftKey = JSON.stringify([left.deptype, left.dependent, left.referenced]);
    const rightKey = JSON.stringify([right.deptype, right.dependent, right.referenced]);
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
});

const captureRows = async client => {
    const rowsBySection = {};
    const rawDependencies = (await client.query(queries.dependencies)).rows;
    for (const [section, query] of Object.entries(queries)) {
        rowsBySection[section] = section === "dependencies"
            ? normalizedDependencies(rawDependencies)
            : (await client.query(query)).rows;
    }
    return {rowsBySection, rawDependencies};
};

const signaturesFor = rowsBySection => Object.fromEntries(Object.entries(rowsBySection).map(([section, rows]) => [
    section,
    {count: rows.length, sha256: sha256(JSON.stringify(rows))},
]));

const countedRows = rows => {
    const counts = new Map();
    for (const row of rows) {
        const key = JSON.stringify(row);
        const entry = counts.get(key) ?? {row, count: 0};
        entry.count += 1;
        counts.set(key, entry);
    }
    return counts;
};

const diffRows = (leftRows, rightRows) => {
    const left = countedRows(leftRows);
    const right = countedRows(rightRows);
    const onlyLeft = [];
    const onlyRight = [];
    for (const [key, entry] of left) {
        const difference = entry.count - (right.get(key)?.count ?? 0);
        if (difference > 0) onlyLeft.push({...entry, count: difference});
    }
    for (const [key, entry] of right) {
        const difference = entry.count - (left.get(key)?.count ?? 0);
        if (difference > 0) onlyRight.push({...entry, count: difference});
    }
    return {onlyLeft, onlyRight};
};

const summarizeDiff = ({onlyLeft, onlyRight}) => ({
    onlyRetiredCount: onlyLeft.reduce((sum, entry) => sum + entry.count, 0),
    onlyFreshCount: onlyRight.reduce((sum, entry) => sum + entry.count, 0),
    onlyRetired: onlyLeft,
    onlyFresh: onlyRight,
});

const inspect = async (pool, label, pinned, pinnedPrefix) => {
    const client = await pool.connect();
    try {
        await client.query("BEGIN READ ONLY");
        await client.query("SET LOCAL search_path TO public, pg_catalog, pg_temp");
        await client.query("SET LOCAL TIME ZONE 'UTC'");
        const captured = await captureRows(client);
        const signatures = signaturesFor(captured.rowsBySection);
        const readinessContract = await readReadinessSchemaContract(client);
        assert.deepEqual(signatures, readinessContract.signatures,
            `${label} catalog row query must reproduce the production readiness signatures`);
        assert.deepEqual(readinessContract.migrations, pinned.migrations,
            `${label} migration-source contract differs from the pinned sources`);
        const {rows: ledgerRows} = await client.query(
            "SELECT migration_id FROM public.labeler_migration ORDER BY migration_id",
        );
        const ledger = ledgerRows.map(row => row.migration_id);
        const managedLedger = ledger.filter(id => id !== "002_retire_legacy_labeler");
        assert.deepEqual(managedLedger, managedMigrations.map(migration => migration.id),
            `${label} database is not at managed migration 014`);
        const {rows: [version]} = await client.query("SELECT current_setting('server_version_num')::integer AS version");
        await client.query("COMMIT");
        return {
            label,
            serverMajor: Math.floor(version.version / 10000),
            ledger,
            signatures,
            rowsBySection: captured.rowsBySection,
            rawDependencies: captured.rawDependencies,
            prefixHash: sha256(JSON.stringify(signatures)),
            matchesPinnedPrefix: sha256(JSON.stringify(signatures)) === pinnedPrefix,
            matchesPinnedSections: Object.fromEntries(Object.entries(signatures).map(([section, signature]) => [
                section,
                JSON.stringify(signature) === JSON.stringify(pinned.signatures[section]),
            ])),
        };
    } catch (error) {
        try {
            await client.query("ROLLBACK");
        } catch (rollbackError) {
            throw new AggregateError([error, rollbackError], "Catalog inspection and rollback both failed");
        }
        throw error;
    } finally {
        client.release();
    }
};

const {Pool} = pg;
const [host, passwordFile, user, retiredDatabase, freshDatabase, outputPath] = process.argv.slice(2);
assert.ok(host && passwordFile && user && retiredDatabase && freshDatabase && outputPath,
    "usage: diagnose-retired-schema.js host password-file user retired-database fresh-database output-path");
assert.match(freshDatabase, /^[a-z0-9_-]+$/, "fresh fixture database name must be a safe identifier");
const password = (await readFile(passwordFile, "utf8")).trim();
const connection = {host, port: 5432, user, password, max: 1, connectionTimeoutMillis: 5000};
const pinned = JSON.parse(await readFile(new URL("../../util/copilot-369-schema-contract.json", import.meta.url), "utf8"));
const prefixes = JSON.parse(await readFile(new URL("../../util/study-readiness-prefixes.json", import.meta.url), "utf8"));
const pinnedPrefix = prefixes[managedMigrations.at(-1).id];
const retiredPool = new Pool({...connection, database: retiredDatabase});
const freshPool = new Pool({...connection, database: freshDatabase});

try {
    const [retired, fresh] = await Promise.all([
        inspect(retiredPool, "retired", pinned, pinnedPrefix),
        inspect(freshPool, "fresh-managed-014", pinned, pinnedPrefix),
    ]);
    assert.equal(retired.serverMajor, pinned.postgresMajor);
    assert.equal(fresh.serverMajor, pinned.postgresMajor);
    const sections = {};
    for (const section of Object.keys(queries)) {
        const diff = diffRows(retired.rowsBySection[section], fresh.rowsBySection[section]);
        sections[section] = {
            retiredCount: retired.signatures[section].count,
            freshCount: fresh.signatures[section].count,
            retiredMatchesPinned: retired.matchesPinnedSections[section],
            freshMatchesPinned: fresh.matchesPinnedSections[section],
            ...summarizeDiff(diff),
        };
    }
    const rawDependencyDiff = diffRows(retired.rawDependencies, fresh.rawDependencies);
    const normalizedDependencyDiff = diffRows(
        retired.rowsBySection.dependencies,
        fresh.rowsBySection.dependencies,
    );
    const report = {
        diagnostic: "read-only-post-retirement-catalog-comparison",
        dataRowsQueried: false,
        credentialsWritten: false,
        postgresMajor: retired.serverMajor,
        migrationSourcesMatchPinned: true,
        managedMigrationIds: managedMigrations.map(migration => migration.id),
        retiredLedger: retired.ledger,
        freshLedger: fresh.ledger,
        retiredMatchesPinnedFinalPrefix: retired.matchesPinnedPrefix,
        freshMatchesPinnedFinalPrefix: fresh.matchesPinnedPrefix,
        changedSections: Object.entries(sections).filter(([, section]) =>
            !section.retiredMatchesPinned || section.onlyRetiredCount > 0 || section.onlyFreshCount > 0)
            .map(([section]) => section),
        sections,
        dependencyNormalization: {
            rawOnlyRetiredCount: rawDependencyDiff.onlyLeft.reduce((sum, entry) => sum + entry.count, 0),
            rawOnlyFreshCount: rawDependencyDiff.onlyRight.reduce((sum, entry) => sum + entry.count, 0),
            readinessNormalizedOnlyRetiredCount: normalizedDependencyDiff.onlyLeft.reduce((sum, entry) => sum + entry.count, 0),
            readinessNormalizedOnlyFreshCount: normalizedDependencyDiff.onlyRight.reduce((sum, entry) => sum + entry.count, 0),
            rawDifferencesRemovedByExistingToastOidNormalization:
                rawDependencyDiff.onlyLeft.length + rawDependencyDiff.onlyRight.length
                - normalizedDependencyDiff.onlyLeft.length - normalizedDependencyDiff.onlyRight.length,
            note: "Readiness replaces per-database pg_toast table OIDs in dependency descriptions before hashing.",
        },
    };
    await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, {mode: 0o600});
    process.stdout.write(`CATALOG_DIAGNOSTIC_WRITTEN ${outputPath}\n`);
} finally {
    await Promise.all([retiredPool.end(), freshPool.end()]);
}
