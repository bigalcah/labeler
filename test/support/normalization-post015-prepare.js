import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {execFile} from "node:child_process";
import {writeFile} from "node:fs/promises";
import {promisify} from "node:util";
import path from "node:path";
import {probeStudyNormalization} from "../../util/study-readiness.js";
import {stageReadinessContainerInputs} from "./readiness-container-inputs.js";

const execute = promisify(execFile);
const root = path.resolve(new URL("../..", import.meta.url).pathname);
const contextDriver = `import sys,json;from pathlib import Path
sys.path.insert(0,'/workspace/test')
from host_fixture import adopted,auth,candidate
from state import State
source=json.loads(Path('/fixture/observation.json').read_text())
root=Path('/fixture/host');root.mkdir(mode=0o700)
state=State(root);adopted(state,source)
directory,release,binding=candidate(root)
receipt=state.reserve(binding,source,auth())
receipt=state.advance(receipt,'pending')
print(state.handoff(receipt,source,1000))`;

const probePost015Normalization = async (database, profiles, legacyCsvPath) => {
    const databaseName = database.pool.options.database;
    const role = `post015_inspector_${randomUUID().replaceAll("-", "")}`;
    await database.pool.query(`CREATE ROLE ${role} LOGIN;
        REVOKE CREATE ON SCHEMA public FROM PUBLIC;
        REVOKE TEMP ON DATABASE "${databaseName}" FROM PUBLIC;
        GRANT pg_read_all_stats TO ${role};
        GRANT CONNECT ON DATABASE "${databaseName}" TO ${role};
        GRANT USAGE ON SCHEMA public TO ${role};
        GRANT SELECT ON ALL TABLES IN SCHEMA public TO ${role};
        GRANT EXECUTE ON FUNCTION pg_control_system() TO ${role}`);
    const client = await database.pool.connect();
    try {
        await client.query(`SET SESSION AUTHORIZATION ${role}`);
        const restrictedPool = {connect: async () => ({
            query: (query, values) => client.query(query, values),
            release: () => {},
        })};
        const probe = await probeStudyNormalization({pool: restrictedPool, profiles, legacyCsvPath, requireRestrictedRole: true});
        probe.observation.databaseIdentity.endpoint = `fixture:${database.containerName}`;
        probe.observation.databaseIdentity.volume = `disposable:${database.containerName}`;
        return probe;
    } finally {
        await client.query("SET SESSION AUTHORIZATION DEFAULT");
        client.release();
    }
};

const createHandoff = async (fixtureRoot, observation) => {
    await writeFile(path.join(fixtureRoot, "observation.json"), JSON.stringify(observation));
    const result = await execute("docker", ["run", "--rm", "--network", "none", "--read-only",
        "--mount", `type=bind,src=${root},dst=/workspace,readonly`,
        "--mount", `type=bind,src=${fixtureRoot},dst=/fixture`,
        "python:3.12-alpine", "python3", "-B", "-c", contextDriver], {timeout: 30000});
    return path.join(fixtureRoot, path.relative("/fixture", result.stdout.trim()));
};

const removeHandoff = async fixtureRoot => execute("docker", ["run", "--rm", "--network", "none", "--read-only",
    "--mount", `type=bind,src=${fixtureRoot},dst=/fixture`, "python:3.12-alpine", "python3", "-B", "-c",
    "import shutil;from pathlib import Path;root=Path('/fixture/host');shutil.rmtree(root) if root.exists() else None"],
{timeout: 30000});

const runPost015Prepare = async ({database, fixture, observation}) => {
    const image = process.env.LABELER_READINESS_TEST_IMAGE;
    assert.ok(image, "LABELER_READINESS_TEST_IMAGE must name the current source image");
    const descriptor = path.join(fixture.root, "mounted-profiles.json");
    const password = path.join(fixture.root, `database-password-${randomUUID()}`);
    await writeFile(password, "isolated-post015-prepare-password\n", {mode: 0o400});
    await writeFile(descriptor, JSON.stringify({profiles: fixture.profiles.map((profile, index) => ({
        config: `/run/config/studies/${index}.json`,
        accountManifest: `/run/secrets/studies/${index}.json`,
        csv: `/labeling/data/${path.basename(profile.csvPath)}`,
        enrichmentEnabled: false,
    }))}));
    const containerName = `post015-prepare-${randomUUID()}`;
    const handoff = observation ? await createHandoff(fixture.root, observation) : null;
    const staged = await stageReadinessContainerInputs({fixtureRoot: fixture.root, descriptor, password});
    const mounts = [
        [path.join(root, "util"), "/labeling/util"],
        [path.join(root, "scripts"), "/labeling/scripts"],
        [path.join(root, "schema/migrations"), "/labeling/schema/migrations"],
        [staged.config, "/run/config/studies"],
        [staged.accountManifest, "/run/secrets/studies"],
        [staged.password, "/run/secrets/database-password"],
        [staged.csv, "/labeling/data"],
        [staged.descriptor, "/run/config/study-profiles.json"],
    ];
    if (handoff) mounts.push([handoff, "/run/labeler-release/context.json"]);
    const argumentsList = ["run", "--rm", "--name", containerName, "--read-only",
        "--network", `container:${database.containerName}`, "--tmpfs", "/tmp:rw,noexec,nosuid,nodev,size=64m",
        ...mounts.flatMap(([source, target]) => ["--mount", `type=bind,src=${source},dst=${target},readonly`]),
        "-e", "DATABASE_HOST=127.0.0.1", "-e", "DATABASE_PORT=5432",
        "-e", `DATABASE_NAME=${database.pool.options.database}`, "-e", "DATABASE_USER=labeler_test",
        "-e", "DATABASE_PASS_FILE=/run/secrets/database-password",
        "-e", "STUDY_DATABASE_MODE=clean", "-e", "STUDY_PROFILES_INPUT=/run/config/study-profiles.json",
        "-e", "GITHUB_ENRICHMENT_ENABLED=false"];
    if (handoff) argumentsList.push("-e", "LABELER_RELEASE_CONTEXT=/run/labeler-release/context.json");
    try {
        return await execute("docker", [...argumentsList, "--entrypoint", "sh", image,
            "scripts/prepare-study-deployment.sh"], {timeout: 90000, maxBuffer: 1048576});
    } finally {
        if (handoff) await removeHandoff(fixture.root);
        const containers = await execute("docker", ["ps", "-a", "--filter", `name=^/${containerName}$`, "--format", "{{.ID}}"]);
        assert.equal(containers.stdout.trim(), "", `prepare container ${containerName} was not removed`);
    }
};

export {probePost015Normalization, runPost015Prepare};
