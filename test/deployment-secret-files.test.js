import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const readRepositoryFile = relativePath => readFile(path.join(root, relativePath), "utf8");

test("deployment supplies database credentials only through read-only secret files", async () => {
    const [compose, template] = await Promise.all([
        readRepositoryFile("deployment/docker-compose.yml"),
        readRepositoryFile("deployment/.env.template"),
    ]);
    const databaseBlock = compose.match(/ {2}labeling-database:[\s\S]*?(?=\n {2}[a-z]|\nvolumes:)/)?.[0] || "";
    const prepareBlock = compose.match(/ {2}labeling-study-prepare:[\s\S]*?(?=\n {2}labeling-server:)/)?.[0] || "";
    const serverBlock = compose.match(/ {2}labeling-server:[\s\S]*?(?=\n {2}labeling-caddy:)/)?.[0] || "";

    assert.match(databaseBlock, /POSTGRES_PASSWORD_FILE:\s*\/run\/secrets\/database-password/);
    assert.match(databaseBlock, /\$\{DATABASE_PASSWORD_DATABASE_HOST_PATH:\?[^}]+\}:\/run\/secrets\/database-password:ro/);
    assert.match(prepareBlock, /DATABASE_PASS_FILE:\s*\/run\/secrets\/database-password/);
    assert.match(prepareBlock, /\$\{DATABASE_PASSWORD_HOST_PATH:\?[^}]+\}:\/run\/secrets\/database-password:ro/);
    assert.match(serverBlock, /DATABASE_PASS_FILE:\s*\/run\/secrets\/database-password/);
    assert.match(serverBlock, /\$\{DATABASE_PASSWORD_HOST_PATH:\?[^}]+\}:\/run\/secrets\/database-password:ro/);
    assert.match(template, /^DATABASE_PASSWORD_HOST_PATH=\/absolute\/external\/database-password$/m);
    assert.match(template, /^DATABASE_PASSWORD_DATABASE_HOST_PATH=\/absolute\/external\/database-password-postgres$/m);
    assert.doesNotMatch(compose, /GITHUB_TOKEN_HOST_PATH/);
    assert.doesNotMatch(template, /^GITHUB_TOKEN_HOST_PATH=/m);
    assert.doesNotMatch(compose, /^\s*(?:POSTGRES_PASSWORD|DATABASE_PASS|PGPASSWORD|GITHUB_TOKEN):/m);
    assert.doesNotMatch(template, /^\s*(?:DATABASE_PASS|PGPASSWORD|GITHUB_TOKEN)=/m);
});

test("GitHub enrichment token mount is an explicit preparation-only override", async () => {
    const [compose, enrichmentOverride, template] = await Promise.all([
        readRepositoryFile("deployment/docker-compose.yml"),
        readRepositoryFile("deployment/docker-compose.github-enrichment.yml"),
        readRepositoryFile("deployment/.env.template"),
    ]);
    const overridePrepareBlock = enrichmentOverride.match(/ {2}labeling-study-prepare:[\s\S]*/)?.[0] || "";

    assert.doesNotMatch(compose, /GITHUB_TOKEN_HOST_PATH/);
    assert.match(overridePrepareBlock, /\$\{GITHUB_TOKEN_HOST_PATH:\?[^}]+\}:\/run\/secrets\/github-token:ro/);
    assert.match(overridePrepareBlock, /GITHUB_ENRICHMENT_ENABLED:\s*"true"/);
    assert.doesNotMatch(template, /^GITHUB_TOKEN_HOST_PATH=/m);
});
