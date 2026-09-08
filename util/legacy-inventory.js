import {createHash} from "node:crypto";
import {readFile} from "node:fs/promises";

const inventoryUrl = new URL("../schema/migrations/legacy-labeler-inventory.json", import.meta.url);

class LegacyInventoryError extends Error {
    constructor(message) {
        super(message);
        this.name = "LegacyInventoryError";
    }
}

const canonicalize = value => {
    if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
    if (value && typeof value === "object") {
        return `{${Object.keys(value).sort().map(key =>
            `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`;
    }
    return JSON.stringify(value);
};

const computeInventoryHash = inventory => createHash("sha256")
    .update(canonicalize(inventory))
    .digest("hex");

const validateLegacyInventory = document => {
    if (document?.inventoryVersion !== 1 || !document.inventory || typeof document.inventory !== "object") {
        throw new LegacyInventoryError("Unsupported legacy inventory document");
    }
    const actualHash = computeInventoryHash(document.inventory);
    if (document.inventorySha256 !== actualHash) {
        throw new LegacyInventoryError(
            `Legacy inventory hash mismatch: expected ${document.inventorySha256}, computed ${actualHash}`,
        );
    }
    return document;
};

const readLegacyInventory = async (url = inventoryUrl) => {
    let document;
    try {
        document = JSON.parse(await readFile(url, "utf8"));
    } catch (error) {
        throw new LegacyInventoryError(`Legacy inventory is not readable JSON: ${error.message}`);
    }
    return validateLegacyInventory(document);
};

export {
    LegacyInventoryError,
    computeInventoryHash,
    readLegacyInventory,
    validateLegacyInventory,
};
