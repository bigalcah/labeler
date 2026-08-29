import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {mkdtemp, rm, writeFile} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {readLegacyInventory} from "../util/legacy-inventory.js";
import {
    assessRetirementState,
    checkRetirementReadiness,
    guardRetirementDatabase,
} from "../util/legacy-retirement.js";

const objectRows = (inventory, legacyPresent = true) => [
    ...inventory.inventory.database.tables.map(name => ({kind: "table", name, present: legacyPresent})),
    ...inventory.inventory.database.views.map(name => ({kind: "view", name, present: legacyPresent})),
    ...inventory.inventory.database.functions.map(name => ({kind: "function", name, present: legacyPresent})),
    ...inventory.inventory.database.procedures.map(name => ({kind: "procedure", name, present: legacyPresent})),
    ...inventory.inventory.database.types.map(name => ({kind: "type", name, present: legacyPresent})),
    ...inventory.inventory.protected.tables.map(name => ({kind: "protected-table", name, present: true})),
];

test("database state is ready only when every legacy and protected object exists", async () => {
    const inventory = await readLegacyInventory();

    assert.equal(assessRetirementState(objectRows(inventory), false, inventory), "ready");
});

test("database state accepts a clean schema only with an applied migration ledger", async () => {
    const inventory = await readLegacyInventory();

    assert.equal(assessRetirementState(objectRows(inventory, false), true, inventory), "already-retired");
    assert.throws(
        () => assessRetirementState(objectRows(inventory, false), false, inventory),
        /clean schema has no migration ledger entry/,
    );
});

test("database state fails closed for missing protected objects and partial legacy state", async () => {
    const inventory = await readLegacyInventory();
    const missingProtected = objectRows(inventory);
    missingProtected.find(row => row.name === "study").present = false;
    assert.throws(() => assessRetirementState(missingProtected, false, inventory), /protected objects missing: study/);

    const partialLegacy = objectRows(inventory);
    partialLegacy.find(row => row.name === "instance_review_conflict_resolution").present = false;
    assert.throws(() => assessRetirementState(partialLegacy, false, inventory), /partial legacy schema/);
    assert.throws(
        () => assessRetirementState(objectRows(inventory), true, inventory),
        /ledger marks retirement applied but legacy objects remain/,
    );
});

test("retirement readiness validates backup checksum before connecting to PostgreSQL", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "labeler-retirement-test-"));
    const archivePath = path.join(directory, "legacy.dump");
    const manifestPath = path.join(directory, "legacy.manifest.json");
    const inventory = await readLegacyInventory();
    const database = {host: "db", port: "5432", database: "labeling", user: "labeler"};
    await writeFile(archivePath, "archive-content");
    await writeFile(manifestPath, JSON.stringify({
        manifestVersion: 1,
        archiveFile: path.basename(archivePath),
        archiveSha256: createHash("sha256").update("different-content").digest("hex"),
        inventorySha256: inventory.inventorySha256,
        createdAt: "2026-08-20T00:00:00.000Z",
        format: "custom",
        dataOnly: true,
        database,
        tables: inventory.inventory.backup.tables,
    }));
    let connected = false;

    try {
        await assert.rejects(() => checkRetirementReadiness({
            pool: {
                connect: async () => {
                    connected = true;
                    throw new Error("must not connect");
                },
            },
            archivePath,
            manifestPath,
            inventory,
            expectedDatabase: database,
            runCommand: async () => {},
        }), /archive checksum mismatch/);
        assert.equal(connected, false);
    } finally {
        await rm(directory, {recursive: true});
    }
});

test("retirement readiness reaches ready state through backup and database guards without DROP", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "labeler-retirement-test-"));
    const archivePath = path.join(directory, "legacy.dump");
    const manifestPath = path.join(directory, "legacy.manifest.json");
    const inventory = await readLegacyInventory();
    const database = {host: "db", port: "5432", database: "labeling", user: "labeler"};
    const archive = "custom-archive";
    await writeFile(archivePath, archive);
    await writeFile(manifestPath, JSON.stringify({
        manifestVersion: 1,
        archiveFile: path.basename(archivePath),
        archiveSha256: createHash("sha256").update(archive).digest("hex"),
        inventorySha256: inventory.inventorySha256,
        createdAt: "2026-08-20T00:00:00.000Z",
        format: "custom",
        dataOnly: true,
        database,
        tables: inventory.inventory.backup.tables,
    }));
    const commands = [];
    const client = {
        query: async sql => {
            commands.push(sql);
            if (sql === "BEGIN" || sql === "COMMIT") return {rows: []};
            if (sql.includes("pg_advisory_xact_lock")) return {rows: []};
            if (sql.includes("retirement object inventory")) return {rows: objectRows(inventory)};
            if (sql.includes("to_regclass")) return {rows: [ {ledger_exists: true} ]};
            if (sql.includes("labeler_migration")) return {rows: [ {applied: false} ]};
            throw new Error(`Unexpected query: ${sql}`);
        },
        release: () => {},
    };

    try {
        const state = await checkRetirementReadiness({
            pool: {connect: async () => client},
            archivePath,
            manifestPath,
            inventory,
            expectedDatabase: database,
            runCommand: async () => {},
        });

        assert.equal(state, "ready");
        assert.equal(commands.some(sql => /^\s*DROP\b/i.test(sql)), false);
        assert.equal(commands.at(-1), "COMMIT");
    } finally {
        await rm(directory, {recursive: true});
    }
});

test("database guard acquires the advisory lock and emits no DROP before a failed prerequisite", async () => {
    const inventory = await readLegacyInventory();
    const commands = [];
    const client = {
        query: async (sql, parameters) => {
            commands.push(sql);
            if (sql.includes("pg_advisory_xact_lock")) return {rows: []};
            if (sql.includes("retirement object inventory")) return {rows: objectRows(inventory).map(row => ({...row, present: row.name !== "reviewer"}))};
            if (sql.includes("to_regclass")) return {rows: [ {ledger_exists: true} ]};
            if (sql.includes("labeler_migration")) return {rows: [ {applied: false} ]};
            throw new Error(`Unexpected query: ${sql} ${parameters}`);
        },
    };

    await assert.rejects(() => guardRetirementDatabase(client, inventory), /protected objects missing: reviewer/);
    assert.match(commands[0], /pg_advisory_xact_lock/);
    assert.equal(commands.some(sql => /^\s*DROP\b/i.test(sql)), false);
});
