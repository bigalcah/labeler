import assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {mkdtemp, writeFile, rm} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const execute = promisify(execFile);

test("real release Compose renders the mapped readonly host context only into prepare", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "labeler-release-compose-context-"));
    try {
        const env = path.join(root, "production.env");
        const variables = {DATABASE_NAME: "synthetic", DATABASE_USER: "synthetic", PUBLIC_HOSTNAME: "labeler.example",
            APP_ORIGIN: "https://labeler.example", DATABASE_PASSWORD_DATABASE_HOST_PATH: `${root}/postgres-password`,
            DATABASE_PASSWORD_HOST_PATH: `${root}/node-password`, SESSION_SECRET_CURRENT_HOST_PATH: `${root}/session-current`,
            SESSION_SECRET_PREVIOUS_HOST_PATH: `${root}/session-previous`, STUDY_ACCOUNT_MANIFEST_HOST_PATH: `${root}/current-accounts.json`,
            STUDY_PROFILES_INPUT_HOST_PATH: `${root}/profiles.json`, STUDY_CURRENT_CONFIG_HOST_PATH: `${root}/current.json`,
            STUDY_VALIDATION_CONFIG_HOST_PATH: `${root}/validation.json`, STUDY_VALIDATION_ACCOUNT_MANIFEST_HOST_PATH: `${root}/validation-accounts.json`,
            LABELER_RELEASE_CONTEXT_HOST_PATH: `${root}/context.json`, LABELER_SERVER_IMAGE: "example/server:immutable", LABELER_DATABASE_IMAGE: "example/database:immutable"};
        await writeFile(env, Object.entries(variables).map(([key, value]) => `${key}=${value}`).join("\n"));
        const {stdout} = await execute("docker", ["compose", "--env-file", env, "-f",
            new URL("../deployment/docker-compose.release.yml", import.meta.url).pathname, "config", "--format", "json"],
        {env: {PATH: process.env.PATH, HOME: process.env.HOME}});
        const {services} = JSON.parse(stdout);
        const prepare = services["labeling-study-prepare"];
        assert.deepEqual(prepare.group_add, ["1000"]);
        const [mount] = prepare.volumes.filter(volume => volume.target === "/run/labeler-release/context.json");
        assert.equal(mount.source, variables.LABELER_RELEASE_CONTEXT_HOST_PATH);
        assert.equal(mount.read_only, true);
        assert.equal(prepare.environment.LABELER_RELEASE_CONTEXT, "/run/labeler-release/context.json");
        assert.equal(prepare.environment.STUDY_CSV_PATH, "/labeling/data/copilot-369-cards.csv");
        for (const name of ["labeling-server", "labeling-caddy", "labeling-database"]) {
            assert.equal(services[name].volumes.some(volume => volume.target.startsWith("/run/labeler-release")), false);
        }
    } finally {
        await rm(root, {recursive: true, force: true});
    }
});
