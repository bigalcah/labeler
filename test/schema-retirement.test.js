import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {readLegacyInventory} from "../util/legacy-inventory.js";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const foundationPath = path.join(root, "schema/migrations/001_study_foundation.sql");
const retirementPath = path.join(root, "schema/migrations/002_retire_legacy_labeler.sql");
const enrichmentPath = path.join(root, "schema/migrations/004_github_pr_api_enrichment.sql");
const databaseDockerfilePath = path.join(root, "deployment/database/Dockerfile");

const normalize = value => value.replace(/\s+/g, " ").trim();

const dropPosition = (sql, kind, name) => {
    const position = sql.indexOf(`DROP ${kind} public."${name}"`);
    assert.notEqual(position, -1, `missing DROP ${kind} for ${name}`);
    return position;
};

test("clean initialization contains only the ledger and protected MVP tables", async () => {
    const [ foundation, dockerfile, inventory ] = await Promise.all([
        readFile(foundationPath, "utf8"),
        readFile(databaseDockerfilePath, "utf8"),
        readLegacyInventory(),
    ]);
    const createdTables = new Set(Array.from(
        foundation.matchAll(/CREATE TABLE IF NOT EXISTS (?:public\.)?"([^"]+)"/g),
        match => match[1],
    ));
    const expectedTables = new Set([
        "labeler_migration",
        ...inventory.inventory.protected.tables,
    ]);

    assert.deepEqual(createdTables, expectedTables);
    assert.ok(foundation.indexOf("CREATE TABLE IF NOT EXISTS \"reviewer\"")
        < foundation.indexOf("CREATE TABLE IF NOT EXISTS \"participant_category\""));
    assert.ok(foundation.indexOf("CREATE TABLE IF NOT EXISTS \"reviewer\"")
        < foundation.indexOf("CREATE TABLE IF NOT EXISTS \"study_participant\""));
    assert.match(foundation, /INSERT INTO (?:public\.)?"labeler_migration"\s*\("migration_id"\)\s*VALUES \('001_study_foundation'\)/);
    assert.doesNotMatch(foundation, /002_retire_legacy_labeler/);

    const compact = normalize(foundation);
    assert.match(compact, /UNIQUE \("id", "source_card_id"\)/);
    assert.match(compact, /CHECK \("expected_card_count" = 300\)/);
    assert.match(compact, /FOREIGN KEY \("pr_card_id", "source_card_id"\) REFERENCES "pr_cards" \("id", "source_card_id"\)/);
    assert.match(compact, /FOREIGN KEY \("category_id", "participant_id"\) REFERENCES "participant_category" \("id", "participant_id"\)/);
    for (const indexName of [
        "study_participant_reviewer_idx",
        "study_card_pr_card_idx",
        "pr_cards_repository_pr_number_idx",
        "pr_classification_participant_updated_idx",
        "pr_classification_card_participant_uidx",
    ]) {
        assert.match(foundation, new RegExp(`CREATE (?:UNIQUE )?INDEX IF NOT EXISTS "${indexName}"`));
    }

    assert.match(dockerfile, /COPY schema\/migrations\/001_study_foundation\.sql/);
    assert.doesNotMatch(dockerfile, /schema\/0[1-6]_/);
    assert.doesNotMatch(dockerfile, /init-data/);
    assert.doesNotMatch(dockerfile, /002_retire_legacy_labeler/);
});

test("GitHub enrichment backfill aggregates UUID memberships without MIN(uuid)", async () => {
    const migration = await readFile(enrichmentPath, "utf8");

    assert.doesNotMatch(migration, /MIN\(\s*"study_id"\s*\)/);
    assert.equal((migration.match(/array_agg\(DISTINCT "study_id" ORDER BY "study_id"\)/g) || []).length, 4);
    assert.equal((migration.match(/array_agg\(sc\."study_id" ORDER BY sc\."study_id"\)/g) || []).length, 2);
});

test("retirement migration drops exactly the inventory allowlist with explicit qualified statements", async () => {
    const [ migration, inventory ] = await Promise.all([
        readFile(retirementPath, "utf8"),
        readLegacyInventory(),
    ]);
    const relationDrops = [...migration.matchAll(/DROP (TABLE|VIEW|TYPE) public\."([^"]+)";/g)];
    const routineDrops = [...migration.matchAll(/DROP (FUNCTION|PROCEDURE) public\."([^"]+)"\(([^;]*)\);/g)];
    const names = (matches, kind) => new Set(matches
        .filter(match => match[1] === kind)
        .map(match => match[2]));

    assert.deepEqual(names(relationDrops, "TABLE"), new Set(inventory.inventory.database.tables));
    assert.deepEqual(names(relationDrops, "VIEW"), new Set(inventory.inventory.database.views));
    assert.deepEqual(names(relationDrops, "TYPE"), new Set(inventory.inventory.database.types));
    assert.deepEqual(names(routineDrops, "FUNCTION"), new Set(inventory.inventory.database.functions));
    assert.deepEqual(names(routineDrops, "PROCEDURE"), new Set(inventory.inventory.database.procedures));
    assert.doesNotMatch(migration, /\bCASCADE\b/i);
    assert.doesNotMatch(migration, /DROP\s+(?:TABLE|VIEW|TYPE|FUNCTION|PROCEDURE)\s+IF EXISTS/i);
    assert.doesNotMatch(migration, /DROP\s+(?:TABLE|VIEW|TYPE|FUNCTION|PROCEDURE)\s+(?!public\.)/i);

    const droppedNames = new Set([ ...relationDrops, ...routineDrops ].map(match => match[2]));
    for (const protectedTable of inventory.inventory.protected.tables) {
        assert.equal(droppedNames.has(protectedTable), false);
    }

    const actualSignatures = new Map(routineDrops.map(match => [
        `${match[1]}:${match[2]}`,
        normalize(match[3]).replaceAll(" ", "").toLowerCase(),
    ]));
    assert.deepEqual(actualSignatures, new Map([
        [ "PROCEDURE:conflict_resolution_review", "integer,public.\"conflict\"[],integer[],boolean,text" ],
        [ "PROCEDURE:conflict_resolution_discard", "integer,public.\"conflict\"[],text" ],
        [ "PROCEDURE:label_merge", "text,text" ],
        [ "PROCEDURE:label_rename", "text,text" ],
        [ "PROCEDURE:label_remove", "integer" ],
        [ "FUNCTION:label_distribution_reviewer", "integer" ],
        [ "FUNCTION:label_distribution_category", "integer" ],
        [ "FUNCTION:instance_discard_details", "integer" ],
        [ "FUNCTION:instance_review_details", "integer" ],
        [ "FUNCTION:next_instance", "integer" ],
        [ "FUNCTION:instance_review_bucket_threshold", "" ],
    ]));
});

test("retirement migration enforces protected catalog preconditions and reverse dependency order", async () => {
    const [ migration, inventory ] = await Promise.all([
        readFile(retirementPath, "utf8"),
        readLegacyInventory(),
    ]);
    const protectedValues = migration.match(/FROM \(VALUES(?<values>[\s\S]*?)\) AS protected_table\(name\)/);
    assert.ok(protectedValues?.groups?.values);
    const protectedNames = new Set(Array.from(
        protectedValues.groups.values.matchAll(/\('([^']+)'\)/g),
        match => match[1],
    ));
    assert.deepEqual(protectedNames, new Set(inventory.inventory.protected.tables));
    assert.match(migration, /pg_advisory_xact_lock\(hashtext\('labeler:retire-legacy-labeler'\)\)/);
    assert.match(migration, /to_regclass\('public\.labeler_migration'\) IS NULL/);

    const firstView = Math.min(...inventory.inventory.database.views.map(name => dropPosition(migration, "VIEW", name)));
    const lastRoutine = Math.max(
        ...inventory.inventory.database.functions.map(name => dropPosition(migration, "FUNCTION", name)),
        ...inventory.inventory.database.procedures.map(name => dropPosition(migration, "PROCEDURE", name)),
    );
    const lastView = Math.max(...inventory.inventory.database.views.map(name => dropPosition(migration, "VIEW", name)));
    const firstTable = Math.min(...inventory.inventory.database.tables.map(name => dropPosition(migration, "TABLE", name)));
    const lastTable = Math.max(...inventory.inventory.database.tables.map(name => dropPosition(migration, "TABLE", name)));
    const typePosition = dropPosition(migration, "TYPE", "conflict");
    assert.ok(lastRoutine < firstView);
    assert.ok(lastView < firstTable);
    assert.ok(lastTable < typePosition);

    for (const [ dependent, dependency ] of [
        [ "instance_discard_export", "instance_review_conflict" ],
        [ "instance_review_finished_export", "instance_review_conflict" ],
        [ "instance_review_finished_export", "instance_review_finished" ],
        [ "instance_review_conflict", "instance_review_conflict_label" ],
        [ "instance_review_conflict", "instance_review_conflict_outcome" ],
        [ "reviewer_progress", "reviewer_review_progress" ],
        [ "reviewer_progress", "reviewer_discard_progress" ],
        [ "instance_review_bucket_filled", "instance_review_bucket" ],
        [ "instance_review_bucket", "instance_review_finished" ],
        [ "instance_review_bucket", "categories" ],
    ]) {
        assert.ok(dropPosition(migration, "VIEW", dependent) < dropPosition(migration, "VIEW", dependency));
    }
    for (const [ dependent, dependency ] of [
        [ "instance_review_label", "instance_review" ],
        [ "instance_review_label", "label" ],
        [ "instance_review_conflict_resolution", "instance" ],
        [ "instance_discard", "instance" ],
        [ "instance_review", "instance" ],
    ]) {
        assert.ok(dropPosition(migration, "TABLE", dependent) < dropPosition(migration, "TABLE", dependency));
    }

    const ledgerInsert = migration.indexOf("INSERT INTO public.\"labeler_migration\"");
    assert.ok(typePosition < ledgerInsert);
    assert.match(migration, /VALUES \('002_retire_legacy_labeler'\)/);
});
