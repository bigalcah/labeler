import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {spawnSync, execFileSync} from "node:child_process";
import {mkdtemp, readFile, rm, writeFile} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {fileURLToPath} from "node:url";
import {parseReleaseManifest} from "../util/release-manifest.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workflowPath = path.join(root, ".github/workflows/release.yml");
const readWorkflow = () => readFile(workflowPath, "utf8");

const stepText = (workflow, name) => {
    const remainder = workflow.split(`      - name: ${name}\n`)[1];
    assert.ok(remainder, `missing release step: ${name}`);
    return remainder.split(/^\s{6}- name: /m)[0];
};

const shellForStep = (workflow, name) => {
    const shell = stepText(workflow, name).match(/^\s{8}run: \|\n([\s\S]*)$/m)?.[1];
    assert.ok(shell, `release step has no literal shell body: ${name}`);
    return shell.replace(/^ {10}/gm, "");
};

const runShell = (shell, env) => spawnSync("bash", ["-euo", "pipefail", "-c", shell], {
    cwd: root,
    encoding: "utf8",
    env: {...process.env, ...env},
});

const createTar = (archivePath, directory, files) => execFileSync("tar", [
    "--create", "--gzip", "--file", archivePath, "--directory", directory, ...files,
]);

const listTar = archivePath => execFileSync("tar", [
    "--list", "--gzip", "--file", archivePath,
], {encoding: "utf8"}).trimEnd().split("\n");

const testCommit = "0123456789abcdef0123456789abcdef01234567";
const imageReference = (name, digest) =>
    `ghcr.io/example/labeler-${name}:sha-${testCommit}@sha256:${digest.repeat(64)}`;

test("release builds and package retain the same immutable commit identity outside the production secret boundary", async () => {
    const workflow = await readWorkflow();
    const build = shellForStep(workflow, "Build release images from the validated commit");
    const packageShell = shellForStep(workflow, "Assemble the allowlisted release package");

    assert.match(build,
        /docker build --file deployment\/server\/Dockerfile --label "org\.opencontainers\.image\.revision=\$GITHUB_SHA" --tag "\$server_image" \./);
    assert.match(build,
        /docker build --file deployment\/database\/Dockerfile --label "org\.opencontainers\.image\.revision=\$GITHUB_SHA" --tag "\$database_image" \./);
    assert.doesNotMatch(packageShell, /\s--csv\s|\s--schema-produces\s|\s--schema-application-supports\s/);
    const manifestInvocation = packageShell.match(/npm run release:manifest --[\s\S]*?(?=\njq -e)/)?.[0];
    assert.ok(manifestInvocation, "package step must generate one v2 manifest");
    assert.deepEqual([...manifestInvocation.matchAll(/^\s+--([\w-]+)\s/gm)].map(match => match[1]), [
        "generation", "attempt", "commit", "server-image", "database-image", "workflow", "created-at", "output",
    ]);

    const commit = testCommit;
    const fakeImages = {
        server: {
            reference: imageReference("server", "a"),
            labels: {"org.opencontainers.image.revision": commit},
        },
        database: {
            reference: imageReference("database", "b"),
            labels: {"org.opencontainers.image.revision": commit},
        },
    };
    for (const image of Object.values(fakeImages)) {
        assert.equal(image.labels["org.opencontainers.image.revision"], commit);
        assert.match(image.reference, new RegExp(`:sha-${commit}@sha256:[a-f0-9]{64}$`));
    }

    const secretsBeforeDeploy = workflow.split(/^ {2}deploy:\n/m)[0];
    const deploy = workflow.match(/^ {2}deploy:\n([\s\S]*)$/m)?.[1];
    assert.ok(deploy, "release must contain the production deploy job");
    assert.doesNotMatch(secretsBeforeDeploy, /\$\{\{\s*secrets\./);
    assert.match(deploy, /^ {4}environment: production$/m);
    assert.deepEqual([...workflow.matchAll(/\$\{\{\s*secrets\.([A-Z0-9_]+)\s*\}\}/g)]
        .map(match => match[1]).sort(), [
        "VPS_HOST", "VPS_KNOWN_HOSTS", "VPS_SSH_PRIVATE_KEY", "VPS_USER",
    ]);

    const jobs = [...workflow.matchAll(/^ {2}([a-z][\w-]*):\n/gm)];
    for (const job of ["quality", "build", "publish", "deploy"]) {
        const index = jobs.findIndex(([, name]) => name === job);
        assert.notEqual(index, -1, `missing release job: ${job}`);
        const start = jobs[index].index;
        const end = jobs[index + 1]?.index ?? workflow.length;
        const section = workflow.slice(start, end);
        assert.match(section, /if: github\.event_name == 'push' && github\.ref == 'refs\/heads\/master'/);
    }
    assert.match(workflow, /build:\n {4}needs: quality/);
    assert.match(workflow, /publish:\n {4}needs: build/);
    assert.match(workflow, /deploy:\n {4}needs: publish/);
    assert.deepEqual([...new Set([...workflow.matchAll(/uses:\s+([^\s#]+)/g)]
        .map(match => match[1]).filter(action => !action.startsWith("./")))].sort(), [
        "actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683",
        "actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093",
        "actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020",
        "actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02",
    ]);
});

test("release packaging runs locally with fake image digests, fixed physical hashes, and rejects extra or duplicate tar entries", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "labeler-release-pipeline-v2-"));
    const githubEnvPath = path.join(directory, "github-env");
    const githubOutputPath = path.join(directory, "github-output");
    const serverReference = imageReference("server", "a");
    const databaseReference = imageReference("database", "b");

    try {
        await Promise.all([writeFile(githubEnvPath, ""), writeFile(githubOutputPath, "")]);
        const workflow = await readWorkflow();
        const packageShell = shellForStep(workflow, "Assemble the allowlisted release package");
        const packageResult = runShell(packageShell, {
            DATABASE_REFERENCE: databaseReference,
            GITHUB_ENV: githubEnvPath,
            GITHUB_OUTPUT: githubOutputPath,
            GITHUB_RUN_ATTEMPT: "3",
            GITHUB_RUN_ID: "456",
            GITHUB_RUN_NUMBER: "42",
            GITHUB_SHA: testCommit,
            RUNNER_TEMP: directory,
            SERVER_REFERENCE: serverReference,
        });
        assert.equal(packageResult.status, 0, packageResult.stderr || packageResult.stdout);

        const archivePath = (await readFile(githubEnvPath, "utf8"))
            .match(/^RELEASE_ARCHIVE=(.+)$/m)?.[1];
        assert.ok(archivePath, "package step must export the generated archive");
        const inventory = listTar(archivePath);
        assert.deepEqual(inventory, ["Caddyfile", "docker-compose.yml", "release-manifest.json"]);
        assert.equal(new Set(inventory).size, 3, "package entries must be unique");

        const manifestRaw = execFileSync("tar", [
            "--extract", "--to-stdout", "--gzip", "--file", archivePath, "release-manifest.json",
        ], {encoding: "utf8"});
        const manifest = parseReleaseManifest(manifestRaw);
        assert.equal(manifest.commit, testCommit);
        assert.equal(manifest.images.server, serverReference);
        assert.equal(manifest.images.database, databaseReference);
        assert.match(await readFile(githubOutputPath, "utf8"),
            new RegExp(`^release-id=42-3-${testCommit}$`, "m"));

        const physicalFiles = [
            ["plans/copilot-369-cards.csv", manifest.dataBundle.profiles[0].csv.sha256],
            ["plans/copilot-369-cards.manifest.json", manifest.dataBundle.profiles[0].manifest.sha256],
            ["plans/validation-30-cards.csv", manifest.dataBundle.profiles[1].csv.sha256],
            ["plans/validation-30-cards.manifest.json", manifest.dataBundle.profiles[1].manifest.sha256],
        ];
        for (const [relativePath, expectedHash] of physicalFiles) {
            const bytes = await readFile(path.join(root, relativePath));
            assert.equal(createHash("sha256").update(bytes).digest("hex"), expectedHash, relativePath);
        }

        const packageDirectory = path.join(directory, "release-package");
        const packageGate = shellForStep(workflow, "Reject unexpected or sensitive package contents");
        const validGate = runShell(packageGate, {RELEASE_ARCHIVE: archivePath});
        assert.equal(validGate.status, 0, validGate.stderr || validGate.stdout);

        await writeFile(path.join(packageDirectory, "unexpected.txt"), "not an approved package member\n");
        const extraArchive = path.join(directory, "extra.tar.gz");
        createTar(extraArchive, packageDirectory, [
            "Caddyfile", "docker-compose.yml", "release-manifest.json", "unexpected.txt",
        ]);
        const extraResult = runShell(packageGate, {RELEASE_ARCHIVE: extraArchive});
        assert.notEqual(extraResult.status, 0, "unexpected package entries must fail the workflow inventory gate");

        const duplicateArchive = path.join(directory, "duplicate.tar.gz");
        createTar(duplicateArchive, packageDirectory, [
            "Caddyfile", "docker-compose.yml", "release-manifest.json", "Caddyfile",
        ]);
        assert.equal(listTar(duplicateArchive).filter(name => name === "Caddyfile").length, 2);
        const duplicateResult = runShell(packageGate, {RELEASE_ARCHIVE: duplicateArchive});
        assert.notEqual(duplicateResult.status, 0, "duplicate package entries must fail the workflow inventory gate");
    } finally {
        await rm(directory, {recursive: true, force: true});
    }
});
