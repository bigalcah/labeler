import assert from "node:assert/strict";
// allow: SIZE_OK - these launcher contracts share one isolated fake VPS harness.
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {chmod, link, mkdir, mkdtemp, readFile, readdir, readlink, rm, symlink, writeFile} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {createReleaseManifest} from "../scripts/create-release-manifest.js";

const execute = promisify(execFile);
const launcher = new URL("../deployment/deploy-vps.sh", import.meta.url).pathname;
const csv = Buffer.from("id,title\n1,Example\n");
let packageCounter = 0;

const releaseManifest = (_releaseId, generation, produces, supports = [produces]) => {
    const commit = generation.toString(16).padStart(40, "0");
    return createReleaseManifest({
        generation,
        attempt: 1,
        commit,
        serverImage: `ghcr.io/example/labeler-server:sha-${commit}@sha256:${String(generation % 10).repeat(64)}`,
        databaseImage: `ghcr.io/example/labeler-database:sha-${commit}@sha256:${"d".repeat(64)}`,
        schemaProduces: produces,
        applicationSupports: supports,
        workflow: "release.yml",
        createdAt: "2026-09-12T00:00:00Z",
        csv,
    });
};

const runLauncher = (command, environment, archive) => new Promise((resolve, reject) => {
    const child = execFile("/bin/bash", [launcher], {
        env: {...environment, SSH_ORIGINAL_COMMAND: command},
        encoding: "utf8",
    }, (error, stdout, stderr) => {
        if (error && typeof error.code !== "number") {
            reject(error);
            return;
        }
        resolve({status: error?.code ?? 0, stdout, stderr});
    });
    child.stdin.on("error", error => {
        if (error.code !== "EPIPE") reject(error);
    });
    if (archive) child.stdin.end(archive);
    else child.stdin.end();
});

const createFixture = async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "labeler-vps-launcher-"));
    const deployRoot = path.join(root, "host-state");
    const bin = path.join(root, "bin");
    const external = path.join(root, "external");
    const commandLog = path.join(root, "commands.log");
    await Promise.all([mkdir(deployRoot), mkdir(bin), mkdir(external)]);
    const envFile = path.join(external, "production.env");
    await writeFile(envFile, "DATABASE_NAME=labeling\nDATABASE_USER=labeler\nPUBLIC_HOSTNAME=labeler.example\nAPP_ORIGIN=https://labeler.example\n");
    const docker = path.join(bin, "docker");
    await writeFile(docker, `#!/bin/bash
set -eu
printf 'docker %s server=%s\\n' "$*" "\${LABELER_SERVER_IMAGE:-unset}" >> "$COMMAND_LOG"
if [[ "$*" == *"config --format json"* ]]; then
    [[ "\${FAKE_CONFIG_FAIL:-0}" != 1 ]]
    printf '{"name":"%s","services":{"labeling-database":{"container_name":"labeling-database","image":"%s","volumes":[{"type":"volume","source":"data","target":"/var/lib/postgresql/data","volume":{}}]},"labeling-study-prepare":{"image":"%s"},"labeling-server":{"container_name":"labeling-server","image":"%s"},"labeling-caddy":{"container_name":"labeling-caddy","environment":{"PUBLIC_HOSTNAME":"labeler.example"}}},"networks":{"default":{"name":"labeling-network"}},"volumes":{"data":{"name":"labeling-data"}}}\\n' "\${FAKE_PROJECT_NAME:-labeling}" "$LABELER_DATABASE_IMAGE" "$LABELER_SERVER_IMAGE" "$LABELER_SERVER_IMAGE"
elif [[ "$1 $2" == "image inspect" ]]; then
    image="\${@: -1}"
    repository_with_tag="\${image%@*}"
    repository="\${repository_with_tag%:*}"
    digest="\${image##*@}"
    if [[ "\${FAKE_DIGEST_FAIL:-0}" == 1 && "$image" == "$LABELER_SERVER_IMAGE" ]]; then printf '[]\\n'; else printf '["%s@%s"]\\n' "$repository" "$digest"; fi
elif [[ "$1" == inspect ]]; then
    printf '%s\\n' "\${FAKE_DATABASE_HEALTH:-healthy}"
elif [[ "$1" == run ]]; then
    printf '%s  %s\\n' "\${FAKE_CSV_SHA256:-$LABELER_RELEASE_CSV_SHA256}" "$LABELER_RELEASE_CSV_PATH"
elif [[ "$*" == *"labeling-study-prepare"* ]]; then
    [[ "\${FAKE_PREPARE_FAIL:-0}" != 1 ]]
elif [[ "$*" == *"labeling-server labeling-caddy"* ]]; then
    [[ "\${FAKE_RUNTIME_FAIL:-0}" != 1 ]]
fi
`);
    const curl = path.join(bin, "curl");
    await writeFile(curl, "#!/bin/bash\nset -eu\nprintf 'curl %s\\n' \"$*\" >> \"$COMMAND_LOG\"\n[[ \"${FAKE_SMOKE_FAIL:-0}\" != 1 ]]\n");
    const backup = path.join(external, "verified-backup");
    await writeFile(backup, "#!/bin/bash\nset -eu\nprintf 'backup\\n' >> \"$COMMAND_LOG\"\nsleep \"${FAKE_BACKUP_DELAY:-0}\"\n[[ \"${FAKE_BACKUP_FAIL:-0}\" != 1 ]]\nprintf 'STUDY_BACKUP_VERIFIED\\n'\n");
    await Promise.all([chmod(docker, 0o755), chmod(curl, 0o755), chmod(backup, 0o755)]);
    const environment = {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        COMMAND_LOG: commandLog,
        LABELER_DEPLOY_ROOT: deployRoot,
        LABELER_ENV_FILE: envFile,
        LABELER_BACKUP_COMMAND: backup,
        LABELER_PUBLIC_BASE_URL: "https://labeler.example",
    };
    delete environment.PGPASSWORD;
    delete environment.STUDY_BACKUP_ENCRYPTION_PASSPHRASE;
    return {root, deployRoot, commandLog, environment};
};

const packageArchive = async (fixture, manifest, variant = "valid") => {
    packageCounter += 1;
    const packageRoot = path.join(fixture.root, `package-${packageCounter}-${variant}`);
    const archivePath = path.join(fixture.root, `package-${packageCounter}-${variant}.tar`);
    await mkdir(packageRoot);
    await Promise.all([
        writeFile(path.join(packageRoot, "release-manifest.json"), `${JSON.stringify(manifest)}\n`),
        writeFile(path.join(packageRoot, "docker-compose.yml"), "services: {}\n"),
        writeFile(path.join(packageRoot, "Caddyfile"), "https://{$PUBLIC_HOSTNAME} {}\n"),
    ]);
    const entries = ["release-manifest.json", "docker-compose.yml", "Caddyfile"];
    if (variant === "duplicate") entries.push("release-manifest.json");
    if (variant === "symlink") {
        await rm(path.join(packageRoot, "Caddyfile"));
        await symlink("docker-compose.yml", path.join(packageRoot, "Caddyfile"));
    }
    if (variant === "hardlink") {
        await rm(path.join(packageRoot, "Caddyfile"));
        await link(path.join(packageRoot, "docker-compose.yml"), path.join(packageRoot, "Caddyfile"));
    }
    if (variant === "extra") {
        await writeFile(path.join(packageRoot, "notes.txt"), "undeclared\n");
        entries.push("notes.txt");
    }
    if (variant === "traversal") {
        await writeFile(path.join(packageRoot, "escape"), "escape\n");
        entries.push("--transform=s|escape|../escape|", "escape");
    }
    await execute("tar", ["-cf", archivePath, ...entries], {cwd: packageRoot});
    return readFile(archivePath);
};

const deploy = async (fixture, manifest, environment = fixture.environment, variant) => runLauncher(
    `deploy ${manifest.releaseId}`,
    environment,
    await packageArchive(fixture, manifest, variant),
);

const currentRelease = async deployRoot => {
    try {
        return await readlink(path.join(deployRoot, "current"));
    } catch (error) {
        if (error.code === "ENOENT") return undefined;
        throw error;
    }
};

const latestEvidence = async (deployRoot, releaseId) => {
    const root = path.join(deployRoot, "evidence", releaseId);
    const [attempt] = (await readdir(root)).sort().reverse();
    return path.join(root, attempt);
};

test("forced SSH streams a generated release package and verifies images and CSV before backup and preparation", async () => {
    const fixture = await createFixture();
    try {
        const manifest = releaseManifest("release-10", 10, "schema-1");
        const result = await deploy(fixture, manifest);
        const commands = await readFile(fixture.commandLog, "utf8");

        assert.equal(result.status, 0, result.stderr);
        assert.ok(commands.indexOf("image inspect") < commands.indexOf("backup"));
        assert.ok(commands.indexOf("--entrypoint sha256sum") < commands.indexOf("backup"));
        assert.ok(commands.indexOf("backup") < commands.indexOf("labeling-study-prepare"));
        assert.ok(commands.indexOf("labeling-study-prepare") < commands.indexOf("labeling-server labeling-caddy"));
        assert.equal(await currentRelease(fixture.deployRoot), `releases/${manifest.releaseId}`);
        assert.deepEqual((await readdir(path.join(fixture.deployRoot, "releases", manifest.releaseId))).sort(), ["Caddyfile", "docker-compose.yml", "release-manifest.json"]);
    } finally {
        await rm(fixture.root, {recursive: true, force: true});
    }
});

test("archive ingress rejects traversal, links, duplicate, and undeclared entries before Docker", async () => {
    for (const variant of ["traversal", "symlink", "hardlink", "duplicate", "extra"]) {
        const fixture = await createFixture();
        try {
            const manifest = releaseManifest(`hostile-${variant}`, 11, "schema-1");
            const result = await deploy(fixture, manifest, fixture.environment, variant);

            assert.notEqual(result.status, 0, variant);
            assert.equal(await currentRelease(fixture.deployRoot), undefined, variant);
            await assert.rejects(readFile(fixture.commandLog), {code: "ENOENT"});
        } finally {
            await rm(fixture.root, {recursive: true, force: true});
        }
    }
});

test("forced SSH accepts only the exact allowlisted command shape", async () => {
    const fixture = await createFixture();
    try {
        const manifest = releaseManifest("release-12", 12, "schema-1");
        const archive = await packageArchive(fixture, manifest);
        const result = await runLauncher(`deploy  ${manifest.releaseId}`, fixture.environment, archive);

        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /not authorized/);
        assert.equal(await currentRelease(fixture.deployRoot), undefined);
    } finally {
        await rm(fixture.root, {recursive: true, force: true});
    }
});

test("digest or embedded CSV mismatch fails before backup and preserves evidence", async () => {
    for (const failure of [{FAKE_DIGEST_FAIL: "1"}, {FAKE_CSV_SHA256: "f".repeat(64)}]) {
        const fixture = await createFixture();
        try {
            const manifest = releaseManifest("release-20", 20, "schema-1");
            const result = await deploy(fixture, manifest, {...fixture.environment, ...failure});
            const commands = await readFile(fixture.commandLog, "utf8");
            const evidence = await latestEvidence(fixture.deployRoot, manifest.releaseId);

            assert.notEqual(result.status, 0);
            assert.doesNotMatch(commands, /backup|labeling-study-prepare/);
            assert.match(await readFile(path.join(evidence, "result"), "utf8"), /^FAILED /);
            assert.equal(await currentRelease(fixture.deployRoot), undefined);
        } finally {
            await rm(fixture.root, {recursive: true, force: true});
        }
    }
});

test("rendered Compose with a different project identity fails before backup and preparation", async () => {
    const fixture = await createFixture();
    try {
        const manifest = releaseManifest("release-19", 19, "schema-1");

        const result = await deploy(fixture, manifest, {...fixture.environment, FAKE_PROJECT_NAME: "other"});
        const commands = await readFile(fixture.commandLog, "utf8");

        assert.notEqual(result.status, 0);
        assert.doesNotMatch(commands, /backup|labeling-study-prepare/);
        assert.equal(await currentRelease(fixture.deployRoot), undefined);
    } finally {
        await rm(fixture.root, {recursive: true, force: true});
    }
});

test("production configuration with an inline database secret fails under lock before Docker or backup", async () => {
    const fixture = await createFixture();
    try {
        const manifest = releaseManifest("release-18", 18, "schema-1");
        await writeFile(fixture.environment.LABELER_ENV_FILE, "PGPASSWORD=forbidden\n");

        const result = await deploy(fixture, manifest);
        const evidence = await latestEvidence(fixture.deployRoot, manifest.releaseId);

        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /forbidden inline secret/);
        assert.match(await readFile(path.join(evidence, "result"), "utf8"), /^FAILED /);
        await assert.rejects(readFile(fixture.commandLog), {code: "ENOENT"});
        assert.equal(await currentRelease(fixture.deployRoot), undefined);
    } finally {
        await rm(fixture.root, {recursive: true, force: true});
    }
});

test("preflight, backup, or preparation failure never publishes candidate state or starts candidate runtime", async () => {
    for (const failure of [{FAKE_CONFIG_FAIL: "1"}, {FAKE_BACKUP_FAIL: "1"}, {FAKE_PREPARE_FAIL: "1"}]) {
        const fixture = await createFixture();
        try {
            const baseline = releaseManifest("release-1", 1, "schema-1");
            assert.equal((await deploy(fixture, baseline)).status, 0);
            await writeFile(fixture.commandLog, "");
            const candidate = releaseManifest("release-21", 21, "schema-1");
            const result = await deploy(fixture, candidate, {...fixture.environment, ...failure});
            const commands = await readFile(fixture.commandLog, "utf8");

            assert.notEqual(result.status, 0);
            assert.equal(await currentRelease(fixture.deployRoot), `releases/${baseline.releaseId}`);
            assert.equal(await readFile(path.join(fixture.deployRoot, "state", "highest-generation"), "utf8"), "1\n");
            assert.doesNotMatch(commands, /labeling-server labeling-caddy/);
            assert.equal((await deploy(fixture, candidate)).status, 0, "an identical streamed package must be retryable");
            assert.equal(await currentRelease(fixture.deployRoot), `releases/${candidate.releaseId}`);
        } finally {
            await rm(fixture.root, {recursive: true, force: true});
        }
    }
});

test("runtime failure restores the active application with its own Compose release before returning failure", async () => {
    const fixture = await createFixture();
    try {
        const baseline = releaseManifest("release-22", 22, "schema-1", [ "schema-1", "schema-2" ]);
        assert.equal((await deploy(fixture, baseline)).status, 0);
        await writeFile(fixture.commandLog, "");
        const candidate = releaseManifest("release-23", 23, "schema-2");

        const result = await deploy(fixture, candidate, {...fixture.environment, FAKE_RUNTIME_FAIL: "1"});
        const commands = await readFile(fixture.commandLog, "utf8");
        const baselineCompose = path.join(fixture.deployRoot, "releases", baseline.releaseId, "docker-compose.yml");

        assert.notEqual(result.status, 0);
        assert.equal(await currentRelease(fixture.deployRoot), `releases/${baseline.releaseId}`);
        assert.match(commands, new RegExp(`-f ${baselineCompose} up -d --no-build --no-deps --wait labeling-server labeling-caddy`));
    } finally {
        await rm(fixture.root, {recursive: true, force: true});
    }
});

test("the host lock serializes streamed releases and rejects a stale generation", async () => {
    const fixture = await createFixture();
    try {
        const newerManifest = releaseManifest("release-30", 30, "schema-1");
        const olderManifest = releaseManifest("release-29", 29, "schema-1");
        const newerArchive = await packageArchive(fixture, newerManifest);
        const olderArchive = await packageArchive(fixture, olderManifest);
        const newer = runLauncher(`deploy ${newerManifest.releaseId}`, {...fixture.environment, FAKE_BACKUP_DELAY: "0.3"}, newerArchive);
        await new Promise(resolve => setTimeout(resolve, 50));
        const older = runLauncher(`deploy ${olderManifest.releaseId}`, fixture.environment, olderArchive);
        const [newerResult, olderResult] = await Promise.all([newer, older]);

        assert.equal(newerResult.status, 0, newerResult.stderr);
        assert.notEqual(olderResult.status, 0);
        assert.match(olderResult.stderr, /stale generation/i);
        assert.equal(await currentRelease(fixture.deployRoot), `releases/${newerManifest.releaseId}`);
    } finally {
        await rm(fixture.root, {recursive: true, force: true});
    }
});

test("rollback requires declared schema compatibility and never invokes dependencies or database rollback", async () => {
    for (const compatible of [false, true]) {
        const fixture = await createFixture();
        try {
            const supports = compatible ? ["schema-1", "schema-2"] : ["schema-1"];
            const previousManifest = releaseManifest("release-40", 40, "schema-1", supports);
            const currentManifest = releaseManifest("release-41", 41, "schema-2");
            assert.equal((await deploy(fixture, previousManifest)).status, 0);
            assert.equal((await deploy(fixture, currentManifest)).status, 0);
            await writeFile(fixture.commandLog, "");
            const result = await runLauncher("rollback", fixture.environment);
            const commands = await readFile(fixture.commandLog, "utf8").catch(() => "");

            assert.equal(result.status, compatible ? 0 : 1, result.stderr);
            assert.equal(await currentRelease(fixture.deployRoot), `releases/${compatible ? previousManifest.releaseId : currentManifest.releaseId}`);
            if (compatible) {
                const previousCompose = path.join(fixture.deployRoot, "releases", previousManifest.releaseId, "docker-compose.yml");
                assert.match(commands, new RegExp(`-f ${previousCompose} up -d --no-build --no-deps --wait labeling-server labeling-caddy`));
            }
            assert.doesNotMatch(commands, /down|volume|up .*labeling-database|labeling-study-prepare/);
        } finally {
            await rm(fixture.root, {recursive: true, force: true});
        }
    }
});
