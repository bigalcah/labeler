import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const readRepositoryFile = relativePath => readFile(path.join(root, relativePath), "utf8");

test("compose gates server startup on the guarded study preparation service", async () => {
    const compose = await readRepositoryFile("deployment/docker-compose.yml");

    assert.doesNotMatch(compose, /test-data\/(?:label\.txt|reviewer\.txt|instance\.tsv)/);
    assert.match(compose, /labeling-study-prepare:/);
    assert.match(compose, /labeling-study-prepare:[\s\S]*labeling-database:\s*\n\s*condition: service_healthy/);
    assert.match(compose, /labeling-server:[\s\S]*labeling-study-prepare:\s*\n\s*condition: service_completed_successfully/);
    assert.match(compose, /merged_after_rework_cards_seed_20260510\.csv:.*prs\.csv:ro/);
});

test("server image contains the guarded migration and bootstrap inputs", async () => {
    const dockerfile = await readRepositoryFile("deployment/server/Dockerfile");

    assert.match(dockerfile, /COPY schema\/migrations schema\/migrations\//);
    assert.match(dockerfile, /postgresql\d*-client/);
    assert.match(dockerfile, /COPY scripts scripts\//);
    assert.match(dockerfile, /COPY app\.js/);
    assert.match(dockerfile, /^FROM node:22\.13\.1-alpine/m);
    assert.match(dockerfile, /USER node/);
    assert.doesNotMatch(dockerfile, /^FROM .*:latest/m);
});

test("compose mounts production manifests and session secrets without mutable images", async () => {
    const compose = await readRepositoryFile("deployment/docker-compose.yml");
    const serverBlock = compose.match(/ {2}labeling-server:[\s\S]*?\nvolumes:/)?.[0] || "";

    assert.doesNotMatch(serverBlock, /GITHUB_/);
    assert.match(serverBlock, /NODE_ENV:\s*production/);
    assert.match(serverBlock, /APP_ORIGIN:\s*\$\{APP_ORIGIN:\?/);
    assert.match(serverBlock, /TRUST_PROXY_HOPS:\s*["']1["']/);
    assert.match(serverBlock, /SESSION_SECRET_FILE:\s*\/run\/secrets\/session-current/);
    assert.match(serverBlock, /SESSION_SECRET_PREVIOUS_FILE:\s*\/run\/secrets\/session-previous/);
    assert.match(serverBlock, /\$\{SESSION_SECRET_CURRENT_HOST_PATH:\?[^\n]*\}:\/run\/secrets\/session-current:ro/);
    assert.match(serverBlock, /\$\{SESSION_SECRET_PREVIOUS_HOST_PATH:\?[^\n]*\}:\/run\/secrets\/session-previous:ro/);
    assert.doesNotMatch(compose, /image:\s*[^\n]*:latest/);
});

test("compose requires an account manifest exclusively for study preparation", async () => {
    const compose = await readRepositoryFile("deployment/docker-compose.yml");
    const prepareBlock = compose.match(/ {2}labeling-study-prepare:[\s\S]*? {2}labeling-server:/)?.[0] || "";
    const serverBlock = compose.match(/ {2}labeling-server:[\s\S]*?\nvolumes:/)?.[0] || "";

    assert.match(
        prepareBlock,
        /\$\{STUDY_ACCOUNT_MANIFEST_HOST_PATH:\?[^}]+\}:\/run\/secrets\/study-account-manifest\.json:ro/,
    );
    assert.match(prepareBlock, /STUDY_ACCOUNT_MANIFEST_FILE:\s*\/run\/secrets\/study-account-manifest\.json/);
    assert.doesNotMatch(serverBlock, /STUDY_ACCOUNT_MANIFEST_(?:HOST_PATH|FILE)/);
    assert.doesNotMatch(serverBlock, /\/run\/secrets\/study-account-manifest\.json/);
});

test("deployment preparation selects a guarded database path before bootstrap", async () => {
    const script = await readRepositoryFile("scripts/prepare-study-deployment.sh");
    const existingBlock = script.match(/existing\)(?:(?!\n\s*;;)[\s\S])*LEGACY_RETIREMENT_CONFIRM[\s\S]*?\n\s*;;/)?.[0];
    assert.ok(existingBlock);
    const existingCommands = existingBlock.match(/^\s*npm run .*$/gm)?.map(command => command.trim());
    const bootstrapCommand = script.match(/^\s*npm run bootstrap:study .*$/m)?.[0].trim();
    assert.deepEqual(
        [ ...existingCommands, bootstrapCommand ],
        [
            "npm run migrate:study -- --through 001_study_foundation",
            "npm run retire:legacy:apply",
            "npm run migrate:study",
            "npm run bootstrap:study -- \"${STUDY_CSV_PATH}\" \"${STUDY_CONFIG_INPUT}\"",
        ],
    );
    const foundationPosition = script.indexOf("migrate:study");
    const cleanCheckPosition = script.indexOf("retire:legacy:clean-check");
    const retirementPosition = script.indexOf("retire:legacy:apply");
    const bootstrapPosition = script.indexOf("bootstrap:study");

    assert.notEqual(foundationPosition, -1);
    assert.notEqual(cleanCheckPosition, -1);
    assert.notEqual(retirementPosition, -1);
    assert.notEqual(bootstrapPosition, -1);
    assert.match(script, /clean\)/);
    assert.match(script, /existing\)/);
    assert.match(script, /clean\)[\s\S]*retire:legacy:clean-check[\s\S]*migrate:study/);
    assert.match(
        script,
        /existing\)[\s\S]*LEGACY_RETIREMENT_CONFIRM[\s\S]*migrate:study[\s\S]*retire:legacy:apply/,
    );
    assert.ok(cleanCheckPosition < foundationPosition);
    assert.ok(foundationPosition < retirementPosition);
    assert.ok(cleanCheckPosition < bootstrapPosition);
    assert.ok(retirementPosition < bootstrapPosition);
});

test("retirement apply mode reads the explicit migration only after guarded readiness", async () => {
    const script = await readRepositoryFile("scripts/retire-legacy-labeler.js");
    const readinessPosition = script.indexOf("const state = await checkRetirementReadiness");
    const migrationPosition = script.indexOf("002_retire_legacy_labeler.sql");
    const applyPosition = script.indexOf("pool.query(migration)");

    assert.match(script, /--apply/);
    assert.match(script, /LEGACY_RETIREMENT_CONFIRM/);
    assert.ok(readinessPosition < migrationPosition);
    assert.ok(migrationPosition < applyPosition);
});

test("Caddy is the only public TLS edge and blocks actuator before proxying", async () => {
    const [compose, rollbackCompose, caddyfile] = await Promise.all([
        readRepositoryFile("deployment/docker-compose.yml"),
        readRepositoryFile("deployment/docker-compose.rollback-readonly.yml"),
        readRepositoryFile("deployment/Caddyfile"),
    ]);
    const caddyBlock = compose.match(/\s{2}labeling-caddy:[\s\S]*?(?=\n\s{2}[a-z]|\nvolumes:)/)?.[0] || "";
    const rollbackCaddyBlock = rollbackCompose.match(/\s{2}labeling-caddy:[\s\S]*?(?=\n\s{2}[a-z]|\nvolumes:)/)?.[0] || "";

    assert.match(caddyBlock, /image:\s*caddy:2\.8\.4-alpine/);
    assert.match(caddyBlock, /PUBLIC_HOSTNAME:\s*\$\{PUBLIC_HOSTNAME:\?/);
    assert.match(caddyBlock, /"80:80"/);
    assert.match(caddyBlock, /"443:443"/);
    assert.match(caddyBlock, /labeling-server:\s*\n\s*condition: service_healthy/);
    assert.match(rollbackCaddyBlock, /labeling-server:\s*\n\s*condition: service_healthy/);
    assert.match(compose, /labeling-server:[\s\S]*labeling-study-prepare:\s*\n\s*condition: service_completed_successfully/);
    assert.match(rollbackCompose, /labeling-server:[\s\S]*labeling-database:\s*\n\s*condition: service_healthy/);
    for (const deployment of [ compose, rollbackCompose ]) {
        assert.doesNotMatch(deployment, /"(?:7755:3000|3000:3000|5432:5432)"/);
    }
    assert.match(caddyfile, /http:\/\/\{\$PUBLIC_HOSTNAME\}/);
    assert.match(caddyfile, /https:\/\/\{\$PUBLIC_HOSTNAME\}/);
    assert.match(caddyfile, /redir https:\/\/\{\$PUBLIC_HOSTNAME\}\{uri\} permanent/);
    assert.match(caddyfile, /@actuator path \/actuator \/actuator\/\*/);
    assert.match(caddyfile, /respond @actuator 404/);
    assert.match(caddyfile, /reverse_proxy labeling-server:3000/);
    assert.doesNotMatch(caddyfile, /(?:SECRET|PASSWORD|TOKEN|COOKIE|CSRF)/i);
});
