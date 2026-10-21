import assert from "node:assert/strict";
import test from "node:test";
import {createHash} from "node:crypto";
import {copyFile, mkdir, mkdtemp, readFile, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {pathToFileURL} from "node:url";
import {assertLedgerState, managedMigrations} from "../util/study-schema.js";

const managed = managedMigrations.map(migration => migration.id);
const normalization = "015_normalize_retired_study_schema";
const retirement = "002_retire_legacy_labeler";

test("ledger accepts every known prefix when normalization is absent", () => {
    for (let length = 0; length <= managed.length; length += 1) {
        const prefix = managed.slice(0, length);
        assert.doesNotThrow(() => assertLedgerState(prefix));
        if (length) assert.doesNotThrow(() => assertLedgerState([prefix[0], retirement, ...prefix.slice(1)]));
    }
});

test("015 and retirement source pins reject changed bytes independently of managed pins", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "normalization-pin-"));
    try {
        await mkdir(path.join(root, "util"));
        await mkdir(path.join(root, "schema/migrations"), {recursive: true});
        await copyFile(new URL("../util/study-ledger.js", import.meta.url), path.join(root, "util/study-ledger.mjs"));
        for (const name of ["study-normalization-contract.json", "copilot-369-schema-contract.json"]) {
            await copyFile(new URL(`../util/${name}`, import.meta.url), path.join(root, "util", name));
        }
        for (const name of ["015_normalize_retired_study_schema", "002_retire_legacy_labeler"]) {
            await copyFile(new URL(`../schema/migrations/${name}.sql`, import.meta.url), path.join(root, "schema/migrations", `${name}.sql`));
        }
        const {readNormalizationSource} = await import(pathToFileURL(path.join(root, "util/study-ledger.mjs")));
        const source = await readNormalizationSource();
        assert.equal(createHash("sha256").update(source.sql).digest("hex"), source.contract.migration.sha256);
        for (const name of ["015_normalize_retired_study_schema", "002_retire_legacy_labeler"]) {
            const file = path.join(root, "schema/migrations", `${name}.sql`);
            const bytes = await readFile(file);
            await writeFile(file, Buffer.concat([bytes, Buffer.from("\n")]));
            await assert.rejects(readNormalizationSource(), /source pin mismatch/);
            await writeFile(file, bytes);
        }
        assert.equal((await readNormalizationSource()).sql, source.sql);
    } finally {
        await rm(root, {recursive: true, force: true});
    }
});

test("ledger accepts external normalization only after the complete managed prefix", () => {
    assert.doesNotThrow(() => assertLedgerState([...managed, normalization]));
    assert.doesNotThrow(() => assertLedgerState([managed[0], retirement, ...managed.slice(1), normalization]));
});

test("ledger rejects duplicate, unknown, gapped and reordered histories", () => {
    const invalid = [
        [managed[0], managed[0]],
        [managed[0], retirement, retirement],
        [managed[1], managed[0]],
        [managed[0], managed[2]],
        [managed[0], managed[1], retirement],
        [...managed.slice(0, -1), normalization],
        [normalization, ...managed],
        [...managed, normalization, normalization],
        [...managed, "016_unapproved"],
    ];
    for (const ids of invalid) assert.throws(() => assertLedgerState(ids), /migration|Migration/);
});
