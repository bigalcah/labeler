import assert from "node:assert/strict";
import {randomUUID, createHash} from "node:crypto";
import {readFile} from "node:fs/promises";
import pg from "pg";
import {guardRetirementDatabase} from "../../util/legacy-retirement.js";
import {managedMigrations, runStudyMigrations} from "../../util/study-schema.js";
import {startCopilot369Database, closeCopilot369Database} from "./copilot-369-fixture.js";

const startNormalizationDatabase = async ({retired = false, through} = {}) => {
    const database = await startCopilot369Database({throughMigration: "001_study_foundation"});
    if (!retired) {
        await runStudyMigrations(database.pool, through);
        return {...database, close: () => closeCopilot369Database(database)};
    }
    const databaseName = `normalization_${randomUUID().replaceAll("-", "")}`;
    let pool;
    try {
        await database.pool.query(`CREATE DATABASE "${databaseName}"`);
        pool = new pg.Pool({...database.pool.options, database: databaseName, max: 2});
        for (const name of ["01_definitions_schema", "02_definitions_function", "03_definitions_procedure",
            "04_definitions_view", "05_implementations_function", "06_implementations_procedure"]) {
            await pool.query(await readFile(new URL(`../../schema/${name}.sql`, import.meta.url), "utf8"));
        }
        await runStudyMigrations(pool, "001_study_foundation");
        const inventory = JSON.parse(await readFile(new URL("../../schema/migrations/legacy-labeler-inventory.json", import.meta.url), "utf8"));
        const client = await pool.connect();
        try {
            await client.query("BEGIN");
            assert.equal(await guardRetirementDatabase(client, inventory), "ready");
            await client.query("ROLLBACK");
        } finally {
            client.release();
        }
        await pool.query(await readFile(new URL("../../schema/migrations/002_retire_legacy_labeler.sql", import.meta.url), "utf8"));
        await runStudyMigrations(pool, through);
        return {pool, containerName: database.containerName, close: async () => {
            await pool.end();
            await closeCopilot369Database(database);
        }};
    } catch (error) {
        if (pool) await pool.end();
        await closeCopilot369Database(database);
        throw error;
    }
};

const fingerprintNormalizationRows = async pool => {
    const {rows: tables} = await pool.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename");
    const rows = {};
    for (const {tablename} of tables) {
        const filter = tablename === "labeler_migration" ? " WHERE migration_id <> '015_normalize_retired_study_schema'" : "";
        rows[tablename] = (await pool.query(`SELECT to_jsonb(record) AS row FROM public."${tablename}" record${filter}
            ORDER BY to_jsonb(record)::text`)).rows;
    }
    return createHash("sha256").update(JSON.stringify(rows)).digest("hex");
};

const seedNormalizationDecisions = async pool => {
    await pool.query(`INSERT INTO participant_category(study_id, participant_id, raw_name, normalized_name)
        SELECT study_id, reviewer_id, 'normalization fixture', 'normalization fixture'
        FROM study_participant WHERE ordinal = 0 ON CONFLICT DO NOTHING`);
    await pool.query(`INSERT INTO pr_classification(pr_card_id, participant_id, category_id, study_id, remarks)
        SELECT card.pr_card_id, participant.reviewer_id, category.id, card.study_id, 'preserve this decision'
        FROM study_card card JOIN study_participant participant ON participant.study_id = card.study_id AND participant.ordinal = 0
        JOIN participant_category category ON category.study_id = card.study_id AND category.participant_id = participant.reviewer_id
        WHERE card.ordinal = 0 AND category.normalized_name = 'normalization fixture' ON CONFLICT DO NOTHING`);
    await pool.query(`INSERT INTO pr_discard(pr_card_id, participant_id, study_id, reason)
        SELECT card.pr_card_id, participant.reviewer_id, card.study_id, 'preserve this discard'
        FROM study_card card JOIN study_participant participant ON participant.study_id = card.study_id AND participant.ordinal = 2
        WHERE card.ordinal = 2 ON CONFLICT DO NOTHING`);
};

export {fingerprintNormalizationRows, managedMigrations, seedNormalizationDecisions, startNormalizationDatabase};
