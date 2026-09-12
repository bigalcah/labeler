import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const readWorkflow = name => readFile(path.join(root, ".github/workflows", name), "utf8");

test("Given any pull request When validation starts Then it delegates to the complete reusable gate", async () => {
    const [caller, shared] = await Promise.all([
        readWorkflow("pr-validation.yml"),
        readWorkflow("shared-validation.yml"),
    ]);

    assert.match(caller, /^on:\s*\n\s*pull_request:\s*$/m);
    assert.match(caller, /uses: \.\/\.github\/workflows\/shared-validation\.yml/);
    assert.doesNotMatch(caller, /\bpaths(?:-ignore)?:/);
    assert.match(shared, /^\s{2}workflow_call:\s*$/m);
    for (const command of [
        /npm ci/,
        /npm run lint(?:\s|$)/,
        /npm run test:unit(?:\s|$)/,
        /openspec validate ["']?card-sorting-prs-mvp["']? --strict/,
        /docker compose .*--env-file .* -f deployment\/docker-compose\.yml config/,
        /hadolint .*deployment\/server\/Dockerfile.*deployment\/database\/Dockerfile/,
    ]) {
        assert.match(shared, command, `shared workflow must run ${command}`);
    }
    const composeUp = shared.search(/docker compose .*up(?:\s|$)/);

    assert.ok(composeUp >= 0);
    assert.ok(shared.search(/npm run test:integration(?:\s|$)/) > composeUp);
    assert.ok(shared.search(/npm run test:e2e(?:\s|$)/) > composeUp);
});

test("Given shared validation When a gate fails Then no bypass or repository secret can hide it", async () => {
    const shared = await readWorkflow("shared-validation.yml");

    assert.match(shared, /^permissions:\s*\n\s{2}contents: read$/m);
    assert.match(shared, /DATABASE_PASSWORD_DATABASE_HOST_PATH=\$runtime_dir\/database-password/);
    assert.doesNotMatch(shared, /\$\{\{\s*secrets\./i);
    assert.doesNotMatch(shared, /continue-on-error:\s*true|\|\|\s*true\b|\bset\s*\+e\b|\bexit\s+0\b/i);
    for (const action of shared.matchAll(/uses:\s+([^\s#]+)/g)) {
        assert.match(action[1], /@[0-9a-f]{40}$/);
    }
});

test("Given a master push When release runs Then validation gates every fail-closed production stage", async () => {
    const release = await readWorkflow("release.yml");

    assert.match(release, /^\s{2}push:\s*\n\s{4}branches:\s*\n\s{6}- master$/m);
    assert.doesNotMatch(release, /pull_request:|\bdevelop\b/);
    assert.match(release, /quality:[\s\S]*?uses: \.\/\.github\/workflows\/shared-validation\.yml/);
    assert.match(release, /build:\s*\n\s{4}needs: quality/);
    assert.match(release, /publish:\s*\n\s{4}needs: build/);
    assert.match(release, /deploy:\s*\n\s{4}needs: publish/);
    assert.match(release, /environment: production/);
    assert.match(release, /concurrency:[\s\S]*?cancel-in-progress: false/);
    assert.equal((release.match(/packages: write/g) ?? []).length, 1);
    assert.doesNotMatch(release, /ghcr\.io\/[^\s"']+:latest\b/);
    for (const action of release.matchAll(/uses:\s+([^\s#]+)/g)) {
        if (!action[1].startsWith("./")) assert.match(action[1], /@[0-9a-f]{40}$/);
    }
});

test("Given published digests When packaging and deploying Then manifest and forced-command contracts stay exact", async () => {
    const release = await readWorkflow("release.yml");

    assert.equal((release.match(/:sha-\$\{GITHUB_SHA\}/g) ?? []).length, 4);
    for (const option of [
        "--generation", "--attempt", "--commit", "--server-image", "--database-image", "--csv",
        "--schema-produces", "--schema-application-supports", "--workflow", "--created-at", "--output",
    ]) {
        assert.match(release, new RegExp(`\\s${option}\\s`), `manifest invocation must include ${option}`);
    }
    assert.match(release, /release_id="\$\(jq -er '\.releaseId' .*release-manifest\.json.*\)"/);
    assert.doesNotMatch(release, /sub\(":sha-" \+ \$commit \+ "@"; "@"\)/);
    assert.doesNotMatch(release, /release-manifest\.tmp/);
    assert.match(release, /tar .*Caddyfile docker-compose\.yml release-manifest\.json/);
    assert.doesNotMatch(release, /docker-compose\.clean\.yml/);
    assert.doesNotMatch(release, /\bscp\b/);
    assert.match(release, /ssh .* deploy "\$RELEASE_ID" < "\$archive"/);
    assert.match(release, /StrictHostKeyChecking=yes/);
    assert.match(release, /UserKnownHostsFile=/);
    assert.doesNotMatch(release, /secrets\.(?:DATABASE|SESSION|GITHUB_TOKEN|BACKUP)/);
});
