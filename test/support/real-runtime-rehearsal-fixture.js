import assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {randomBytes, randomUUID} from "node:crypto";
import {chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {promisify} from "node:util";
import pg from "pg";
import {prepareStudyProfiles} from "../../util/study-preparation.js";
import {runStudyMigrations} from "../../util/study-schema.js";
import {readStudyProfilesInput} from "../../util/study-profiles-input.js";
import {createReadinessProfiles} from "../readiness-fixture.js";
import {seedNormalizationDecisions} from "./study-normalization-fixture.js";
import {seedHistoricalCopilot369Studies} from "./copilot-369-fixture.js";
import {rehearsalCompose} from "./real-runtime-rehearsal-compose.js";
import {assertRehearsalInputsPreserved, stageRehearsalInputs} from "./real-runtime-rehearsal-inputs.js";

const execute = promisify(execFile);
const root = path.resolve(new URL("../../", import.meta.url).pathname);
const docker = async args => (await execute("docker", args, {timeout: 120000, maxBuffer: 8 * 1048576})).stdout;

const createRuntimeRehearsal = async kind => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "real-runtime-rehearsal-"));
    const project = `real-rehearsal-${randomUUID()}`;
    const fixture = {directory, project, root, commands: [], kind, fault: "", profiles: [],
        containers: [`${project}-db`, `${project}-app`, `${project}-edge`, `${project}-helper`],
        volumes: ["data", "caddy-data", "caddy-config"].map(name => `${project}-${name}`),
        network: `${project}-network`, receipt: `${directory}.receipt.json`};
    fixture.compose = async args => docker(["compose", "--project-name", project, "-f", path.join(directory, "compose.json"), ...args]);
    fixture.close = async () => {
        const results = await Promise.allSettled(fixture.containers.map(name => docker(["rm", "--force", name])));
        if (fixture.composeWritten) await fixture.compose(["down", "--volumes", "--remove-orphans"]);
        let inputAudit;
        try {
            if (fixture.originalInputs) inputAudit = await assertRehearsalInputsPreserved(fixture);
        } finally {
            const absent = [];
            for (const [type, names] of [["container", fixture.containers], ["volume", fixture.volumes], ["network", [fixture.network]]]) {
                for (const name of names) {
                    await assert.rejects(docker([type, "inspect", name]), error => /no such|not found/i.test(error.stderr));
                    absent.push({type, name});
                }
            }
            await writeFile(fixture.receipt, JSON.stringify({kind, project, images: fixture.images, commands: fixture.commands,
                observations: fixture.observations, inputAudit, absent, containerRemovalAttempts: results.map(value => value.status), productionAuthorization: false}, null, 2), {mode: 0o600});
            await docker(["run", "--rm", "--pull", "never", "--network", "none", "--read-only", "--cap-drop", "ALL", "--cap-add", "DAC_OVERRIDE",
                "--mount", `type=bind,src=${directory},dst=/fixture`, "python:3.12-alpine", "python3", "-B", "-c",
                "import shutil;from pathlib import Path;[shutil.rmtree(p) for p in Path('/fixture').iterdir() if p.is_dir() and p.name.startswith('host-')]"]);
            if (fixture.profileRoot) await rm(fixture.profileRoot, {recursive: true, force: true});
            await rm(directory, {recursive: true, force: true});
        }
    };
    try {
        fixture.images = {};
        const serverImage = process.env.LABELER_READINESS_TEST_IMAGE;
        assert.ok(serverImage, "LABELER_READINESS_TEST_IMAGE must identify the server image under test");
        for (const [key, image] of Object.entries({server: serverImage, database: "postgres:17.6-alpine", caddy: "caddy:2.8.4-alpine"})) {
            fixture.images[key] = JSON.parse(await docker(["image", "inspect", image, "--format", "{{json .Id}}"]));
        }
        const expectedServerImage = JSON.parse(await docker(["image", "inspect", serverImage, "--format", "{{json .Id}}"]));
        assert.equal(fixture.images.server, expectedServerImage, "the rehearsal must use LABELER_READINESS_TEST_IMAGE");
        const profiles = await createReadinessProfiles();
        fixture.profileRoot = profiles.root;
        fixture.profiles = profiles.profiles;
        const descriptor = {profiles: []};
        for (const [index, profile] of fixture.profiles.entries()) {
            const accounts = JSON.parse(await readFile(profile.accountManifest, "utf8"));
            for (const account of accounts.accounts) account.passwordHash = account.passwordHash.replace("m=65536,p=4,t=3", "m=65536,t=3,p=4");
            await chmod(profile.accountManifest, 0o600);
            await writeFile(profile.accountManifest, JSON.stringify(accounts));
            await chmod(profile.accountManifest, 0o400);
            await chmod(profile.config, 0o400);
            const suffix = index === 0 ? "current" : "validation-30";
            descriptor.profiles.push({config: `/run/config/studies/${suffix}.json`, csv: `/labeling/data/${path.basename(profile.csvPath)}`,
                accountManifest: `/run/secrets/studies/${suffix}.json`, enrichmentEnabled: false});
        }
        fixture.profiles = await readStudyProfilesInput(path.join(profiles.root, "descriptor/profiles.json"),
            Object.fromEntries(["descriptor", "config", "csv", "accountManifest"].map(name => [name, path.join(profiles.root, name)])));
        const password = randomBytes(24).toString("hex");
        for (const [name, value] of Object.entries({"pg-password": password, "database-password": password, "inspection-password": password,
            "session-current": randomBytes(32).toString("base64url"), "session-previous": randomBytes(32).toString("base64url"),
            "descriptor.json": JSON.stringify(descriptor), "production.env": "DATABASE_NAME=rehearsal\n",
            Caddyfile: "https://localhost {\n tls internal\n @actuator path /actuator /actuator/*\n respond @actuator 404\n reverse_proxy labeling-server:3000\n}\n"})) {
            await writeFile(path.join(directory, name), value, {mode: 0o400});
        }
        await chmod(path.join(directory, "Caddyfile"), 0o444);
        assert.equal(await readFile(path.join(directory, "production.env"), "utf8"), "DATABASE_NAME=rehearsal\n");
        await chmod(path.join(directory, "production.env"), 0o444);
        await copyFile(path.join(root, "plans/merged_after_rework_cards_seed_20260510.csv"), path.join(directory, "legacy.csv"));
        await chmod(path.join(directory, "legacy.csv"), 0o400);
        await stageRehearsalInputs(fixture);
        fixture.model = rehearsalCompose(fixture);
        await writeFile(path.join(directory, "compose.json"), JSON.stringify(fixture.model));
        fixture.composeWritten = true;
        await fixture.compose(["up", "-d", "--no-build", "--pull", "never", "--wait", "labeling-database"]);
        const ports = JSON.parse(await docker(["inspect", `${project}-db`, "--format", "{{json .NetworkSettings.Ports}}"]));
        fixture.port = Number(ports["5432/tcp"][0].HostPort);
        const pool = new pg.Pool({host: "127.0.0.1", port: fixture.port, database: "rehearsal", user: "rehearsal", password,
            max: 1, connectionTimeoutMillis: 5000, statement_timeout: 30000});
        try {
            await runStudyMigrations(pool, kind === "backup" ? "001_study_foundation" : undefined);
            if (kind !== "backup") {
                const options = {pool, profiles: fixture.profiles, legacyCsvPath: path.join(root, "plans/merged_after_rework_cards_seed_20260510.csv")};
                if (kind === "adoption") {
                    await seedHistoricalCopilot369Studies(options);
                    await pool.query("UPDATE participant_account SET password_hash = $1", [fixture.profiles[0].bootstrapInput.credentialManifest.accounts[0].passwordHash]);
                } else {
                    await pool.query(await readFile(path.join(root, "schema/migrations/016_preserve_study_card_history.sql"), "utf8"));
                    await prepareStudyProfiles(options);
                    await seedNormalizationDecisions(pool);
                }
            }
            await pool.query(`CREATE ROLE labeler_inspection LOGIN PASSWORD '${password}';
                REVOKE CREATE ON SCHEMA public FROM PUBLIC; REVOKE TEMP ON DATABASE rehearsal FROM PUBLIC;
                GRANT pg_read_all_stats TO labeler_inspection; GRANT CONNECT ON DATABASE rehearsal TO labeler_inspection;
                GRANT USAGE ON SCHEMA public TO labeler_inspection; GRANT SELECT ON ALL TABLES IN SCHEMA public TO labeler_inspection;
                ALTER DEFAULT PRIVILEGES FOR ROLE rehearsal IN SCHEMA public GRANT SELECT ON TABLES TO labeler_inspection;
                GRANT EXECUTE ON FUNCTION pg_control_system() TO labeler_inspection;
                ALTER DATABASE rehearsal SET log_statement = 'all'`);
        } finally {
            await pool.end();
        }
        await mkdir(path.join(directory, "host-output"));
        return fixture;
    } catch (error) {
        await fixture.close();
        throw error;
    }
};

const readSqlWindow = async fixture => {
    const {stdout, stderr} = await execute("docker", ["logs", `${fixture.project}-db`], {maxBuffer: 16 * 1048576});
    return stdout + stderr;
};

const assertSqlReadonly = sql => {
    const statements = sql.split(/REHEARSAL_SQL LOG:[ ]{2}statement: /).slice(1);
    const mutations = statements.filter(statement => /^\s*(?:INSERT|UPDATE|DELETE|TRUNCATE|CREATE|ALTER|DROP|GRANT|REVOKE|COPY|CALL|DO|REINDEX|VACUUM)\b/i.test(statement));
    assert.deepEqual(mutations, [], "readonly window executed a SQL mutator");
    return statements.length;
};

export {assertSqlReadonly, createRuntimeRehearsal, docker, execute, readSqlWindow};
