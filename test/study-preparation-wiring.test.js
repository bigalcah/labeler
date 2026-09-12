import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {chmod, mkdir, mkdtemp, readFile, rm, writeFile} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const compose = await readFile(new URL("../deployment/docker-compose.yml", import.meta.url), "utf8");
const cleanOverride = await readFile(new URL("../deployment/docker-compose.clean.yml", import.meta.url), "utf8");
const existingOverride = await readFile(new URL("../deployment/docker-compose.existing.yml", import.meta.url), "utf8");
const enrichmentOverride = await readFile(new URL("../deployment/docker-compose.github-enrichment.yml", import.meta.url), "utf8");
const prepare = await readFile(new URL("../scripts/prepare-study-deployment.sh", import.meta.url), "utf8");
const bootstrap = await readFile(new URL("../scripts/bootstrap-study.js", import.meta.url), "utf8");
const enrichment = await readFile(new URL("../scripts/enrich-study.js", import.meta.url), "utf8");
const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

const run = (command, argumentsList, environment) => new Promise(resolve => {
    const child = spawn(command, argumentsList, {env: environment});
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", chunk => {
        stdout += chunk;
    });
    child.stderr.on("data", chunk => {
        stderr += chunk;
    });
    child.on("close", status => resolve({status, stdout, stderr}));
});

const manifest = () => ({
    manifestVersion: 1,
    studyKey: "prepare-test",
    accounts: [ {
        participantKey: "participant",
        normalizedUsername: "participant",
        passwordHash: `$argon2id$v=19$m=65536,t=3,p=4$c2FsdHNhbHQ${Buffer.alloc(32).toString("base64").replace(/=+$/, "")}`,
    } ],
});

test("GitHub configuration and secret wiring is limited to study preparation", () => {
    const prepareBlock = compose.match(/ {2}labeling-study-prepare:[\s\S]*? {2}labeling-server:/)?.[0] || "";
    const enrichmentPrepareBlock = enrichmentOverride.match(/ {2}labeling-study-prepare:[\s\S]*/)?.[0] || "";
    const serverBlock = compose.match(/ {2}labeling-server:[\s\S]*?volumes:/)?.[0] || compose.slice(compose.indexOf("  labeling-server:"));
    assert.match(prepareBlock, /GITHUB_ENRICHMENT_ENABLED/);
    assert.doesNotMatch(prepareBlock, /GITHUB_TOKEN_HOST_PATH|GITHUB_CREDENTIAL_ALIASES|GITHUB_DEFAULT_ALIAS/);
    assert.match(enrichmentPrepareBlock, /GITHUB_CREDENTIAL_ALIASES/);
    assert.match(enrichmentPrepareBlock, /GITHUB_TOKEN_HOST_PATH/);
    assert.match(enrichmentPrepareBlock, /GITHUB_DEFAULT_ALIAS/);
    assert.match(enrichmentPrepareBlock, /GITHUB_ENRICHMENT_ENABLED:\s*"true"/);
    assert.doesNotMatch(serverBlock, /GITHUB_/);
    assert.match(prepare, /GITHUB_ENRICHMENT_ENABLED=.*false/);
    assert.match(prepare, /npm run bootstrap:study[\s\S]*npm run enrich:study/);
    assert.equal(packageJson.scripts["enrich:study"], "node scripts/enrich-study.js");
    assert.doesNotMatch(compose, /owner\/repository/);
});

test("enrichment is a separate post-bootstrap command with an explicit disabled guard", () => {
    assert.doesNotMatch(bootstrap, /readGithubConfig|createGithubClient|enrichStudyWithGithub/);
    assert.match(enrichment, /const githubConfig = readGithubConfig\(\);/);
    assert.match(enrichment, /prepareStudyGithubEnrichment/);
    assert.match(enrichment, /result\.status === "DISABLED"/);
    assert.match(enrichment, /createClient: createGithubClient/);
});

test("enrichment command reports a sanitized failure without writing credential input to logs", async () => {
    const secret = "github-token-fixture-secret";
    const result = await run(process.execPath, [ "scripts/enrich-study.js", "/mounted/cards.csv", "{}" ], {
        ...process.env,
        DATABASE_PASS_FILE: undefined,
        GITHUB_ENRICHMENT_ENABLED: "true",
        GITHUB_CREDENTIAL_ALIASES: secret,
    });

    assert.equal(result.status, 1);
    assert.equal(result.stderr, "STUDY_GITHUB_ENRICHMENT_FAILED\n");
    assert.doesNotMatch(`${result.stdout}${result.stderr}`, new RegExp(secret));
});

test("a paused enrichment prevents successful preparation and server startup", () => {
    assert.match(enrichment, /result\.status === "PAUSED"/);
    assert.match(enrichment, /process\.exitCode = [1-9]/);
    assert.match(prepare, /set -eu/);
    assert.match(prepare, /npm run enrich:study/);
    assert.match(compose, /condition: service_completed_successfully/);
});

test("base clean preparation avoids retirement credentials while the existing override mounts them", () => {
    const prepareBlock = compose.match(/ {2}labeling-study-prepare:[\s\S]*? {2}labeling-server:/)?.[0] || "";

    assert.doesNotMatch(prepareBlock, /PGPASSFILE|LEGACY_BACKUP_ARCHIVE|LEGACY_BACKUP_MANIFEST/);
    assert.match(existingOverride, /PGPASSFILE_HOST_PATH/);
    assert.match(existingOverride, /LEGACY_BACKUP_DIRECTORY/);
    assert.match(existingOverride, /PGPASSFILE: \/run\/secrets\/legacy-retirement\.pgpass/);
    assert.doesNotMatch(existingOverride, /STUDY_PROFILES_INPUT/);
});

test("existing Compose rendering needs no clean-only profile inputs or mounts", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "labeler-existing-compose-"));
    const backupDirectory = path.join(directory, "backup");
    const envPath = path.join(directory, "compose.env");
    const composePath = path.resolve(new URL("../deployment/docker-compose.yml", import.meta.url).pathname);
    const existingPath = path.resolve(new URL("../deployment/docker-compose.existing.yml", import.meta.url).pathname);
    const inputFiles = [
        "database-password",
        "database-password-postgres",
        "session-current",
        "session-previous",
        "study-account-manifest.json",
        "legacy-retirement.pgpass",
    ];

    try {
        await mkdir(backupDirectory);
        await Promise.all(inputFiles.map(file => writeFile(path.join(directory, file), "")));
        await Promise.all([
            writeFile(path.join(backupDirectory, "legacy.dump"), ""),
            writeFile(path.join(backupDirectory, "legacy.manifest.json"), "{}\n"),
        ]);
        await writeFile(envPath, [
            "DATABASE_NAME=labeling_test",
            "DATABASE_USER=labeling_test",
            `DATABASE_PASSWORD_HOST_PATH=${path.join(directory, "database-password")}`,
            `DATABASE_PASSWORD_DATABASE_HOST_PATH=${path.join(directory, "database-password-postgres")}`,
            `SESSION_SECRET_CURRENT_HOST_PATH=${path.join(directory, "session-current")}`,
            `SESSION_SECRET_PREVIOUS_HOST_PATH=${path.join(directory, "session-previous")}`,
            `STUDY_ACCOUNT_MANIFEST_HOST_PATH=${path.join(directory, "study-account-manifest.json")}`,
            "STUDY_DATABASE_MODE=existing",
            "PUBLIC_HOSTNAME=example.test",
            "APP_ORIGIN=https://example.test",
            "LEGACY_RETIREMENT_CONFIRM=retire-legacy-labeler",
            `LEGACY_BACKUP_DIRECTORY=${backupDirectory}`,
            "LEGACY_BACKUP_ARCHIVE_FILE=legacy.dump",
            "LEGACY_BACKUP_MANIFEST_FILE=legacy.manifest.json",
            `PGPASSFILE_HOST_PATH=${path.join(directory, "legacy-retirement.pgpass")}`,
        ].join("\n"));

        const result = await run("docker", [
            "compose",
            "--env-file", envPath,
            "-f", composePath,
            "-f", existingPath,
            "config",
            "--format", "json",
        ], {HOME: process.env.HOME, PATH: process.env.PATH});

        assert.equal(result.status, 0, result.stderr);
        const services = JSON.parse(result.stdout).services;
        const cleanOnlyTargets = new Set([
            "/run/config/study-profiles.json",
            "/run/config/studies/current.json",
            "/run/config/studies/validation-30.json",
            "/labeling/plans/validation-30-cards.csv",
            "/run/secrets/studies/validation-30.json",
        ]);
        const prepareTargets = new Set((services["labeling-study-prepare"].volumes ?? []).map(volume => volume.target));

        for (const serviceName of [ "labeling-study-prepare", "labeling-server", "labeling-caddy" ]) {
            const targets = (services[serviceName].volumes ?? []).map(volume => volume.target);
            assert.equal(targets.some(target => cleanOnlyTargets.has(target)), false, serviceName);
        }
        for (const target of [
            "/run/secrets/studies/current.json",
            "/run/secrets/database-password",
            "/run/secrets/legacy-retirement.pgpass",
            "/legacy-backup",
        ]) {
            assert.equal(prepareTargets.has(target), true, target);
        }
        assert.equal(services["labeling-study-prepare"].environment.STUDY_CSV_PATH, "/labeling/data/pr-cards.csv");
        assert.equal(services["labeling-study-prepare"].environment.STUDY_PROFILES_INPUT, undefined);
    } finally {
        await rm(directory, {recursive: true, force: true});
    }
});

test("preparation input validation rejects a complete but invalid CSV without database credentials", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "labeler-prepare-input-"));
    const configPath = path.join(directory, "study.json");
    const manifestPath = path.join(directory, "manifest.json");
    const csvPath = path.join(directory, "cards.csv");

    try {
        await writeFile(configPath, JSON.stringify({
            studyKey: "prepare-test",
            expectedCardCount: 300,
            participants: [ "participant" ],
        }));
        await writeFile(manifestPath, JSON.stringify(manifest()));
        await chmod(manifestPath, 0o400);
        await writeFile(csvPath, "card_id,html_url\ncard-1,https://example.test/pull/1\n");

        const result = await run(process.execPath, [ "scripts/validate-study-bootstrap.js", csvPath, configPath ], {
            ...process.env,
            STUDY_ACCOUNT_MANIFEST_FILE: manifestPath,
            DATABASE_PASS_FILE: undefined,
        });

        assert.equal(result.status, 1);
        assert.match(result.stderr, /STUDY_BOOTSTRAP_INPUT_INVALID/);
    } finally {
        await rm(directory, {recursive: true, force: true});
    }
});

test("preparation rejects an unknown database mode before invoking npm", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "labeler-prepare-mode-"));
    const binDirectory = path.join(directory, "bin");
    const npmPath = path.join(binDirectory, "npm");
    const logPath = path.join(directory, "npm.log");

    try {
        await mkdir(binDirectory);
        await writeFile(npmPath, "#!/bin/sh\nprintf '%s\\n' \"$*\" >> \"$PREPARE_LOG\"\n");
        await chmod(npmPath, 0o755);
        const result = await run("sh", [ "scripts/prepare-study-deployment.sh" ], {
            ...process.env,
            PATH: `${binDirectory}:${process.env.PATH}`,
            PREPARE_LOG: logPath,
            STUDY_DATABASE_MODE: "invalid",
        });

        assert.equal(result.status, 1);
        assert.match(result.stderr, /STUDY_DATABASE_MODE must be clean or existing/);
        await assert.rejects(() => readFile(logPath, "utf8"), {code: "ENOENT"});
    } finally {
        await rm(directory, {recursive: true, force: true});
    }
});

test("clean preparation validates first, then migrates and bootstraps without a legacy passfile", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "labeler-prepare-order-"));
    const binDirectory = path.join(directory, "bin");
    const npmPath = path.join(binDirectory, "npm");
    const logPath = path.join(directory, "npm.log");

    try {
        await mkdir(binDirectory);
        await writeFile(npmPath, "#!/bin/sh\nprintf '%s\\n' \"$*\" >> \"$PREPARE_LOG\"\n");
        await chmod(npmPath, 0o755);
        const result = await run("sh", [ "scripts/prepare-study-deployment.sh" ], {
            ...process.env,
            PATH: `${binDirectory}:${process.env.PATH}`,
            PREPARE_LOG: logPath,
            STUDY_DATABASE_MODE: "clean",
            STUDY_CSV_PATH: "/input/cards.csv",
            STUDY_ACCOUNT_MANIFEST_FILE: "/run/secrets/study-account-manifest.json",
            PGPASSFILE: undefined,
        });

        assert.equal(result.status, 0);
        assert.deepEqual((await readFile(logPath, "utf8")).trim().split("\n"), [
            "run validate:study-bootstrap -- /input/cards.csv",
            "run retire:legacy:clean-check",
            "run migrate:study",
            "run bootstrap:study -- /input/cards.csv",
            "run enrich:study -- /input/cards.csv",
        ]);
    } finally {
        await rm(directory, {recursive: true, force: true});
    }
});

test("multi-study preparation preflights one ordered bundle before sequential bootstrap", () => {
    const prepareBlock = cleanOverride.match(/ {2}labeling-study-prepare:[\s\S]*/)?.[0] || "";

    assert.match(prepareBlock, /STUDY_PROFILES_INPUT:\s*\/run\/config\/study-profiles\.json/);
    assert.match(prepare, /npm run validate:study-profiles/);
    assert.match(prepare, /npm run prepare:study-profiles/);
    assert.equal(prepare.match(/npm run prepare:study-profiles/g)?.length, 1);
});

test("multi-study preparation rejects ambiguous legacy input before invoking npm", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "labeler-prepare-ambiguous-"));
    const binDirectory = path.join(directory, "bin");
    const npmPath = path.join(binDirectory, "npm");
    const logPath = path.join(directory, "npm.log");
    try {
        await mkdir(binDirectory);
        await writeFile(npmPath, "#!/bin/sh\nprintf '%s\\n' \"$*\" >> \"$PREPARE_LOG\"\n");
        await chmod(npmPath, 0o755);
        const result = await run("sh", [ "scripts/prepare-study-deployment.sh" ], {
            ...process.env,
            PATH: `${binDirectory}:${process.env.PATH}`,
            PREPARE_LOG: logPath,
            STUDY_DATABASE_MODE: "clean",
            STUDY_PROFILES_INPUT: "/run/config/study-profiles.json",
            STUDY_CONFIG_INPUT: "/run/config/study.json",
        });
        assert.equal(result.status, 1);
        assert.match(result.stderr, /cannot be used together/);
        await assert.rejects(() => readFile(logPath, "utf8"), {code: "ENOENT"});
    } finally {
        await rm(directory, {recursive: true, force: true});
    }
});

test("multi-study input failure stops before clean checks, migrations, or preparation", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "labeler-prepare-preflight-"));
    const binDirectory = path.join(directory, "bin");
    const npmPath = path.join(binDirectory, "npm");
    const logPath = path.join(directory, "npm.log");
    try {
        await mkdir(binDirectory);
        await writeFile(npmPath, "#!/bin/sh\nprintf '%s\\n' \"$*\" >> \"$PREPARE_LOG\"\n[ \"$*\" != \"run validate:study-profiles\" ]\n");
        await chmod(npmPath, 0o755);
        const result = await run("sh", [ "scripts/prepare-study-deployment.sh" ], {
            ...process.env,
            PATH: `${binDirectory}:${process.env.PATH}`,
            PREPARE_LOG: logPath,
            STUDY_DATABASE_MODE: "clean",
            STUDY_PROFILES_INPUT: "/run/config/study-profiles.json",
            STUDY_CONFIG_INPUT: undefined,
        });
        assert.equal(result.status, 1);
        assert.deepEqual((await readFile(logPath, "utf8")).trim().split("\n"), [ "run validate:study-profiles" ]);
    } finally {
        await rm(directory, {recursive: true, force: true});
    }
});

test("multi-study enrichment failure propagates a nonzero prepare exit before server readiness", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "labeler-prepare-enrichment-failure-"));
    const binDirectory = path.join(directory, "bin");
    const npmPath = path.join(binDirectory, "npm");
    const logPath = path.join(directory, "npm.log");
    try {
        await mkdir(binDirectory);
        await writeFile(npmPath, [
            "#!/bin/sh",
            "printf '%s\\n' \"$*\" >> \"$PREPARE_LOG\"",
            "[ \"$*\" != \"run prepare:study-profiles\" ]",
            "",
        ].join("\n"));
        await chmod(npmPath, 0o755);
        const result = await run("sh", [ "scripts/prepare-study-deployment.sh" ], {
            ...process.env,
            PATH: `${binDirectory}:${process.env.PATH}`,
            PREPARE_LOG: logPath,
            STUDY_DATABASE_MODE: "clean",
            STUDY_PROFILES_INPUT: "/run/config/study-profiles.json",
            STUDY_CONFIG_INPUT: undefined,
        });

        assert.equal(result.status, 1);
        assert.deepEqual((await readFile(logPath, "utf8")).trim().split("\n"), [
            "run validate:study-profiles",
            "run retire:legacy:clean-check",
            "run migrate:study",
            "run prepare:study-profiles",
        ]);
    } finally {
        await rm(directory, {recursive: true, force: true});
    }
});

test("existing preparation refuses a missing passfile before migration or retirement", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "labeler-prepare-existing-"));
    const binDirectory = path.join(directory, "bin");
    const npmPath = path.join(binDirectory, "npm");
    const logPath = path.join(directory, "npm.log");
    const archivePath = path.join(directory, "legacy.dump");
    const manifestPath = path.join(directory, "legacy.manifest.json");

    try {
        await mkdir(binDirectory);
        await writeFile(npmPath, "#!/bin/sh\nprintf '%s\\n' \"$*\" >> \"$PREPARE_LOG\"\n");
        await chmod(npmPath, 0o755);
        await writeFile(archivePath, "archive");
        await writeFile(manifestPath, "manifest");
        const result = await run("sh", [ "scripts/prepare-study-deployment.sh" ], {
            ...process.env,
            PATH: `${binDirectory}:${process.env.PATH}`,
            PREPARE_LOG: logPath,
            STUDY_DATABASE_MODE: "existing",
            STUDY_CSV_PATH: "/input/cards.csv",
            STUDY_ACCOUNT_MANIFEST_FILE: "/run/secrets/study-account-manifest.json",
            LEGACY_RETIREMENT_CONFIRM: "retire-legacy-labeler",
            LEGACY_BACKUP_ARCHIVE: archivePath,
            LEGACY_BACKUP_MANIFEST: manifestPath,
            PGPASSFILE: undefined,
        });

        assert.equal(result.status, 1);
        assert.match(result.stderr, /requires a readable external retirement passfile/);
        assert.deepEqual((await readFile(logPath, "utf8")).trim().split("\n"), [
            "run validate:study-bootstrap -- /input/cards.csv",
        ]);
    } finally {
        await rm(directory, {recursive: true, force: true});
    }
});
