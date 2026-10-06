import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";
import {managedMigrations, runStudyMigrations} from "../util/study-schema.js";

const migrationId = "013_category_definition_color";
const migrationUrl = new URL(
    "../schema/migrations/013_category_definition_color.sql",
    import.meta.url,
);
const readMigration = () => readFile(migrationUrl, "utf8");

test("migration 013 is registered immediately after 012", () => {
    const migrationIds = managedMigrations.map(migration => migration.id);
    const migrationIndex = migrationIds.indexOf(migrationId);

    assert.deepEqual(migrationIds.slice(migrationIndex - 1, migrationIndex + 1), [
        "012_global_normalized_username",
        migrationId,
    ]);
});

test("migration runner applies migration 013 once after 012", async () => {
    const appliedMigrationIds = [
        "001_study_foundation",
        "003_private_pr_discard",
        "004_github_pr_api_enrichment",
        "005_github_enrichment_checkpoints",
        "006_github_api_telemetry",
        "007_local_accounts_sessions",
        "008_login_rate_limits",
        "009_csrf_contexts",
        "010_study_scoped_participant_categories",
        "011_multi_study_cardinality",
        "012_global_normalized_username",
    ];
    const executedMigrationIds = [];
    const client = {
        query: async sql => {
            if (sql.startsWith("SELECT migration_id")) {
                return {rows: appliedMigrationIds.map(appliedId => ({migration_id: appliedId}))};
            }
            const migration = managedMigrations.find(candidate => sql.includes(`VALUES ('${candidate.id}')`));
            if (migration) {
                executedMigrationIds.push(migration.id);
                appliedMigrationIds.push(migration.id);
            }
            return {rows: []};
        },
        release: () => {},
    };
    const pool = {connect: async () => client};

    await runStudyMigrations(pool, migrationId);
    await runStudyMigrations(pool, migrationId);

    assert.deepEqual(executedMigrationIds, [migrationId]);
});

test("migration 013 is transactional, prerequisite-guarded, and replay-safe", async () => {
    const migration = await readMigration();

    assert.match(migration, /^BEGIN;/);
    assert.match(migration, /012_global_normalized_username must be applied before 013_category_definition_color/);
    assert.match(
        migration,
        /INSERT INTO "labeler_migration" \("migration_id"\)[\s\S]*VALUES \('013_category_definition_color'\)[\s\S]*ON CONFLICT \("migration_id"\) DO NOTHING/,
    );
    assert.match(migration, /COMMIT;\s*$/);
});

test("migration 013 adds the definition and color_slot columns additively", async () => {
    const migration = await readMigration();
    const definitionPosition = migration.indexOf("ADD COLUMN IF NOT EXISTS \"definition\" TEXT");
    const colorSlotPosition = migration.indexOf("ADD COLUMN IF NOT EXISTS \"color_slot\" SMALLINT NOT NULL DEFAULT 0");

    assert.ok(definitionPosition !== -1, "definition must be added with ADD COLUMN IF NOT EXISTS");
    assert.ok(colorSlotPosition !== -1, "color_slot must be added with NOT NULL DEFAULT 0 so existing rows are filled");
    assert.ok(definitionPosition < colorSlotPosition);
    assert.doesNotMatch(migration, /SET NOT NULL/i, "the default must fill existing rows without a separate SET NOT NULL");
});

test("migration 013 backfills cyclic slots deterministically per study and participant", async () => {
    const migration = await readMigration();

    assert.match(
        migration,
        /ROW_NUMBER\(\) OVER \(PARTITION BY "study_id", "participant_id" ORDER BY "created_at", "id"\) - 1\) % 12/,
    );
    assert.match(migration, /UPDATE "participant_category" category[\s\S]*SET "color_slot" = ranked\."slot"/);
});

test("migration 013 adds the color_slot CHECK only through a pg_constraint catalog guard", async () => {
    const migration = await readMigration();

    assert.match(migration, /SELECT 1 FROM pg_constraint/);
    assert.match(migration, /conname = 'participant_category_color_slot_check'/);
    assert.match(migration, /conrelid = 'participant_category'::regclass/);
    assert.match(
        migration,
        /ADD CONSTRAINT "participant_category_color_slot_check"\s+CHECK \("color_slot" >= 0 AND "color_slot" < 12\)/,
    );
    assert.doesNotMatch(migration, /ADD CONSTRAINT IF NOT EXISTS/i);
});

test("migration 013 fails closed on an unexpected pre-existing column definition", async () => {
    const migration = await readMigration();
    const definitionGuard = migration.indexOf("Unexpected pre-existing definition column on participant_category");
    const colorGuard = migration.indexOf("Unexpected pre-existing color_slot column on participant_category");
    const definitionAdd = migration.indexOf("ADD COLUMN IF NOT EXISTS \"definition\" TEXT");
    const colorAdd = migration.indexOf("ADD COLUMN IF NOT EXISTS \"color_slot\" SMALLINT NOT NULL DEFAULT 0");

    assert.ok(definitionGuard !== -1, "the definition guard must reject unexpected pre-existing definitions");
    assert.ok(colorGuard !== -1, "the color_slot guard must reject unexpected pre-existing definitions");
    assert.ok(definitionGuard < definitionAdd, "the definition guard must run before the column is added");
    assert.ok(colorGuard < colorAdd, "the color_slot guard must run before the column is added");
    assert.match(migration, /existing_definition_type <> 'text'/);
    assert.match(migration, /existing_color_type <> 'smallint'/);
});

test("migration 013 performs no destructive data or object operations", async () => {
    const migration = await readMigration();

    assert.doesNotMatch(migration, /\b(?:DELETE|TRUNCATE)\b/i);
    assert.doesNotMatch(migration, /\bDROP\s+(?:TABLE|COLUMN|VIEW|TYPE)\b/i);
});
