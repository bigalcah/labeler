import assert from "node:assert/strict";
import test from "node:test";

test("deliberate gate failure", () => {
    assert.equal(true, false);
});
