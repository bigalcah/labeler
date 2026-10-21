import assert from "node:assert/strict";
import {execFile, spawnSync} from "node:child_process";
import {mkdir, mkdtemp, readFile, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {promisify} from "node:util";
import path from "node:path";
import {randomUUID} from "node:crypto";
import {CUTOVER_CONFIRMATION, LEGACY_300_CHECKSUM} from "../../util/copilot-369-cutover-preflight.js";
import {COPILOT_369_SOURCE_CHECKSUM} from "../../util/copilot-369-source.js";
import {stageNodeContainerInputs} from "./container-input-staging.js";

const execute = promisify(execFile);
const root = path.resolve(new URL("../..", import.meta.url).pathname);
const dockerShim = `#!/usr/bin/env node
import {spawnSync} from "node:child_process";
    const argumentsList = process.argv.slice(2);
if (argumentsList[0] === "run") {
    const networkIndex = argumentsList.indexOf("--network");
    if (argumentsList[networkIndex + 1] === "labeling-network") {
        argumentsList[networkIndex + 1] = process.env.LABELER_TEST_NETWORK;
    }
}
const result = spawnSync(process.env.LABELER_REAL_DOCKER, argumentsList, {stdio: "inherit"});
if (result.error) process.stderr.write(result.error.message + "\\n");
process.exitCode = result.status ?? 1;
`;
const compose = database => `services:
  labeling-study-prepare:
    image: \${LABELER_READINESS_TEST_IMAGE}
    working_dir: /labeling
    read_only: true
    user: "1000:1000"
    cap_drop:
      - ALL
    tmpfs:
      - /tmp:rw,noexec,nosuid,nodev,size=64m
    volumes:
      - "\${REPOSITORY_ROOT}/util:/labeling/util:ro"
      - "\${REPOSITORY_ROOT}/scripts:/labeling/scripts:ro"
      - "\${REPOSITORY_ROOT}/schema:/labeling/schema:ro"
    environment:
      DATABASE_HOST: labeling-database
      DATABASE_PORT: "5432"
      DATABASE_NAME: "${database.pool.options.database}"
      DATABASE_USER: labeler_test
networks:
  default:
    external: true
    name: \${LABELER_TEST_NETWORK}
`;

const stageMaintenanceReaderInputs = async ({directory, metadata}) => {
    assert.deepEqual(Object.keys(metadata), ["LABELER_READINESS_TEST_IMAGE", "REPOSITORY_ROOT", "LABELER_TEST_NETWORK"]);
    const envFile = path.join(directory, "runtime.env");
    assert.equal(await readFile(envFile, "utf8") === Object.entries(metadata).map(([key, value]) => `${key}=${value}\n`).join(""),
        true, "Maintenance fixture runtime metadata mismatch");
    const staged = await stageNodeContainerInputs({sourceDirectory: directory, destinationDirectory: directory,
        inputMappings: ["runtime.env", "cutover-request.json", "database-password"].map(name => ({source: name, destination: name})),
        helperImage: "python:3.12-alpine"});
    const result = spawnSync("docker", ["run", "--rm", "--network", "none", "--read-only", "--user", "0",
        "--cap-drop", "ALL", "--cap-add", "CHOWN", "--cap-add", "DAC_OVERRIDE", "--cap-add", "FOWNER",
        "--mount", `type=bind,src=${staged},dst=/stage`, "python:3.12-alpine", "python3", "-B", "-c",
        "import os,sys;os.chmod('/stage/runtime.env',0o444);os.chown('/stage/cutover-request.json',1000,int(sys.argv[1]));os.chmod('/stage/cutover-request.json',0o440)",
        String(process.getgid())], {encoding: "utf8", maxBuffer: 1048576});
    assert.equal(result.status, 0, "fixture maintenance reader metadata setup failed");
    return {envFile: path.join(staged, "runtime.env"), requestPath: path.join(staged, "cutover-request.json"),
        passwordPath: path.join(staged, "database-password")};
};

const runRealMaintenanceEntrypoint = async ({database, primaryStudyId}) => {
    const image = process.env.LABELER_READINESS_TEST_IMAGE;
    assert.ok(image, "LABELER_READINESS_TEST_IMAGE must name the current source image");
    const directory = await mkdtemp(path.join(tmpdir(), "post015-maintenance-"));
    const project = `post015-maintenance-${randomUUID()}`;
    const network = `${project}-network`;
    const composeFile = path.join(directory, "compose.yml");
    const envFile = path.join(directory, "runtime.env");
    let readerEnvFile = envFile;
    let composeCreated = false;
    let networkCreated = false;
    let networkConnected = false;
    let report;
    try {
        const dockerPath = (await execute("which", ["docker"])).stdout.trim();
        await execute("docker", ["network", "create", "--label", `com.labeler.normalization-test=${project}`, network]);
        networkCreated = true;
        await execute("docker", ["network", "connect", "--alias", "labeling-database", network, database.containerName]);
        networkConnected = true;
        const bin = path.join(directory, "bin");
        await mkdir(bin);
        const dockerExecutable = path.join(bin, "docker");
        await writeFile(dockerExecutable, dockerShim, {mode: 0o755});
        const requestPath = path.join(directory, "cutover-request.json");
        const passwordPath = path.join(directory, "database-password");
        const {rows: [study]} = await database.pool.query("SELECT config FROM study WHERE id = $1", [primaryStudyId]);
        const {rows: memberships} = await database.pool.query(`SELECT pr_card_id, source_card_id, ordinal, source_checksum
            FROM study_card WHERE study_id = $1 ORDER BY ordinal`, [primaryStudyId]);
        await writeFile(passwordPath, "isolated-cutover-password\n", {mode: 0o400});
        await writeFile(requestPath, JSON.stringify({confirmation: CUTOVER_CONFIRMATION,
            maintenance: {applicationStopped: true, preparationStopped: true,
                enrichmentStopped: true, schemaWritersStopped: true},
            expectedStudyId: primaryStudyId, expectedStudyKey: "pr-card-sorting-local",
            expectedLegacyConfig: study.config, expectedLegacyChecksum: LEGACY_300_CHECKSUM,
            expectedTargetChecksum: COPILOT_369_SOURCE_CHECKSUM, expectedLegacyMemberships: memberships,
            legacyCsvPath: "/labeling/data/pr-cards.csv", targetCsvPath: "/labeling/data/copilot-369-cards.csv",
            targetManifestPath: "/labeling/data/copilot-369-cards.manifest.json",
            database: {host: "labeling-database", port: 5432, database: database.pool.options.database,
                user: "labeler_test", passwordFile: path.join(directory, "container-inputs/database-password")}}), {mode: 0o400});
        const metadata = {LABELER_READINESS_TEST_IMAGE: image, REPOSITORY_ROOT: root, LABELER_TEST_NETWORK: network};
        await writeFile(envFile, Object.entries(metadata).map(([key, value]) => `${key}=${value}\n`).join(""), {mode: 0o400});
        const staged = await stageMaintenanceReaderInputs({directory, metadata});
        readerEnvFile = staged.envFile;
        await writeFile(composeFile, compose(database), {mode: 0o600});
        composeCreated = true;
        const result = spawnSync("python3", ["-B", path.join(root, "test/fixtures/host/real-maintenance.py")], {
            encoding: "utf8", timeout: 180000, maxBuffer: 1048576,
            env: {...process.env, PATH: `${bin}:${process.env.PATH}`, LABELER_REPOSITORY_ROOT: root,
                LABELER_REAL_DOCKER: dockerPath,
                LABELER_TEST_DATABASE_CONTAINER: database.containerName, LABELER_TEST_NETWORK: network,
                LABELER_TEST_COMPOSE_PROJECT: project,
                LABELER_TEST_COMPOSE_FILE: composeFile, LABELER_READINESS_TEST_IMAGE: image,
                LABELER_DEPLOY_ROOT: path.join(directory, "host-state"), LABELER_ENV_FILE: staged.envFile,
                LABELER_PUBLIC_BASE_URL: "https://localhost", LABELER_DATABASE_NAME: database.pool.options.database,
                LABELER_CUTOVER_REQUEST_FILE: staged.requestPath},
        });
        assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
        report = JSON.parse(result.stdout);
    } finally {
        if (composeCreated) {
            await execute("docker", ["compose", "--project-name", project, "--env-file", readerEnvFile,
                "--file", composeFile, "down", "--remove-orphans"], {timeout: 30000});
            const containers = await execute("docker", ["ps", "-a", "--filter", `label=com.docker.compose.project=${project}`, "--format", "{{.ID}}"]);
            const networks = await execute("docker", ["network", "ls", "--filter", `label=com.docker.compose.project=${project}`, "--format", "{{.ID}}"]);
            assert.equal(containers.stdout.trim(), "", `Compose project ${project} left a container`);
            assert.equal(networks.stdout.trim(), "", `Compose project ${project} left a network`);
        }
        if (networkConnected) await execute("docker", ["network", "disconnect", "--force", network, database.containerName]);
        if (networkCreated) {
            await execute("docker", ["network", "rm", network]);
            const networks = await execute("docker", ["network", "ls", "--filter", `label=com.labeler.normalization-test=${project}`, "--format", "{{.ID}}"]);
            assert.equal(networks.stdout.trim(), "", `normalization network ${network} was not removed`);
        }
        await rm(directory, {recursive: true, force: true});
    }
    return report;
};

export {runRealMaintenanceEntrypoint, stageMaintenanceReaderInputs};
