import assert from "node:assert/strict";
import {access, readFile} from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
    computeInventoryHash,
    readLegacyInventory,
    validateLegacyInventory,
} from "../util/legacy-inventory.js";

const root = path.resolve(new URL("..", import.meta.url).pathname);

test("authoritative inventory covers legacy consensus and protected MVP objects", async () => {
    const inventory = await readLegacyInventory();

    assert.equal(computeInventoryHash(inventory.inventory), inventory.inventorySha256);
    assert.deepEqual(inventory.inventory.database.tables, [
        "instance",
        "label",
        "instance_review",
        "instance_discard",
        "instance_review_label",
        "instance_review_conflict_resolution",
    ]);
    assert.ok(inventory.inventory.database.procedures.includes("conflict_resolution_discard"));
    assert.ok(inventory.inventory.database.procedures.includes("conflict_resolution_review"));
    assert.ok(inventory.inventory.database.views.includes("instance_review_conflict_resolution_export"));
    assert.deepEqual(inventory.inventory.protected.tables, [
        "reviewer",
        "pr_cards",
        "study",
        "study_participant",
        "study_card",
        "participant_category",
        "pr_classification",
    ]);
});

test("inventory validation fails closed when authoritative content drifts", async () => {
    const inventory = await readLegacyInventory();
    const drifted = structuredClone(inventory);
    drifted.inventory.database.tables.pop();

    assert.throws(() => validateLegacyInventory(drifted), /hash mismatch/);
});

test("inventory database names match every legacy SQL definition", async () => {
    const inventory = await readLegacyInventory();
    const source = (await Promise.all(inventory.inventory.database.sources.map(relativePath =>
        readFile(path.join(root, relativePath), "utf8")))).join("\n");
    const names = kind => new Set(Array.from(
        source.matchAll(new RegExp(`CREATE(?: OR REPLACE)? ${kind}\\s+"([^"]+)"`, "g")),
        match => match[1],
    ));

    assert.deepEqual(names("TYPE"), new Set(inventory.inventory.database.types));
    assert.deepEqual(names("FUNCTION"), new Set(inventory.inventory.database.functions));
    assert.deepEqual(names("PROCEDURE"), new Set(inventory.inventory.database.procedures));
    assert.deepEqual(names("VIEW"), new Set(inventory.inventory.database.views));
    assert.deepEqual(
        names("TABLE"),
        new Set([ ...inventory.inventory.database.tables, ...inventory.inventory.protected.tables ]),
    );
});

test("inventory records removed consumers and existing protected runtime paths", async () => {
    const inventory = await readLegacyInventory();
    await Promise.all([
        ...inventory.inventory.runtime.retiredRoutes.map(relativePath =>
            assert.rejects(access(path.join(root, relativePath)), {code: "ENOENT"})),
        ...inventory.inventory.runtime.retiredViews.map(relativePath =>
            assert.rejects(access(path.join(root, relativePath)), {code: "ENOENT"})),
        ...inventory.inventory.protected.runtimePaths.map(relativePath => access(path.join(root, relativePath))),
    ]);
    const packageDocument = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
    for (const dependency of inventory.inventory.runtime.retiredPackageDependencies) {
        assert.equal(packageDocument.dependencies[dependency], undefined);
    }
});
