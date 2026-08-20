import {readFile} from "node:fs/promises";

const migrationUrl = new URL("../schema/migrations/001_study_foundation.sql", import.meta.url);

const applyStudySchema = async client => {
    const sql = await readFile(migrationUrl, "utf8");
    await client.query(sql);
};

export {applyStudySchema};
