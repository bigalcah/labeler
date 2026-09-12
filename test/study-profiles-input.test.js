import assert from "node:assert/strict";
import {chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {readStudyProfilesInput, StudyProfilesInputError} from "../util/study-profiles-input.js";

const passwordHash = `$argon2id$v=19$m=65536,t=3,p=4$c2FsdHNhbHQ$${Buffer.alloc(32).toString("base64").replace(/=+$/, "")}`;
const participants = [ "javier", "diego", "pablo" ];

const writeManifest = async (file, studyKey, loginUsernames) => {
    await writeFile(file, JSON.stringify({
        manifestVersion: 1,
        studyKey,
        accounts: participants.map(participantKey => ({
            participantKey,
            normalizedUsername: loginUsernames[participantKey],
            passwordHash,
        })),
    }));
    await chmod(file, 0o400);
};

const createFixture = async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "labeler-study-profiles-"));
    const directories = {
        descriptor: path.join(root, "descriptor"),
        config: path.join(root, "config"),
        csv: path.join(root, "csv"),
        accountManifest: path.join(root, "manifests"),
    };
    await Promise.all(Object.values(directories).map(directory => mkdir(directory)));
    const currentConfig = path.join(directories.config, "current.json");
    const validationConfig = path.join(directories.config, "validation.json");
    const currentCsv = path.join(directories.csv, "current.csv");
    const validationCsv = path.join(directories.csv, "validation.csv");
    const currentManifest = path.join(directories.accountManifest, "current.json");
    const validationManifest = path.join(directories.accountManifest, "validation.json");
    const descriptor = path.join(directories.descriptor, "profiles.json");
    const currentLoginUsernames = {javier: "javier", diego: "diego", pablo: "pablo"};
    const validationLoginUsernames = {javier: "javier-30", diego: "diego-30", pablo: "pablo-30"};
    await Promise.all([
        writeFile(currentConfig, JSON.stringify({studyKey: "pr-card-sorting-local", expectedCardCount: 300, participants})),
        writeFile(validationConfig, JSON.stringify({studyKey: "pr-card-sorting-validation-30", expectedCardCount: 30,
            participants, loginUsernames: validationLoginUsernames})),
        copyFile(new URL("../plans/merged_after_rework_cards_seed_20260510.csv", import.meta.url), currentCsv),
        copyFile(new URL("../plans/validation-30-cards.csv", import.meta.url), validationCsv),
        writeManifest(currentManifest, "pr-card-sorting-local", currentLoginUsernames),
        writeManifest(validationManifest, "pr-card-sorting-validation-30", validationLoginUsernames),
    ]);
    const entries = [
        {config: currentConfig, csv: currentCsv, accountManifest: currentManifest, enrichmentEnabled: false},
        {config: validationConfig, csv: validationCsv, accountManifest: validationManifest, enrichmentEnabled: false},
    ];
    await writeFile(descriptor, JSON.stringify({profiles: entries}));
    return {root, roots: directories, descriptor, entries, validationCsv, validationManifest};
};

test("reads the approved 300 then 30 profiles only after validating every mounted input", async () => {
    const fixture = await createFixture();
    try {
        const profiles = await readStudyProfilesInput(fixture.descriptor, fixture.roots);
        assert.deepEqual(profiles.map(profile => ({
            studyKey: profile.bootstrapInput.config.studyKey,
            count: profile.bootstrapInput.cards.length,
            enrichmentEnabled: profile.enrichmentEnabled,
            loginUsernames: profile.bootstrapInput.config.loginUsernames,
        })), [
            {studyKey: "pr-card-sorting-local", count: 300, enrichmentEnabled: false,
                loginUsernames: {javier: "javier", diego: "diego", pablo: "pablo"}},
            {studyKey: "pr-card-sorting-validation-30", count: 30, enrichmentEnabled: false,
                loginUsernames: {javier: "javier-30", diego: "diego-30", pablo: "pablo-30"}},
        ]);
    } finally {
        await rm(fixture.root, {recursive: true, force: true});
    }
});

test("rejects stale second-profile CSV content during whole-bundle preflight", async () => {
    const fixture = await createFixture();
    try {
        await writeFile(fixture.validationCsv, `${await readFile(fixture.validationCsv, "utf8")}\n`);
        await assert.rejects(
            () => readStudyProfilesInput(fixture.descriptor, fixture.roots),
            error => error instanceof StudyProfilesInputError && /approved ordered profile/.test(error.message),
        );
    } finally {
        await rm(fixture.root, {recursive: true, force: true});
    }
});

test("rejects malformed manifests and non-boolean enrichment without accepting a partial bundle", async () => {
    const fixture = await createFixture();
    try {
        await chmod(fixture.validationManifest, 0o600);
        await assert.rejects(() => readStudyProfilesInput(fixture.descriptor, fixture.roots), {name: "CredentialManifestError"});
        await chmod(fixture.validationManifest, 0o400);
        fixture.entries[1].enrichmentEnabled = "false";
        await writeFile(fixture.descriptor, JSON.stringify({profiles: fixture.entries}));
        await assert.rejects(
            () => readStudyProfilesInput(fixture.descriptor, fixture.roots),
            error => error instanceof StudyProfilesInputError && /must be boolean/.test(error.message),
        );
    } finally {
        await rm(fixture.root, {recursive: true, force: true});
    }
});

test("rejects profile files outside their approved mounted roots", async () => {
    const fixture = await createFixture();
    try {
        fixture.entries[1].config = path.join(fixture.root, "outside.json");
        await writeFile(fixture.entries[1].config, "{}");
        await writeFile(fixture.descriptor, JSON.stringify({profiles: fixture.entries}));
        await assert.rejects(
            () => readStudyProfilesInput(fixture.descriptor, fixture.roots),
            error => error instanceof StudyProfilesInputError && /approved mounted root/.test(error.message),
        );
    } finally {
        await rm(fixture.root, {recursive: true, force: true});
    }
});

test("rejects a missing profile entry before reading any database configuration", async () => {
    const fixture = await createFixture();
    try {
        await writeFile(fixture.descriptor, JSON.stringify({profiles: [ fixture.entries[0] ]}));
        await assert.rejects(
            () => readStudyProfilesInput(fixture.descriptor, fixture.roots),
            error => error instanceof StudyProfilesInputError && /ordered 300 and 30 profiles/.test(error.message),
        );
    } finally {
        await rm(fixture.root, {recursive: true, force: true});
    }
});
