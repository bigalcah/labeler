import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const workflowPath = path.join(root, ".github/workflows/pr-validation.yml");
const readWorkflow = async () => {
    try {
        return await readFile(workflowPath, "utf8");
    } catch (error) {
        if (error.code === "ENOENT") {
            assert.fail("A mandatory .github/workflows/pr-validation.yml workflow is required for pull requests.");
        }
        throw error;
    }
};

test("the mandatory PR validation workflow runs complete, fail-closed gates", async () => {
    const workflow = await readWorkflow();

    assert.match(workflow, /^on:\s*\n\s*pull_request:\s*$/m, "workflow must run for every pull request without path filters");
    for (const command of [
        /npm ci/,
        /npm run lint(?:\s|$)/,
        /npm run test:unit(?:\s|$)/,
        /openspec validate ["']?card-sorting-prs-mvp["']? --strict/,
        /docker compose .*--env-file .* -f deployment\/docker-compose\.yml config/,
        /hadolint .*deployment\/server\/Dockerfile.*deployment\/database\/Dockerfile/,
    ]) {
        assert.match(workflow, command, `workflow must run ${command}`);
    }
    const composeUp = workflow.search(/docker compose .*up(?:\s|$)/);
    const integration = workflow.search(/npm run test:integration(?:\s|$)/);
    const e2e = workflow.search(/npm run test:e2e(?:\s|$)/);

    assert.ok(composeUp >= 0, "workflow must create an ephemeral runtime");
    assert.ok(integration > composeUp, "integration must run only after the ephemeral runtime exists");
    assert.ok(e2e > composeUp, "E2E must run only after the ephemeral runtime exists");

    assert.doesNotMatch(workflow, /\$\{\{\s*secrets\./i, "ephemeral CI must not require repository secrets");
    assert.doesNotMatch(workflow, /continue-on-error:\s*true/i, "required gates must preserve failure status");
    assert.doesNotMatch(workflow, /\|\|\s*true\b/, "required gates must preserve command exit codes");
    assert.doesNotMatch(workflow, /\bset\s*\+e\b/, "required gates must preserve command exit codes");
    assert.doesNotMatch(workflow, /\bexit\s+0\b/, "required gates must preserve command exit codes");
});
