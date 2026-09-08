import assert from "node:assert/strict";
import test from "node:test";

const baseUrl = process.env.STUDY_E2E_BASE_URL;
if (!baseUrl) throw new Error("STUDY_E2E_BASE_URL is required; configure a current-runtime deployment");

test("current-runtime E2E exposes healthy application status", async () => {
    const response = await fetch(`${baseUrl}/actuator/health`);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).status, "UP");
});
