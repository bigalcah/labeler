import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";
import {managedMigrations, runStudyMigrations} from "../util/study-schema.js";

const migrationUrl = new URL(
    "../schema/migrations/010_study_scoped_participant_categories.sql",
    import.meta.url,
);
const readMigration = () => readFile(migrationUrl, "utf8");

test("migration 010 is registered immediately after 009", () => {
    const migrationIds = managedMigrations.map(migration => migration.id);
    const migrationIndex = migrationIds.indexOf("010_study_scoped_participant_categories");

    assert.deepEqual(migrationIds.slice(migrationIndex - 1, migrationIndex + 1), [
        "009_csrf_contexts",
        "010_study_scoped_participant_categories",
    ]);
});

test("migration runner applies migration 010 once after 009", async () => {
    const appliedMigrationIds = [
        "001_study_foundation",
        "003_private_pr_discard",
        "004_github_pr_api_enrichment",
        "005_github_enrichment_checkpoints",
        "006_github_api_telemetry",
        "007_local_accounts_sessions",
        "008_login_rate_limits",
        "009_csrf_contexts",
    ];
    const executedMigrationIds = [];
    const client = {
        query: async sql => {
            if (sql.startsWith("SELECT migration_id")) {
                return {rows: appliedMigrationIds.map(migration_id => ({migration_id}))};
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

    await runStudyMigrations(pool, "010_study_scoped_participant_categories");
    await runStudyMigrations(pool, "010_study_scoped_participant_categories");

    assert.deepEqual(executedMigrationIds, ["010_study_scoped_participant_categories"]);
});

test("migration 010 is transactional, prerequisite-guarded, and replay-safe", async () => {
    const migration = await readMigration();

    assert.match(migration, /^BEGIN;/);
    assert.match(migration, /009_csrf_contexts must be applied before 010_study_scoped_participant_categories/);
    assert.match(
        migration,
        /INSERT INTO "labeler_migration" \("migration_id"\)[\s\S]*VALUES \('010_study_scoped_participant_categories'\)[\s\S]*ON CONFLICT \("migration_id"\) DO NOTHING/,
    );
    assert.match(migration, /COMMIT;\s*$/);
});

test("migration 010 preserves classified categories while splitting shared ownership deterministically", async () => {
    const migration = await readMigration();

    assert.match(migration, /FROM "pr_classification"/);
    assert.match(migration, /SELECT DISTINCT "category_id", "participant_id", "study_id"/);
    assert.match(migration, /classification\."participant_id" = category\."participant_id"/);
    assert.match(migration, /ROW_NUMBER\(\) OVER \(PARTITION BY category\."id" ORDER BY classification\."study_id"\)/);
    assert.match(
        migration,
        /UPDATE "pr_classification" classification[\s\S]*SET "category_id" = mapping\."scoped_category_id"[\s\S]*classification\."study_id" = mapping\."study_id"/,
    );
    assert.match(
        migration,
        /INSERT INTO "participant_category"[\s\S]*"raw_name"[\s\S]*"normalized_name"[\s\S]*"created_at"[\s\S]*"updated_at"/,
    );
});

test("migration 010 fails closed before assigning ambiguous unclassified categories", async () => {
    const migration = await readMigration();
    const guardPosition = migration.indexOf("Cannot scope unclassified participant categories");
    const assignmentPosition = migration.indexOf("UPDATE \"participant_category\" category", guardPosition);

    assert.match(migration, /WHERE category\."study_id" IS NULL/);
    assert.match(migration, /HAVING COUNT\(DISTINCT participant\."study_id"\) <> 1/);
    assert.match(migration, /Cannot scope unclassified participant categories/);
    assert.ok(guardPosition < assignmentPosition);
    assert.match(migration, /ALTER COLUMN "study_id" SET NOT NULL/);
});

test("migration 010 enforces study-scoped category identity and classification ownership", async () => {
    const migration = await readMigration();

    assert.match(migration, /DROP CONSTRAINT IF EXISTS "participant_category_participant_id_normalized_name_key"/);
    assert.match(migration, /UNIQUE \("study_id", "participant_id", "normalized_name"\)/);
    assert.match(migration, /UNIQUE \("id", "study_id", "participant_id"\)/);
    assert.match(
        migration,
        /FOREIGN KEY \("study_id", "participant_id"\)[\s\S]*REFERENCES "study_participant" \("study_id", "reviewer_id"\)/,
    );
    assert.match(
        migration,
        /FOREIGN KEY \("category_id", "study_id", "participant_id"\)[\s\S]*REFERENCES "participant_category" \("id", "study_id", "participant_id"\)/,
    );
});

test("migration 010 performs no destructive data or object operations", async () => {
    const migration = await readMigration();

    assert.doesNotMatch(migration, /\b(?:DELETE|TRUNCATE)\b/i);
    assert.doesNotMatch(migration, /\bDROP\s+(?:TABLE|COLUMN|VIEW|TYPE)\b/i);
});
