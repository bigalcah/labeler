import assert from "node:assert/strict";
import {after, before, test} from "node:test";
import {spawnSync} from "node:child_process";
import {chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {createPasswordHash, isValidPasswordHash} from "../util/credential-policy.js";
import {readStudyProfilesInput} from "../util/study-profiles-input.js";
import {prepareStudyProfile, prepareStudyProfiles} from "../util/study-preparation.js";
import {bootstrapStudy} from "../util/study-bootstrap.js";
import {closeCopilot369Database, fingerprintProtectedCopilot369State, seedHistoricalCopilot369Studies, startCopilot369Database} from "./support/copilot-369-fixture.js";

const REPOSITORY_ROOT = fileURLToPath(new URL("../", import.meta.url));
const PROFILE_CONFIGS = [
    {studyKey: "pr-card-sorting-local", expectedCardCount: 369, participants: ["javier", "diego", "pablo"], loginUsernames: {javier: "javier", diego: "diego", pablo: "pablo"}},
    {studyKey: "pr-card-sorting-validation-30", expectedCardCount: 30, participants: ["javier", "diego", "pablo"], loginUsernames: {javier: "javier-30", diego: "diego-30", pablo: "pablo-30"}},
];
const directories = [];
let database;
let profiles;
let refreshedProfiles;

const makeProfileBundle = async refreshed => {
    const root = await mkdtemp(path.join(os.tmpdir(), "labeler-copilot-369-preparation-"));
    directories.push(root);
    const roots = Object.fromEntries(["descriptor", "config", "csv", "accountManifest"]
        .map(name => [name, path.join(root, name)]));
    await Promise.all(Object.values(roots).map(directory => mkdir(directory)));
    await Promise.all([
        ["copilot-369-cards.csv", "copilot-369-cards.manifest.json"],
        ["validation-30-cards.csv", "validation-30-cards.manifest.json"],
    ].flat().map(file => copyFile(path.join(REPOSITORY_ROOT, "plans", file), path.join(roots.csv, file))));
    const sharedHash = refreshed ? await createPasswordHash("refreshed-manifest-only-password") : null;
    const descriptorProfiles = [];
    for (const [index, config] of PROFILE_CONFIGS.entries()) {
        const configPath = path.join(roots.config, `${index}.json`);
        const manifestPath = path.join(roots.accountManifest, `${index}.json`);
        await writeFile(configPath, JSON.stringify(config), {mode: 0o400});
        const accounts = await Promise.all(config.participants.map(async participantKey => ({
            participantKey,
            normalizedUsername: config.loginUsernames[participantKey],
            passwordHash: sharedHash || await createPasswordHash(`${config.studyKey}-${participantKey}-fixture-secret`),
        })));
        await writeFile(manifestPath, JSON.stringify({manifestVersion: 1, studyKey: config.studyKey, accounts}), {mode: 0o400});
        descriptorProfiles.push({
            config: configPath,
            csv: path.join(roots.csv, index === 0 ? "copilot-369-cards.csv" : "validation-30-cards.csv"),
            accountManifest: manifestPath,
            enrichmentEnabled: false,
        });
    }
    const descriptorPath = path.join(roots.descriptor, "profiles.json");
    await writeFile(descriptorPath, JSON.stringify({profiles: descriptorProfiles}));
    return readStudyProfilesInput(descriptorPath, roots);
};

const recordQueries = pool => {
    const queries = [];
    const wrapClient = client => ({
        query: (sql, values) => { queries.push(sql); return client.query(sql, values); },
        release: () => client.release(),
    });
    return {
        queries,
        pool: {
            query: (sql, values) => { queries.push(sql); return pool.query(sql, values); },
            connect: async () => wrapClient(await pool.connect()),
        },
    };
};

const assertReadOnlyQueries = queries => {
    assert.ok(queries.length > 0);
    assert.ok(queries.every(sql => /^\s*SELECT\b/i.test(sql) || /^\s*BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY\s*$/i.test(sql)
        || /^\s*(COMMIT|ROLLBACK)\s*$/i.test(sql)));
    assert.ok(queries.every(sql => !/\bFOR\s+UPDATE\b|pg_advisory/i.test(sql)));
};

const stateFingerprints = async (pool, studyIds) => Promise.all(studyIds.map(studyId => fingerprintProtectedCopilot369State(pool, studyId)));

const studyIds = async pool => {
    const {rows} = await pool.query("SELECT id, study_key FROM study ORDER BY study_key"); return Object.fromEntries(rows.map(row => [row.study_key, row.id]));
};

const assertParticipantOrder = async (pool, studyId, expectedCards) => {
    const {rows} = await pool.query("SELECT participant.participant_key, membership.source_card_id, membership.ordinal FROM study_participant participant INNER JOIN study_card membership ON membership.study_id = participant.study_id WHERE participant.study_id = $1 ORDER BY participant.ordinal, membership.ordinal", [studyId]);
    for (const participantKey of PROFILE_CONFIGS.find(config => config.expectedCardCount === expectedCards.length).participants)
        assert.deepEqual(rows.filter(row => row.participant_key === participantKey).map(row => [row.ordinal, row.source_card_id]), expectedCards.map((card, ordinal) => [ordinal, card.source_card_id]));
};

const seedDecisions = async (pool, studyId) => {
    await pool.query(
        `INSERT INTO participant_category(study_id, participant_id, raw_name, normalized_name, definition, color_slot) SELECT $1, participant.reviewer_id,
         'Synthetic category ' || participant.ordinal, 'synthetic-category-' || participant.ordinal, 'Fixture-only category', participant.ordinal
         FROM study_participant participant WHERE participant.study_id = $1`,
        [studyId],
    );
    await pool.query(
        `INSERT INTO pr_classification(pr_card_id, participant_id, category_id, remarks, study_id) SELECT card.pr_card_id, participant.reviewer_id,
         category.id, 'saved classification', $1 FROM study_card card JOIN study_participant participant
         ON participant.study_id = card.study_id AND participant.ordinal = 0 JOIN participant_category category
         ON category.study_id = participant.study_id AND category.participant_id = participant.reviewer_id WHERE card.study_id = $1 AND card.ordinal = 0`,
        [studyId],
    );
    await pool.query(
        `INSERT INTO pr_discard(pr_card_id, participant_id, reason, study_id) SELECT card.pr_card_id, participant.reviewer_id, 'saved discard', $1
         FROM study_card card JOIN study_participant participant ON participant.study_id = card.study_id AND participant.ordinal = 1 WHERE card.study_id = $1 AND card.ordinal = 1`,
        [studyId],
    );
};

before(async () => {
    database = await startCopilot369Database();
    profiles = await makeProfileBundle(false);
    refreshedProfiles = await makeProfileBundle(true);
});

after(async () => {
    if (database) await closeCopilot369Database(database);
    await Promise.all(directories.map(directory => rm(directory, {recursive: true, force: true})));
});

test("Given an empty isolated database When the approved profile coordinator runs Then it creates only 369 and 30 with stable participant order", async () => {
    const prepared = await prepareStudyProfiles({pool: database.pool, profiles});
    const ids = await studyIds(database.pool);
    const {rows: persistedProfiles} = await database.pool.query(
        "SELECT study_key, expected_card_count, bootstrap_state FROM study ORDER BY expected_card_count DESC",
    );
    assert.deepEqual(Object.keys(ids), ["pr-card-sorting-local", "pr-card-sorting-validation-30"]);
    assert.deepEqual(persistedProfiles.map(study => [study.study_key, study.expected_card_count, study.bootstrap_state]), [
        ["pr-card-sorting-local", 369, "READY"], ["pr-card-sorting-validation-30", 30, "READY"],
    ]);
    assert.ok(prepared.every(study => study.bootstrap_state === "READY" && study.created));
    await assertParticipantOrder(database.pool, ids["pr-card-sorting-local"], profiles[0].bootstrapInput.cards);
    await assertParticipantOrder(database.pool, ids["pr-card-sorting-validation-30"], profiles[1].bootstrapInput.cards);
    const {rows: accounts} = await database.pool.query("SELECT password_hash FROM participant_account");
    assert.equal(accounts.length, 6);
    assert.ok(accounts.every(account => isValidPasswordHash(account.password_hash)));
});

test("Given a 300-card config When the direct bootstrap API runs Then it rejects before querying the database", async () => {
    const config = {...PROFILE_CONFIGS[0], expectedCardCount: 300};
    await assert.rejects(() => bootstrapStudy({pool: {query: async () => { throw new Error("database query was reached"); }},
        config, cards: [], sourceChecksum: "fixture", credentialManifest: {}}), /Normal study input/);
});

test("Given an incomplete migration ledger When the coordinator runs Then it rejects before connecting or bootstrapping", async () => {
    let bootstrapCalls = 0;
    const pool = {
        query: async () => ({rows: [{migration_id: "001_study_foundation"}]}),
        connect: async () => { throw new Error("transaction was reached"); },
    };
    await assert.rejects(() => prepareStudyProfiles({pool, profiles, bootstrap: async () => { bootstrapCalls += 1; }}), /requires migrations/);
    assert.equal(bootstrapCalls, 0);
});

test("Given both profiles without decisions When ordinary preparation repeats Then all study fingerprints and input manifests remain unchanged", async () => {
    const ids = await studyIds(database.pool);
    for (const studyId of Object.values(ids)) {
        await database.pool.query(
            `INSERT INTO github_card_snapshot(pr_card_id, snapshot_checksum, normalizer_version, manifest)
             SELECT pr_card_id, 'preparation-fixture-' || source_card_id, 'fixture-v1', jsonb_build_object('fixture', true)
             FROM study_card WHERE study_id = $1 AND ordinal = 0`,
            [studyId],
        );
    }
    const before = await stateFingerprints(database.pool, Object.values(ids));
    const manifestBytes = await Promise.all(refreshedProfiles.map(profile => readFile(profile.manifestFile)));
    const calls = [];
    const recorded = recordQueries(database.pool);
    const results = await prepareStudyProfiles({
        pool: recorded.pool,
        profiles: refreshedProfiles,
        bootstrap: async input => { calls.push(input); throw new Error("existing profiles must not bootstrap"); },
    });
    assert.deepEqual(results.map(study => study.created), [false, false]);
    assert.deepEqual(calls, []);
    assertReadOnlyQueries(recorded.queries);
    assert.deepEqual(await stateFingerprints(database.pool, Object.values(ids)), before);
    assert.deepEqual(await Promise.all(refreshedProfiles.map(profile => readFile(profile.manifestFile))), manifestBytes);
});

test("Given saved classifications, discards, and a reset account When profiles are prepared Then progress and both studies remain byte-for-byte stable", async () => {
    const ids = await studyIds(database.pool);
    for (const studyId of Object.values(ids)) await seedDecisions(database.pool, studyId);
    const resetHash = refreshedProfiles[1].bootstrapInput.credentialManifest.accounts[0].passwordHash;
    await database.pool.query(
        `UPDATE participant_account account SET password_hash = $1, credential_version = credential_version + 1
         FROM study_participant participant
         WHERE participant.study_id = $2 AND participant.ordinal = 0
             AND account.study_id = participant.study_id AND account.reviewer_id = participant.reviewer_id`,
        [resetHash, ids["pr-card-sorting-validation-30"]],
    );
    const before = await stateFingerprints(database.pool, Object.values(ids));
    const recorded = recordQueries(database.pool);
    const calls = [];
    await prepareStudyProfiles({
        pool: recorded.pool,
        profiles: refreshedProfiles,
        bootstrap: async input => { calls.push(input); throw new Error("existing profiles must not bootstrap"); },
    });
    assert.deepEqual(calls, []);
    assertReadOnlyQueries(recorded.queries);
    assert.deepEqual(await stateFingerprints(database.pool, Object.values(ids)), before);
});

test("Given a historical 300 primary and protected 30 When normal preparation runs Then it requests dedicated cutover without changing either study", async () => {
    const historical = await startCopilot369Database();
    try {
        const studies = await seedHistoricalCopilot369Studies({pool: historical.pool});
        const hash = await createPasswordHash("historical-fixture-password");
        await historical.pool.query("UPDATE participant_account SET password_hash = $1", [hash]);
        assert.equal((await historical.pool.query("SELECT count(*)::integer AS count FROM participant_account"))
            .rows[0].count, 6);
        const before = await stateFingerprints(historical.pool, [studies.primaryStudyId, studies.validationStudyId]);
        const recorded = recordQueries(historical.pool);
        await prepareStudyProfile({pool: recorded.pool, bootstrapInput: profiles[1].bootstrapInput});
        await bootstrapStudy({pool: recorded.pool, ...profiles[1].bootstrapInput});
        await assert.rejects(
            () => prepareStudyProfiles({pool: recorded.pool, profiles}),
            /dedicated cutover/,
        );
        assertReadOnlyQueries(recorded.queries);
        assert.deepEqual(await stateFingerprints(historical.pool, [studies.primaryStudyId, studies.validationStudyId]), before);
    } finally {
        await closeCopilot369Database(historical);
    }
});

test("Given ordinary shell preparation When both approved routes execute Then neither starts GitHub enrichment", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "labeler-copilot-369-shell-"));
    try {
        const bin = path.join(directory, "bin");
        await mkdir(bin);
        const npm = path.join(bin, "npm");
        await writeFile(npm, "#!/bin/sh\nprintf '%s\\n' \"$*\" >> \"$SHELL_LOG\"\n");
        await chmod(npm, 0o755);
        const node = path.join(bin, "node");
        await writeFile(node, "#!/bin/sh\n[ \"$1\" = scripts/study-readiness.js ] && [ \"$2\" = --prepare ] || exit 2\nprintf 'readiness\\n' >> \"$SHELL_LOG\"\n[ \"$SHELL_READINESS\" = EMPTY ] || exit 1\nprintf 'EMPTY\\n'\n");
        await chmod(node, 0o755);
        for (const [index, profileInput] of [
            {STUDY_PROFILES_INPUT: "/profiles/input.json"},
            {STUDY_CONFIG_INPUT: "/profiles/369.json", STUDY_CSV_PATH: "/profiles/369.csv"},
        ].entries()) {
            const log = path.join(directory, `${index}.log`);
            const result = spawnSync("sh", [path.join(REPOSITORY_ROOT, "scripts/prepare-study-deployment.sh")], {
                encoding: "utf8",
                env: {PATH: `${bin}:${process.env.PATH}`, SHELL_LOG: log, SHELL_READINESS: "EMPTY",
                    STUDY_DATABASE_MODE: "clean", ...profileInput},
            });
            assert.equal(result.status, 0, result.stderr);
            const commands = (await readFile(log, "utf8")).trim().split("\n");
            assert.equal(commands[1], "readiness");
            assert.deepEqual(commands.slice(2, 4), ["run retire:legacy:clean-check", "run migrate:study"]);
            assert.match(commands[4], index === 0 ? /^run prepare:study-profiles$/ : /^run bootstrap:study /);
            assert.doesNotMatch(commands.join("\n"), /enrich:study/);

            const blockedLog = path.join(directory, `${index}-blocked.log`);
            const blocked = spawnSync("sh", [path.join(REPOSITORY_ROOT, "scripts/prepare-study-deployment.sh")], {
                encoding: "utf8",
                env: {PATH: `${bin}:${process.env.PATH}`, SHELL_LOG: blockedLog, SHELL_READINESS: "BLOCKED",
                    STUDY_DATABASE_MODE: "clean", ...profileInput},
            });
            assert.notEqual(blocked.status, 0);
            const blockedCommands = (await readFile(blockedLog, "utf8")).trim().split("\n");
            assert.deepEqual(blockedCommands, [commands[0], "readiness"]);
        }
    } finally {
        await rm(directory, {recursive: true, force: true});
    }
});
