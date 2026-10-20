import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const readWorkflow = name => readFile(path.join(root, ".github/workflows", name), "utf8");
const stepScript = (workflow, name) => {
    const step = workflow.split(`      - name: ${name}\n`)[1];
    assert.ok(step, `missing workflow step: ${name}`);
    return step.split(/^\s{6}- name: /m)[0];
};
const maskedFailure = /\|\|\s*(?:true\b|:(?=\s|$)|exit\s+0\b)/m;
const assertMandatory = step => {
    assert.doesNotMatch(step, /^\s+if:|continue-on-error:/m);
    assert.doesNotMatch(step, maskedFailure);
    assert.match(step, /\brun:/);
};

test("Given the reusable validation workflow When gates run Then lint, unit, OpenSpec, Docker, and isolated runtime are mandatory", async () => {
    const shared = await readWorkflow("shared-validation.yml");
    const requiredSteps = [
        "Install dependencies",
        "Build a local server image for Docker-backed tests",
        "Run the complete lint gate",
        "Run the complete unit selection sequentially",
        "Install pinned OpenSpec CLI",
        "Verify the OpenSpec CLI version",
        "Validate every active OpenSpec artifact strictly",
        "Lint both Dockerfiles",
        "Run isolated 369/30 release, integration, security, export, and preservation gates",
    ];

    assert.match(shared, /^on:\s*\n\s{2}workflow_call:\s*$/m);
    assert.match(shared, /^permissions:\s*\n\s{2}contents: read$/m);
    for (const name of requiredSteps) assertMandatory(stepScript(shared, name));
    const testImage = stepScript(shared, "Build a local server image for Docker-backed tests");
    assert.match(testImage, /docker build --file deployment\/server\/Dockerfile --tag "\$image" \./);
    assert.match(testImage, /LABELER_READINESS_TEST_IMAGE=/);
    assert.match(stepScript(shared, "Install pinned OpenSpec CLI"), /@fission-ai\/openspec@1\.9\.0/);
    assert.match(stepScript(shared, "Verify the OpenSpec CLI version"), /test "\$\(openspec --version\)" = "1\.9\.0"/);
    assert.match(stepScript(shared, "Validate every active OpenSpec artifact strictly"),
        /openspec validate --all --strict --no-interactive --json/);
    assert.match(stepScript(shared, "Run isolated 369/30 release, integration, security, export, and preservation gates"),
        /npm run test:deployment/);
    assert.match(shared, /HARNESS_EVIDENCE_DIR: \$\{\{ runner\.temp \}\}\/labeler-validation-evidence/);
    assert.doesNotMatch(shared, /\$\{\{\s*secrets\.|continue-on-error:|\bset\s+\+e\b|\|\|\s*true\b/);
    assert.deepEqual([...shared.matchAll(/uses:\s+([^\s#]+)/g)].map(match => match[1]), [
        "actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683",
        "actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020",
    ]);
});

test("Given any pull request When validation starts Then it delegates to the complete shared gate", async () => {
    const [caller, shared] = await Promise.all([
        readWorkflow("pr-validation.yml"),
        readWorkflow("shared-validation.yml"),
    ]);

    assert.match(caller, /^on:\s*\n\s*pull_request:\s*$/m);
    assert.match(caller, /uses: \.\/\.github\/workflows\/shared-validation\.yml/);
    assert.doesNotMatch(caller, /\bpaths(?:-ignore)?:/);
    assert.match(shared, /^\s{2}workflow_call:\s*$/m);
});

test("Given a master push When release runs Then quality gates build, publication, and deploy in order", async () => {
    const release = await readWorkflow("release.yml");

    assert.match(release, /^\s{2}push:\s*\n\s{4}branches:\s*\n\s{6}- master$/m);
    assert.doesNotMatch(release, /pull_request:|\bdevelop\b/);
    assert.match(release, /quality:[\s\S]*?uses: \.\/\.github\/workflows\/shared-validation\.yml/);
    assert.match(release, /build:\s*\n\s{4}needs: quality/);
    assert.match(release, /publish:\s*\n\s{4}needs: build/);
    assert.match(release, /deploy:\s*\n\s{4}needs: publish/);
    assert.match(release, /^ {2}deploy:\n(?:(?!^ {2}\w).)*?^ {4}timeout-minutes:\s*10\s*$/ms);
    assert.match(release, /environment: production/);
    assert.match(release, /concurrency:[\s\S]*?cancel-in-progress: false/);
    assert.equal((release.match(/packages: write/g) ?? []).length, 1);
    assert.doesNotMatch(release, /ghcr\.io\/[^\s"']+:latest\b/);
    for (const action of release.matchAll(/uses:\s+([^\s#]+)/g)) {
        if (!action[1].startsWith("./")) assert.match(action[1], /@[0-9a-f]{40}$/);
    }
});

test("Given a v2 release package When generated Then no legacy CSV or schema flags enter the manifest command", async () => {
    const release = await readWorkflow("release.yml");

    for (const option of [
        "--generation", "--attempt", "--commit", "--server-image", "--database-image",
        "--workflow", "--created-at", "--output",
    ]) {
        assert.match(release, new RegExp(`\\s${option}\\s`), `v2 manifest invocation must include ${option}`);
    }
    assert.equal(/\s--csv\s|\s--schema-produces\s|\s--schema-application-supports\s/.test(release), false,
        "v2 manifest generation must not receive legacy CSV or schema options");
    const invocation = release.match(/npm run release:manifest -- \\\n([\s\S]*?)\n\s+jq -e/m)?.[1];
    assert.ok(invocation, "release must have one manifest generation invocation");
    assert.deepEqual([...invocation.matchAll(/^\s+--([\w-]+)\s/gm)].map(match => match[1]), [
        "generation", "attempt", "commit", "server-image", "database-image", "workflow", "created-at", "output",
    ]);
    assert.equal((release.match(/:sha-\$\{GITHUB_SHA\}/g) ?? []).length, 4);
    assert.match(release, /jq -e --arg commit "\$GITHUB_SHA"/);
    assert.match(release, /sha256:\[a-f0-9\]\{64\}/);
    assert.equal(/sub\(":sha-" \+ \$commit \+ "@"; "@"\)/.test(release), false);
    assert.equal(/release-manifest\.tmp/.test(release), false);
    assert.match(release, /tar .*Caddyfile docker-compose\.yml release-manifest\.json/);
    const packageGate = stepScript(release, "Reject unexpected or sensitive package contents");
    assert.match(packageGate, /test "\$actual" = "\$expected"/);
    assert.match(packageGate, /credential|private\[-_\]\?key|secret|token/);
    assert.match(release, /release_id="\$\(jq -er '\.releaseId' .*release-manifest\.json.*\)"/);
    assert.equal(/\bscp\b/.test(release), false);
    assert.match(release, /ssh .* deploy "\$RELEASE_ID" < "\$archive"/);
    assert.match(release, /^\s+-o ServerAliveInterval=30\s*$/m);
    assert.match(release, /^\s+-o ServerAliveCountMax=3\s*$/m);
    assert.match(release, /StrictHostKeyChecking=yes/);
    assert.match(release, /UserKnownHostsFile=/);
    assert.equal(/secrets\.(?:DATABASE|SESSION|GITHUB_TOKEN|BACKUP)/.test(release), false);
    assert.deepEqual([...new Set([...release.matchAll(/uses:\s+([^\s#]+)/g)].map(match => match[1]))].sort(), [
        "./.github/workflows/shared-validation.yml",
        "actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683",
        "actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093",
        "actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020",
        "actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02",
    ]);
});
