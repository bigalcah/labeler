import assert from "node:assert/strict";
import {execFile, spawn} from "node:child_process";
import {createInterface} from "node:readline";
import {promisify} from "node:util";
import {chmod, copyFile, mkdtemp, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {randomUUID} from "node:crypto";
import test from "node:test";
import pg from "pg";
import {probeStudyNormalization} from "../util/study-readiness.js";
import {normalizeStudySchema} from "../util/study-normalization.js";
import {preserveStudyCardHistory} from "../util/study-history.js";
import {prepareStudyProfiles} from "../util/study-preparation.js";
import {createReadinessProfiles} from "./readiness-fixture.js";
import {fingerprintProtectedCopilot369State, seedHistoricalCopilot369Studies} from "./support/copilot-369-fixture.js";
import {fingerprintNormalizationRows, seedNormalizationDecisions} from "./support/study-normalization-fixture.js";
import {startHostNormalizationDatabase} from "./fixtures/host/normalization-database.js";
import {runCommitted015Reconcile} from "./support/normalization-post015-host.js";
import {probePost015Normalization} from "./support/normalization-post015-prepare.js";
import {runRealMaintenanceEntrypoint} from "./support/real-maintenance-entrypoint.js";
import {stageReadinessContainerInputs} from "./support/readiness-container-inputs.js";

const execute = promisify(execFile);
const root = path.resolve(new URL("..", import.meta.url).pathname);
const image = process.env.LABELER_READINESS_TEST_IMAGE;
assert.ok(image, "LABELER_READINESS_TEST_IMAGE must name the current source image");
const docker = async args => (await execute("docker", args, {timeout: 60000, maxBuffer: 1048576})).stdout;

for (const bundle of ["empty", "legacy300-v1", "copilot369-v1"]) {
    test(`real locked Python host hands retired ${bundle} to normalizer CLI with raw SQL identity`, async () => {
        const database = await startHostNormalizationDatabase();
        const fixture = await createReadinessProfiles();
        const directory = await mkdtemp(path.join(tmpdir(), "host-normalization-"));
        const helperName = `normalization-parent-${randomUUID()}`;
        const containerName = `normalization-child-${randomUUID()}`;
        let inspector;
        let helper;
        let helperExit;
        let helperError = "";
        let writerClosed = false;
        try {
            const options = {pool: database.pool, profiles: fixture.profiles,
                legacyCsvPath: new URL("../plans/merged_after_rework_cards_seed_20260510.csv", import.meta.url)};
            if (bundle === "copilot369-v1") await prepareStudyProfiles(options);
            if (bundle === "legacy300-v1") {
                await seedHistoricalCopilot369Studies(options);
                await database.pool.query("UPDATE participant_account SET password_hash = $1",
                    [fixture.profiles[0].bootstrapInput.credentialManifest.accounts[0].passwordHash]);
            }
            if (bundle !== "empty") await seedNormalizationDecisions(database.pool);
            const before = await fingerprintNormalizationRows(database.pool);
            const name = database.pool.options.database;
            await database.pool.query(`CREATE ROLE normalization_inspector LOGIN;
                REVOKE CREATE ON SCHEMA public FROM PUBLIC; REVOKE TEMP ON DATABASE "${name}" FROM PUBLIC;
                GRANT pg_read_all_stats TO normalization_inspector;
                GRANT CONNECT ON DATABASE "${name}" TO normalization_inspector;
                GRANT USAGE ON SCHEMA public TO normalization_inspector;
                GRANT SELECT ON ALL TABLES IN SCHEMA public TO normalization_inspector;
                GRANT EXECUTE ON FUNCTION pg_control_system() TO normalization_inspector`);
            const connection = {...database.pool.options};
            await database.pool.end();
            writerClosed = true;
            inspector = new pg.Pool({...connection, user: "normalization_inspector", max: 1});
            const probe = await probeStudyNormalization({...options, pool: inspector, requireRestrictedRole: true});
            assert.equal(probe.observation.readOnly.writersStopped, true);
            const origin = structuredClone(probe.observation);
            origin.databaseIdentity.endpoint = `127.0.0.1:${connection.port}/${name}`;
            origin.databaseIdentity.volume = `disposable:${database.containerName}`;
            await writeFile(path.join(directory, "origin.json"), JSON.stringify(origin));
            await chmod(directory, 0o777);
            const password = path.join(directory, "password");
            await writeFile(password, "isolated-placeholder");
            await chmod(password, 0o400);
            helper = spawn("docker", ["run", "--rm", "--name", helperName, "-i", "--network", "none", "--read-only",
                "--mount", `type=bind,src=${root},dst=/workspace,readonly`, "--mount", `type=bind,src=${directory},dst=/fixture`,
                "python:3.12-alpine", "python3", "-B", "/workspace/test/fixtures/host/locked-normalization.py"],
            {stdio: ["pipe", "pipe", "pipe"]});
            helper.stderr.on("data", chunk => { helperError += chunk; });
            helperExit = new Promise((resolve, reject) => {
                helper.on("error", reject);
                helper.on("exit", code => resolve(code));
            });
            const lines = createInterface({input: helper.stdout});
            const ready = await Promise.race([
                new Promise(resolve => lines.once("line", line => resolve(JSON.parse(line)))),
                helperExit.then(code => { throw new Error(`Parent exited ${code}: ${helperError}`); }),
            ]);
            assert.deepEqual({uid: ready.uid, gid: ready.gid, mode: ready.mode, directoryMode: ready.directoryMode},
                {uid: 0, gid: 1000, mode: 0o440, directoryMode: 0o700});
            assert.equal((await docker(["exec", helperName, "python3", "-B", "/workspace/test/fixtures/host/locked-normalization.py", "--probe"])).trim(), "LOCK_HELD");
            const mounts = [];
            for (const source of ["util", "scripts", "schema/migrations"]) {
                mounts.push("--mount", `type=bind,src=${path.join(root, source)},dst=/labeling/${source},readonly`);
            }
            const targets = {config: "/run/config/studies", accountManifest: "/run/secrets/studies", csv: "/labeling/data", descriptor: "/run/config/profiles"};
            await copyFile(options.legacyCsvPath, path.join(fixture.root, "csv/pr-cards.csv"));
            await writeFile(path.join(fixture.root, "descriptor/profiles.json"), JSON.stringify({profiles: fixture.profiles.map(profile => ({
                config: `${targets.config}/${path.basename(profile.config)}`,
                csv: `${targets.csv}/${path.basename(profile.csv)}`,
                accountManifest: `${targets.accountManifest}/${path.basename(profile.accountManifest)}`, enrichmentEnabled: false,
            }))}));
            const staged = await stageReadinessContainerInputs({fixtureRoot: fixture.root,
                descriptor: path.join(fixture.root, "descriptor/profiles.json"), password});
            for (const kind of ["config", "accountManifest", "csv"]) {
                mounts.push("--mount", `type=bind,src=${staged[kind]},dst=${targets[kind]},readonly`);
            }
            mounts.push("--mount", `type=bind,src=${staged.descriptor},dst=${targets.descriptor}/profiles.json,readonly`,
                "--mount", `type=bind,src=${path.join(directory, ready.path)},dst=/run/labeler-release/context.json,readonly`,
                "--mount", `type=bind,src=${staged.password},dst=/normalization-password,readonly`);
            const environment = {DATABASE_HOST: "127.0.0.1", DATABASE_PORT: String(connection.port), DATABASE_NAME: name,
                DATABASE_USER: connection.user, DATABASE_PASS_FILE: "/normalization-password", STUDY_PROFILES_INPUT: "/run/config/profiles/profiles.json",
                LABELER_RELEASE_CONTEXT: "/run/labeler-release/context.json"};
            const args = ["run", "--rm", "--name", containerName, "--network", "host", "--read-only", "--user", "1000:1000", "--cap-drop", "ALL", ...mounts];
            for (const [key, value] of Object.entries(environment)) args.push("-e", `${key}=${value}`);
            const result = JSON.parse(await docker([...args, "--entrypoint", "node", image, "scripts/normalize-retired-study-schema.js"]));
            assert.deepEqual(result, {applied015: true, changed: true});
            const after = await probeStudyNormalization({...options, pool: inspector, requireRestrictedRole: true});
            assert.equal(after.applied015, true);
            assert.equal(after.observation.schema, "study-schema-3");
            assert.equal(after.observation.dataBundle, bundle);
            assert.equal(await fingerprintNormalizationRows(inspector), before);
            assert.equal((await docker(["exec", helperName, "python3", "-B", "/workspace/test/fixtures/host/locked-normalization.py", "--probe"])).trim(), "LOCK_HELD");
            await assert.rejects(docker([...args, "--entrypoint", "node", image, "scripts/normalize-retired-study-schema.js"]),
                error => /does not bind/.test(error.stderr));
            lines.close();
        } finally {
            if (helper) {
                helper.stdin.end("release\n");
                assert.equal(await helperExit, 0, helperError);
            }
            if (inspector) await inspector.end();
            if (!writerClosed) await database.pool.end();
            await docker(["rm", "--force", database.containerName]);
            await rm(directory, {recursive: true, force: true});
            await rm(fixture.root, {recursive: true, force: true});
        }
        for (const name of [helperName, containerName, database.containerName]) {
            await assert.rejects(execute("docker", ["inspect", name]));
        }
    });
}

for (const withPrimaryHistory of [false, true]) {
    test(`real Runtime.maintenance runs migration and cutover entrypoints; primary history ${withPrimaryHistory ? "blocks" : "permits"} cutover`, async () => {
        const database = await startHostNormalizationDatabase();
        const fixture = await createReadinessProfiles();
        const options = {pool: database.pool, profiles: fixture.profiles,
            legacyCsvPath: new URL("../plans/merged_after_rework_cards_seed_20260510.csv", import.meta.url)};
        try {
            const {primaryStudyId, validationStudyId} = await seedHistoricalCopilot369Studies(options);
            await database.pool.query("UPDATE participant_account SET password_hash = $1",
                [fixture.profiles[0].bootstrapInput.credentialManifest.accounts[0].passwordHash]);
            if (withPrimaryHistory) await seedNormalizationDecisions(database.pool);
            const protected30 = await fingerprintProtectedCopilot369State(database.pool, validationStudyId);
            const baseline = await probeStudyNormalization(options);
            assert.equal(baseline.observation.dataBundle, "legacy300-v1");
            const normalization = await normalizeStudySchema({...options, baseline: baseline.observation,
                operationOrigin: baseline.observation});
            assert.equal(normalization.observation.schema, "study-schema-3");
            assert.equal(normalization.observation.dataBundle, "legacy300-v1");
            await preserveStudyCardHistory({...options, baseline: normalization.observation});
            const ledger = (await database.pool.query("SELECT * FROM labeler_migration ORDER BY applied_at, migration_id")).rows;
            const rowsBeforeMaintenance = await fingerprintNormalizationRows(database.pool);
            const maintenance = await runRealMaintenanceEntrypoint({database, primaryStudyId});
            assert.deepEqual(maintenance.commands.map(command => ({entrypoint: command.entrypoint, stage: command.stage})), [
                {entrypoint: "scripts/cutover-copilot-369.js", stage: "cutover"},
            ]);
            assert.deepEqual((await database.pool.query("SELECT * FROM labeler_migration ORDER BY applied_at, migration_id")).rows, ledger);
            assert.equal((await database.pool.query("SELECT count(*)::integer AS count FROM labeler_migration WHERE migration_id = '015_normalize_retired_study_schema'")).rows[0].count, 1);
            assert.deepEqual(await fingerprintProtectedCopilot369State(database.pool, validationStudyId), protected30);
            if (withPrimaryHistory) {
                assert.equal(maintenance.stage, "cutover");
                assert.equal(maintenance.error, "host command failed");
                assert.equal(await fingerprintNormalizationRows(database.pool), rowsBeforeMaintenance);
            } else {
                assert.equal(maintenance.error, null);
                assert.match(maintenance.commands[0].output, /"status":"CUTOVER_369"/);
                assert.equal((await database.pool.query("SELECT expected_card_count FROM study WHERE id = $1", [primaryStudyId])).rows[0].expected_card_count, 369);
            }
        } finally {
            await database.pool.end();
            await docker(["rm", "--force", database.containerName]);
            await assert.rejects(execute("docker", ["inspect", database.containerName]));
            await rm(fixture.root, {recursive: true, force: true});
        }
    });
}

test("a lost post-commit 015 response reconciles from real PostgreSQL without re-running SQL", async () => {
    const database = await startHostNormalizationDatabase();
    const options = {pool: database.pool, profiles: [],
        legacyCsvPath: new URL("../plans/merged_after_rework_cards_seed_20260510.csv", import.meta.url)};
    try {
        const normalizationBaseline = await probeStudyNormalization(options);
        const before = await probePost015Normalization(database, options.profiles, options.legacyCsvPath);
        let ddlStarted = false;
        const interruptedPool = {connect: async () => {
            const client = await database.pool.connect();
            return {release: () => client.release(), query: async (sql, values) => {
                if (sql.startsWith("DO $normalization$")) ddlStarted = true;
                const result = await client.query(sql, values);
                if (ddlStarted && sql === "COMMIT") throw new Error("lost receipt after committed 015");
                return result;
            }};
        }};
        await assert.rejects(normalizeStudySchema({...options, pool: interruptedPool,
            baseline: normalizationBaseline.observation, operationOrigin: normalizationBaseline.observation}),
        /lost receipt after committed 015/);
        const committed = await probePost015Normalization(database, options.profiles, options.legacyCsvPath);
        assert.equal(committed.applied015, true);
        assert.equal(committed.observation.schema, "study-schema-3");
        const ledger = (await database.pool.query("SELECT * FROM labeler_migration ORDER BY applied_at, migration_id")).rows;
        const rows = await fingerprintNormalizationRows(database.pool);
        const reconciled = await runCommitted015Reconcile(before.observation, committed.observation);
        assert.equal(reconciled.phase, "normalization_verified");
        assert.equal(reconciled.journalStatus, "verified");
        assert.deepEqual(reconciled.origin, before.observation);
        assert.deepEqual(reconciled.target.observation, committed.observation);
        assert.deepEqual(reconciled.publicationBefore, reconciled.publicationAfter);
        assert.equal(reconciled.generationFloor, 1);
        assert.deepEqual(reconciled.commands, ["config", "normalization-probe", "inventory"]);
        assert.deepEqual((await database.pool.query("SELECT * FROM labeler_migration ORDER BY applied_at, migration_id")).rows, ledger);
        assert.equal(await fingerprintNormalizationRows(database.pool), rows);
        assert.equal((await database.pool.query("SELECT count(*)::integer AS count FROM labeler_migration WHERE migration_id = '015_normalize_retired_study_schema'")).rows[0].count, 1);
    } finally {
        await database.pool.end();
        await docker(["rm", "--force", database.containerName]);
        await assert.rejects(execute("docker", ["inspect", database.containerName]));
    }
});
