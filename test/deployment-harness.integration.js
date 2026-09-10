import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import test from "node:test";

test("isolated clean and existing deployment scenarios preserve state and reject unsafe inputs", () => {
    const result = spawnSync("sh", ["scripts/test-study-deployment.sh"], {
        encoding: "utf8",
        maxBuffer: 16 * 1024 * 1024,
        timeout: 15 * 60 * 1000,
    });
    const evidence = `${result.stdout}\n${result.stderr}`;

    assert.equal(result.status, 0, evidence);
    assert.match(result.stdout, /DEPLOYMENT_HARNESS_OK/);
});
