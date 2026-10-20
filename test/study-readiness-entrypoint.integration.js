import assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {rm, writeFile, chmod} from "node:fs/promises";
import path from "node:path";
import {test} from "node:test";
import pg from "pg";
import {classifyStudyReadiness} from "../util/study-readiness.js";
import {createReadinessProfiles} from "./readiness-fixture.js";
import {startCopilot369Database, closeCopilot369Database} from "./support/copilot-369-fixture.js";

const execute = promisify(execFile);
const root = path.resolve(new URL("..", import.meta.url).pathname);

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

test("actual preparation entrypoint creates 369 then 30 and the next invocation is entirely readonly", async () => {
    const database = await startCopilot369Database({throughMigration: "001_study_foundation"});
    const fixture = await createReadinessProfiles();
    try {
        await database.pool.query(`CREATE ROLE readiness_fixture_inspector LOGIN;
            REVOKE CREATE ON SCHEMA public FROM PUBLIC;
            REVOKE TEMP ON DATABASE labeler_test FROM PUBLIC;
            GRANT pg_read_all_stats TO readiness_fixture_inspector;
            GRANT CONNECT ON DATABASE labeler_test TO readiness_fixture_inspector;
            GRANT USAGE ON SCHEMA public TO readiness_fixture_inspector;
            GRANT SELECT ON ALL TABLES IN SCHEMA public TO readiness_fixture_inspector;
            ALTER DEFAULT PRIVILEGES FOR ROLE labeler_test IN SCHEMA public GRANT SELECT ON TABLES TO readiness_fixture_inspector;
            GRANT EXECUTE ON FUNCTION pg_control_system() TO readiness_fixture_inspector`);
        const options = database.pool.options;
        await database.pool.end();
        database.pool = new pg.Pool({...options, max: 1});
        const inspection = new pg.Pool({...options, user: "readiness_fixture_inspector", max: 1});
        let origin;
        try {
            origin = await classifyStudyReadiness({pool: inspection, profiles: fixture.profiles, requireRestrictedRole: true});
        } finally {
            await inspection.end();
        }
        assert.equal(origin.readOnly.writersStopped, true);
        origin.databaseIdentity.endpoint = `fixture:${database.containerName}`;
        origin.databaseIdentity.volume = `disposable:${database.containerName}`;
        await writeFile(path.join(fixture.root, "observation.json"), JSON.stringify(origin));
        const context = await execute("docker", ["run", "--rm", "--network", "none", "--read-only",
            "--mount", `type=bind,src=${root},dst=/workspace,readonly`, "--mount", `type=bind,src=${fixture.root},dst=/fixture`,
            "python:3.12-alpine", "python3", "-B", "-c", contextDriver], {timeout: 30000});
        const contextPath = path.join(fixture.root, path.relative("/fixture", context.stdout.trim()));
        const descriptor = path.join(fixture.root, "mounted-profiles.json");
        await writeFile(descriptor, JSON.stringify({profiles: fixture.profiles.map((profile, index) => ({
            config: `/run/config/studies/${index}.json`, accountManifest: `/run/secrets/studies/${index}.json`,
            csv: `/labeling/data/${path.basename(profile.csvPath)}`, enrichmentEnabled: false,
        }))}));
        const password = path.join(fixture.root, "database-password");
        await writeFile(password, "isolated-fixture-password\n");
        await chmod(password, 0o400);
        const mounts = [
            [path.join(root, "util"), "/labeling/util"], [path.join(root, "scripts"), "/labeling/scripts"],
            [path.join(fixture.root, "config"), "/run/config/studies"], [path.join(fixture.root, "accountManifest"), "/run/secrets/studies"],
            [descriptor, "/run/config/study-profiles.json"], [password, "/run/secrets/database-password"],
        ];
        const argumentsList = ["run", "--rm", "--read-only", "--network", `container:${database.containerName}`,
            "--tmpfs", "/tmp:rw,noexec,nosuid,nodev,size=64m", ...mounts.flatMap(([source, target]) => ["--mount", `type=bind,src=${source},dst=${target},readonly`]),
            "-e", "DATABASE_HOST=127.0.0.1", "-e", "DATABASE_PORT=5432", "-e", "DATABASE_NAME=labeler_test", "-e", "DATABASE_USER=labeler_test",
            "-e", "DATABASE_PASS_FILE=/run/secrets/database-password", "-e", "STUDY_DATABASE_MODE=clean", "-e", "STUDY_PROFILES_INPUT=/run/config/study-profiles.json",
            "-e", "GITHUB_ENRICHMENT_ENABLED=false"];
        const command = ["--entrypoint", "sh", process.env.LABELER_READINESS_TEST_IMAGE || "labeler-copilot369-local:b5cddf3", "scripts/prepare-study-deployment.sh"];
        await assert.rejects(execute("docker", [...argumentsList, ...command], {timeout: 30000}), /root-owned pending handoff/);
        const first = await execute("docker", [...argumentsList, "--mount", `type=bind,src=${contextPath},dst=/run/labeler-release/context.json,readonly`,
            "-e", "LABELER_RELEASE_CONTEXT=/run/labeler-release/context.json", ...command], {timeout: 90000, maxBuffer: 1048576});
        assert.ok(first.stdout.indexOf("Study pr-card-sorting-local is READY") < first.stdout.indexOf("Study pr-card-sorting-validation-30 is READY"));
        const before = await classifyStudyReadiness({pool: database.pool, profiles: fixture.profiles});
        assert.equal(before.dataBundle, "copilot369-v1");
        const targetInspection = new pg.Pool({...options, user: "readiness_fixture_inspector", max: 1});
        try {
            const verified = await classifyStudyReadiness({pool: targetInspection, profiles: fixture.profiles, requireRestrictedRole: true});
            assert.equal(verified.readOnly.grantsVerified, true);
            assert.equal(verified.fingerprint, before.fingerprint);
        } finally {
            await targetInspection.end();
        }
        const second = await execute("docker", [...argumentsList, ...command], {timeout: 90000, maxBuffer: 1048576});
        assert.doesNotMatch(second.stdout, /> (?:migrate:study|bootstrap:study|prepare:study-profiles|retire:legacy)/);
        const after = await classifyStudyReadiness({pool: database.pool, profiles: fixture.profiles});
        assert.equal(after.fingerprint, before.fingerprint);
        assert.equal(after.schemaFingerprint, before.schemaFingerprint);
    } finally {
        await closeCopilot369Database(database);
        await execute("docker", ["run", "--rm", "--network", "none", "--read-only", "--mount", `type=bind,src=${fixture.root},dst=/fixture`,
            "python:3.12-alpine", "python3", "-B", "-c", "import shutil;from pathlib import Path;root=Path('/fixture/host');shutil.rmtree(root) if root.exists() else None"], {timeout: 30000});
        await rm(fixture.root, {recursive: true, force: true});
    }
});
