import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {chmod, mkdir, mkdtemp, readFile, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import test from "node:test";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const readWorkflow = name => readFile(path.join(root, ".github/workflows", name), "utf8");
const stepScript = (workflow, name) => {
    const step = workflow.split(`      - name: ${name}\n`)[1];
    assert.ok(step, `missing step: ${name}`);
    return step.split(/^\s{6}- name: /m)[0];
};
const maskedFailure = /\|\|\s*(?:true\b|:(?=\s|$)|exit\s+0\b)/m;
const assertMandatory = step => {
    assert.doesNotMatch(step, /^\s+if:|continue-on-error:/m);
    assert.doesNotMatch(step, maskedFailure);
    assert.match(step, /\brun:/);
};

const assertLocalIdentity = workflow => {
    const setup = stepScript(workflow, "Create CI-only runtime inputs");
    const origin = setup.match(/CI_RUNTIME_BASE_URL=(https:\/\/\S+)/);
    assert.ok(origin);
    const hostname = new URL(origin[1]).hostname;
    assert.equal(setup.match(/^\s{10}PUBLIC_HOSTNAME=(\S+)$/m)?.[1], hostname);
    assert.equal(new URL(setup.match(/^\s{10}APP_ORIGIN=(\S+)$/m)?.[1]).hostname, hostname);
    assert.equal(new URL(setup.match(/^\s{10}(https:\/\/\S+) \{$/m)?.[1]).hostname, hostname);
    assert.match(stepScript(workflow, "Run the E2E gate against the ephemeral runtime"), /STUDY_E2E_BASE_URL: \$\{\{ env\.CI_RUNTIME_BASE_URL \}\}/);
    assert.match(stepScript(workflow, "Seed a CI-only authenticated integration session"), /STUDY_HTTP_BASE_URL=%s.*\$CI_RUNTIME_BASE_URL/);
};

test("Given a mismatched TLS host When validating the CI identity Then the mismatch is detected", async () => {
    const shared = await readWorkflow("shared-validation.yml");
    assertLocalIdentity(shared);
    assert.throws(() => assertLocalIdentity(shared.replace("PUBLIC_HOSTNAME=localhost", "PUBLIC_HOSTNAME=other.invalid")));
});

test("Given CI credential setup When the generator runs Then its three identities receive JSON only through stdin", async () => {
    const setup = stepScript(await readWorkflow("shared-validation.yml"), "Create CI-only runtime inputs");
    const studyConfig = JSON.parse(setup.match(/cat > "\$runtime_dir\/study-config\.json" <<'JSON'\n\s*(\{[^\n]+\})/)?.[1]);
    assert.deepEqual(studyConfig.participants, Object.keys(studyConfig.loginUsernames));
    assert.deepEqual(Object.values(studyConfig.loginUsernames), studyConfig.participants);
    const generation = setup.match(/node --input-type=module > "\$runtime_dir\/account-passwords" <<'NODE'\n([\s\S]*?)\n\s*NODE/);
    assert.ok(generation);
    const generated = spawnSync(process.execPath, ["--input-type=module", "-e", generation[1]], {encoding: "utf8"});
    assert.equal(generated.status, 0);
    const passwords = JSON.parse(generated.stdout);
    assert.equal(passwords.length, studyConfig.participants.length);
    assert.ok(passwords.every(value => typeof value === "string" && value.length >= 32));
    assert.equal(new Set(passwords).size, passwords.length);
    assert.match(setup, /npm run credentials:generate -- \\\n\s*--study-config "\$runtime_dir\/study-config\.json" \\\n\s*--output "\$runtime_dir\/study-account-manifest\.json" \\\n\s*< "\$runtime_dir\/account-passwords"/);
    assert.doesNotMatch(setup, /(?:cat|tee|set -x|printf|echo)\s+[^\n]*account-passwords|--password(?:-fd)?\b/);

    const directory = await mkdtemp(path.join(tmpdir(), "labeler-ci-credentials-"));
    try {
        const config = path.join(directory, "study-config.json");
        const manifestFile = path.join(directory, "manifest.json");
        await writeFile(config, JSON.stringify(studyConfig), {mode: 0o400});
        const argumentsList = [path.join(root, "scripts/generate-credential-manifest.js"),
            "--study-config", config, "--output", manifestFile];
        const valid = spawnSync(process.execPath, argumentsList, {input: generated.stdout, encoding: "utf8"});
        assert.equal(valid.status, 0);
        const manifest = JSON.parse(await readFile(manifestFile, "utf8"));
        assert.deepEqual(manifest.accounts.map(account => account.normalizedUsername), studyConfig.participants);
        assert.ok(manifest.accounts.every(account => account.passwordHash.startsWith("$argon2id$") && !Object.hasOwn(account, "password")));
        assert.ok(passwords.every(secret => ![valid.stdout, valid.stderr, JSON.stringify(manifest)].some(value => value.includes(secret))));

        const invalid = spawnSync(process.execPath, [...argumentsList.slice(0, -1), path.join(directory, "invalid.json")], {
            input: passwords.join("\n"), encoding: "utf8",
        });
        assert.equal(invalid.status, 1);
        assert.equal(invalid.stdout, "");
        assert.equal(invalid.stderr, "CREDENTIAL_MANIFEST_FAILED\n");
        assert.ok(passwords.every(secret => !invalid.stderr.includes(secret)));
        await assert.rejects(() => readFile(path.join(directory, "invalid.json")), {code: "ENOENT"});
    } finally {
        await rm(directory, {recursive: true, force: true});
    }
});

test("Given protected runtime mounts When setup finishes Then only required files become readable to their consumers", async () => {
    const setup = stepScript(await readWorkflow("shared-validation.yml"), "Create CI-only runtime inputs");
    const ownership = setup.match(/docker run --rm --user 0:0 -v "\$runtime_dir:\/runtime" node:[^\s]+ \\\n\s*chown 1000:1000 \\\n([\s\S]*?)\n\s*cat > "\$runtime_dir\/Caddyfile"/);
    assert.ok(ownership);
    const owned = [...ownership[1].matchAll(/\/runtime\/([\w.-]+)/g)].map(match => match[1]).sort();
    assert.deepEqual(owned, ["database-password", "github-token", "session-current", "session-previous", "study-account-manifest.json"]);
    assert.doesNotMatch(ownership[0], /chown\s+(?:-R|--recursive)|\/runtime(?:\s|$)/);
    assert.match(setup, /chmod 0400 "\$runtime_dir"\/\*/);
    assert.match(setup, /chmod 0400 "\$runtime_dir\/study-account-manifest\.json"/);
    assert.match(setup, /chmod 0444 "\$runtime_dir\/Caddyfile"/);
    assert.match(setup, /f"\s+- \{runtime_dir\}\/Caddyfile:"/);
});

test("Given a CI integration participant When seeding state Then the category and session belong to its study", async () => {
    const seed = stepScript(await readWorkflow("shared-validation.yml"), "Seed a CI-only authenticated integration session");
    assert.match(seed, /account\.id, account\.study_id, account\.reviewer_id FROM participant_account/);
    const category = seed.match(/psql [^\n]* -qAt -c "(INSERT INTO participant_category[^\n]+)"/);
    assert.ok(category);
    assert.match(category[1], /\(study_id, participant_id, raw_name, normalized_name\) VALUES \('\$study_id', \$reviewer_id,/);
    assert.match(category[1], /RETURNING id$/);
    assert.match(seed, /STUDY_HTTP_CATEGORY_ID=%s.*\$category_id/);
    assert.match(seed, /INSERT INTO app_session\(session_id, account_id, study_id, reviewer_id,/);
});

test("Given the mounted server key When making the CI cookie Then signing happens inside the server container", async () => {
    const seed = stepScript(await readWorkflow("shared-validation.yml"), "Seed a CI-only authenticated integration session");
    const signing = seed.match(/session_cookie="\$\(docker compose [^\n]+ exec -T -e "SESSION_ID=\$session_id" labeling-server node --input-type=module <<'NODE'\n([\s\S]*?)\n\s*NODE/);
    assert.ok(signing);
    assert.match(signing[1], /readFileSync\("\/run\/secrets\/session-current"/);
    assert.match(signing[1], /createHmac\("sha256", secret\)\.update\(process\.env\.SESSION_ID/);
    assert.doesNotMatch(seed.split(signing[0])[0], /(?:cat|readFileSync|export).*session-current/);
    assert.match(seed, /STUDY_HTTP_SESSION_COOKIE=%s.*\$session_cookie/);
});

test("Given required gates When reviewing conditional execution Then only diagnostics and teardown are conditional", async () => {
    const shared = await readWorkflow("shared-validation.yml");
    for (const name of [
        "Run the complete lint gate", "Run unit tests", "Validate the OpenSpec change strictly",
        "Validate the source Compose configuration", "Lint both Dockerfiles",
        "Start the isolated ephemeral runtime", "Run the integration gate against the ephemeral runtime",
        "Run the E2E gate against the ephemeral runtime",
    ]) {
        assertMandatory(stepScript(shared, name));
    }
    const integration = stepScript(shared, "Run the integration gate against the ephemeral runtime");
    assert.throws(() => assertMandatory(integration.replace("npm run test:integration", "npm run test:integration || true")));
    assert.throws(() => assertMandatory(integration.replace("        env:", "        if: success()\n        env:")));
    assert.doesNotMatch(shared, /\bcontinue-on-error:|\bset\s+\+e\b/);
    assert.doesNotMatch(shared, maskedFailure);
});

test("Given a copied workflow with a no-op failure handler When checking required gates Then the bypass is rejected", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "labeler-ci-bypass-"));
    try {
        const shared = await readWorkflow("shared-validation.yml");
        const copy = path.join(directory, "shared-validation.yml");
        for (const handler of [":", "exit 0", "true"]) {
            const mutated = shared.replace("npm run test:integration\n", `npm run test:integration || ${handler}\n`);
            assert.notEqual(mutated, shared);
            await writeFile(copy, mutated);
            const step = stepScript(await readFile(copy, "utf8"), "Run the integration gate against the ephemeral runtime");
            assert.throws(() => assertMandatory(step), undefined, `failure masked with || ${handler}`);
        }
    } finally {
        await rm(directory, {recursive: true, force: true});
    }
});

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
    assert.match(shared, /"loginUsernames":\{"javier":"javier","diego":"diego","pablo":"pablo"\}/);
    assert.match(shared, /JSON\.stringify\(Array\.from\(\{length: 3\}/);
    assert.match(shared, /--output "\$runtime_dir\/study-account-manifest\.json" \\\n\s+< "\$runtime_dir\/account-passwords"/);
    assert.doesNotMatch(shared, /--password-fd\s+3|3<"\$runtime_dir\/account-passwords"/);
    assert.match(shared, /chmod 0400 "\$runtime_dir"\/\*/);
    assert.match(shared, /docker run --rm --user 0:0 -v "\$runtime_dir:\/runtime" node:22\.13\.1-alpine \\\n\s+chown 1000:1000/);
    assert.match(shared, /chmod 0444 "\$runtime_dir\/Caddyfile"/);
    assert.match(shared, /psql -U labeling_ci -d labeling_ci -qAt -c "INSERT INTO participant_category\(study_id, participant_id, raw_name, normalized_name\) VALUES \('\$study_id', \$reviewer_id/);
    assert.match(shared, /exec -T -e "SESSION_ID=\$session_id" labeling-server node --input-type=module <<'NODE'[\s\S]*?readFileSync\("\/run\/secrets\/session-current", "utf8"\)/);
    assert.doesNotMatch(shared, /SESSION_SECRET_FILE="\$CI_RUNTIME_DIR\/session-current" node/);
    assert.match(shared, /CI_RUNTIME_BASE_URL=https:\/\/localhost:18443/);
    assert.match(shared, /PUBLIC_HOSTNAME=localhost/);
    assert.match(shared, /APP_ORIGIN=https:\/\/localhost:18443/);
    assert.match(shared, /https:\/\/localhost \{/);
    assert.doesNotMatch(shared, /https:\/\/127\.0\.0\.1/);
    assert.match(shared, /up --build --wait --wait-timeout 180/);
    assert.match(shared, /if \[\[ -f "\$CI_RUNTIME_DIR\/compose\.env" \]\]; then/);
    assert.doesNotMatch(shared, maskedFailure);
    for (const action of shared.matchAll(/uses:\s+([^\s#]+)/g)) {
        assert.match(action[1], /@[0-9a-f]{40}$/);
    }
});

test("Given partial setup or failed teardown When cleanup runs Then the runtime is removed unless docker down fails", async () => {
    const shared = await readWorkflow("shared-validation.yml");
    const cleanupStep = shared.split("      - name: Remove the ephemeral runtime\n")[1];
    assert.ok(cleanupStep);
    assert.match(cleanupStep, /^ {8}if: always\(\) && env\.CI_RUNTIME_DIR != ''$/m);
    const script = cleanupStep.split("        run: |\n")[1]?.replace(/^ {10}/gm, "");
    assert.ok(script);

    const directory = await mkdtemp(path.join(tmpdir(), "labeler-ci-cleanup-"));
    try {
        const bin = path.join(directory, "bin");
        await mkdir(bin);
        const docker = path.join(bin, "docker");
        await writeFile(docker, "#!/bin/sh\nprintf 'called\\n' >> \"$DOCKER_CALLS\"\nexit \"$DOCKER_EXIT_CODE\"\n");
        await chmod(docker, 0o700);

        for (const [scenario, hasComposeEnv, teardownStatus, expectedStatus, runtimeRemoved] of [
            ["partial", false, 42, 0, true],
            ["success", true, 0, 0, true],
            ["failed", true, 42, 42, false],
        ]) {
            const runtime = path.join(directory, scenario);
            const calls = path.join(directory, `${scenario}-calls`);
            await mkdir(runtime);
            if (hasComposeEnv) await writeFile(path.join(runtime, "compose.env"), "PLACEHOLDER=1\n");

            const result = spawnSync("bash", ["--noprofile", "--norc", "-eo", "pipefail", "-c", script], {
                encoding: "utf8",
                env: {
                    ...process.env,
                    PATH: `${bin}:${process.env.PATH}`,
                    CI_RUNTIME_DIR: runtime,
                    CI_COMPOSE_PROJECT: "ci-contract-test",
                    DOCKER_CALLS: calls,
                    DOCKER_EXIT_CODE: String(teardownStatus),
                },
            });
            assert.equal(result.status, expectedStatus, `${scenario}: cleanup exit status`);
            if (hasComposeEnv) {
                assert.equal(await readFile(calls, "utf8"), "called\n", `${scenario}: docker invocation count`);
            } else {
                await assert.rejects(() => readFile(calls), {code: "ENOENT"}, `${scenario}: docker must not run`);
            }
            if (runtimeRemoved) {
                await assert.rejects(() => readFile(path.join(runtime, "compose.env")), {code: "ENOENT"});
                await assert.rejects(() => readFile(runtime), {code: "ENOENT"});
            } else {
                assert.equal(await readFile(path.join(runtime, "compose.env"), "utf8"), "PLACEHOLDER=1\n");
            }
        }
    } finally {
        await rm(directory, {recursive: true, force: true});
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
    assert.match(release, /^ {2}deploy:\n(?:(?!^ {2}\w).)*?^ {4}timeout-minutes:\s*10\s*$/ms);
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
    assert.match(release, /deployment\/docker-compose\.release\.yml/);
    assert.doesNotMatch(release, /\bscp\b/);
    assert.match(release, /ssh .* deploy "\$RELEASE_ID" < "\$archive"/);
    assert.match(release, /^\s+-o ServerAliveInterval=30\s*$/m);
    assert.match(release, /^\s+-o ServerAliveCountMax=3\s*$/m);
    assert.match(release, /StrictHostKeyChecking=yes/);
    assert.match(release, /UserKnownHostsFile=/);
    assert.doesNotMatch(release, /secrets\.(?:DATABASE|SESSION|GITHUB_TOKEN|BACKUP)/);
});
