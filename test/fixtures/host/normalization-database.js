import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {closeCopilot369Database, startCopilot369Database} from "../../support/copilot-369-fixture.js";
import {runStudyMigrations} from "../../../util/study-schema.js";
import {guardRetirementDatabase} from "../../../util/legacy-retirement.js";

const startHostNormalizationDatabase = async () => {
    const database = await startCopilot369Database({throughMigration: "001_study_foundation"});
    try {
        await database.pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public");
        for (const name of ["01_definitions_schema", "02_definitions_function", "03_definitions_procedure",
            "04_definitions_view", "05_implementations_function", "06_implementations_procedure"]) {
            await database.pool.query(await readFile(new URL(`../../../schema/${name}.sql`, import.meta.url), "utf8"));
        }
        await runStudyMigrations(database.pool, "001_study_foundation");
        const inventory = JSON.parse(await readFile(new URL("../../../schema/migrations/legacy-labeler-inventory.json", import.meta.url), "utf8"));
        const client = await database.pool.connect();
        try {
            await client.query("BEGIN");
            assert.equal(await guardRetirementDatabase(client, inventory), "ready");
            await client.query("ROLLBACK");
        } finally {
            client.release();
        }
        await database.pool.query(await readFile(new URL("../../../schema/migrations/002_retire_legacy_labeler.sql", import.meta.url), "utf8"));
        await runStudyMigrations(database.pool);
        return database;
    } catch (error) {
        await closeCopilot369Database(database);
        throw error;
    }
};

export {startHostNormalizationDatabase};
