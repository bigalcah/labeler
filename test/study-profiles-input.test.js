import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {chmod, copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {COPILOT_369_SOURCE_CHECKSUM} from "../util/copilot-369-source.js";
import {readStudyProfilesInput, StudyProfilesInputError} from "../util/study-profiles-input.js";

const VALIDATION_SOURCE_CHECKSUM = "1607cfe84cb687a2cc7b4c56d3e0abf106b1a1044810d7390663ef1d691b63ab";
const PROFILE_EXAMPLES = new URL("../test-data/copilot-369/profiles/", import.meta.url);

const checksum = content => createHash("sha256").update(content).digest("hex");
const fileChecksum = async file => checksum(await readFile(file));

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
    const currentCsv = path.join(directories.csv, "copilot-369-cards.csv");
    const validationCsv = path.join(directories.csv, "validation-30-cards.csv");
    const currentSourceManifest = path.join(directories.csv, "copilot-369-cards.manifest.json");
    const validationSourceManifest = path.join(directories.csv, "validation-30-cards.manifest.json");
    const currentManifest = path.join(directories.accountManifest, "current.json");
    const validationManifest = path.join(directories.accountManifest, "validation.json");
    const descriptor = path.join(directories.descriptor, "profiles.json");
    await Promise.all([
        copyFile(new URL("current-369.json", PROFILE_EXAMPLES), currentConfig),
        copyFile(new URL("validation-30.json", PROFILE_EXAMPLES), validationConfig),
        copyFile(new URL("../plans/copilot-369-cards.csv", import.meta.url), currentCsv),
        copyFile(new URL("../plans/copilot-369-cards.manifest.json", import.meta.url), currentSourceManifest),
        copyFile(new URL("../plans/validation-30-cards.csv", import.meta.url), validationCsv),
        copyFile(new URL("../plans/validation-30-cards.manifest.json", import.meta.url), validationSourceManifest),
        copyFile(new URL("current-369-accounts.example.json", PROFILE_EXAMPLES), currentManifest),
        copyFile(new URL("validation-30-accounts.example.json", PROFILE_EXAMPLES), validationManifest),
    ]);
    await Promise.all([chmod(currentManifest, 0o400), chmod(validationManifest, 0o400)]);
    const descriptorExample = JSON.parse(await readFile(new URL("profiles.json", PROFILE_EXAMPLES), "utf8"));
    const entries = descriptorExample.profiles.map((entry, index) => ({
        ...entry,
        config: [currentConfig, validationConfig][index],
        csv: [currentCsv, validationCsv][index],
        accountManifest: [currentManifest, validationManifest][index],
    }));
    await writeFile(descriptor, JSON.stringify({profiles: entries}));
    return {
        root,
        roots: directories,
        descriptor,
        entries,
        currentCsv,
        validationCsv,
        sourceManifests: [currentSourceManifest, validationSourceManifest],
        accountManifests: [currentManifest, validationManifest],
        currentConfig,
        validationManifest,
    };
};

test("Given approved source files When profiles are read Then 369 precedes the unchanged validation30 profile", async () => {
    const fixture = await createFixture();
    try {
        const hashesBefore = await Promise.all([...fixture.sourceManifests, ...fixture.accountManifests].map(fileChecksum));
        const profiles = await readStudyProfilesInput(fixture.descriptor, fixture.roots);
        assert.deepEqual(profiles.map(profile => ({
            studyKey: profile.bootstrapInput.config.studyKey,
            count: profile.bootstrapInput.cards.length,
            enrichmentEnabled: profile.enrichmentEnabled,
            loginUsernames: profile.bootstrapInput.config.loginUsernames,
        })), [
            {studyKey: "pr-card-sorting-local", count: 369, enrichmentEnabled: false,
                loginUsernames: {javier: "javier", diego: "diego", pablo: "pablo"}},
            {studyKey: "pr-card-sorting-validation-30", count: 30, enrichmentEnabled: false,
                loginUsernames: {javier: "javier-30", diego: "diego-30", pablo: "pablo-30"}},
        ]);
        assert.equal(profiles[0].bootstrapInput.sourceChecksum, COPILOT_369_SOURCE_CHECKSUM);
        assert.equal(profiles[0].bootstrapInput.report.provenance.source_checksum, COPILOT_369_SOURCE_CHECKSUM);
        assert.ok(profiles[0].bootstrapInput.report.omissions.length > 0);
        assert.equal(profiles[1].bootstrapInput.sourceChecksum, VALIDATION_SOURCE_CHECKSUM);
        assert.equal(profiles[1].bootstrapInput.report, null);
        assert.deepEqual(profiles.map(profile => Object.keys(profile.bootstrapInput.credentialManifest)), [
            ["manifestVersion", "studyKey", "accounts"],
            ["manifestVersion", "studyKey", "accounts"],
        ]);
        assert.deepEqual(profiles.map(profile => profile.bootstrapInput.credentialManifest.accounts.map(account => account.normalizedUsername)), [
            ["javier", "diego", "pablo"],
            ["javier-30", "diego-30", "pablo-30"],
        ]);
        assert.deepEqual(await Promise.all([...fixture.sourceManifests, ...fixture.accountManifests].map(fileChecksum)), hashesBefore);
    } finally {
        await rm(fixture.root, {recursive: true, force: true});
    }
});

test("Given a changed validation CSV When both profiles are preflighted Then no partial profile list is returned", async () => {
    const fixture = await createFixture();
    try {
        await writeFile(fixture.validationCsv, `${await readFile(fixture.validationCsv, "utf8")}\n`);
        await assert.rejects(
            () => readStudyProfilesInput(fixture.descriptor, fixture.roots),
            error => error.message.includes("CSV_CHECKSUM_MISMATCH"),
        );
    } finally {
        await rm(fixture.root, {recursive: true, force: true});
    }
});

test("Given an account manifest with unsafe permissions When profiles are preflighted Then credentials are rejected", async () => {
    const fixture = await createFixture();
    try {
        await chmod(fixture.validationManifest, 0o600);
        await assert.rejects(() => readStudyProfilesInput(fixture.descriptor, fixture.roots), {name: "CredentialManifestError"});
    } finally {
        await rm(fixture.root, {recursive: true, force: true});
    }
});

test("Given enrichment is requested When either approved profile is preflighted Then the input is rejected", async () => {
    const fixture = await createFixture();
    try {
        fixture.entries[1].enrichmentEnabled = true;
        await writeFile(fixture.descriptor, JSON.stringify({profiles: fixture.entries}));
        await assert.rejects(
            () => readStudyProfilesInput(fixture.descriptor, fixture.roots),
            error => error instanceof StudyProfilesInputError && /must be false/.test(error.message),
        );
    } finally {
        await rm(fixture.root, {recursive: true, force: true});
    }
});

test("Given primary enrichment is requested When profiles are preflighted Then the Copilot369 source is rejected", async () => {
    const fixture = await createFixture();
    try {
        fixture.entries[0].enrichmentEnabled = true;
        await writeFile(fixture.descriptor, JSON.stringify({profiles: fixture.entries}));
        await assert.rejects(
            () => readStudyProfilesInput(fixture.descriptor, fixture.roots),
            error => error instanceof StudyProfilesInputError && /must be false/.test(error.message),
        );
    } finally {
        await rm(fixture.root, {recursive: true, force: true});
    }
});

test("Given a profile file outside its mounted root When profiles are preflighted Then the path is rejected", async () => {
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

test("Given a missing profile When profiles are preflighted Then the ordered 369 and 30 bundle is rejected", async () => {
    const fixture = await createFixture();
    try {
        await writeFile(fixture.descriptor, JSON.stringify({profiles: [ fixture.entries[0] ]}));
        await assert.rejects(
            () => readStudyProfilesInput(fixture.descriptor, fixture.roots),
            error => error instanceof StudyProfilesInputError && /ordered 369 and 30 profiles/.test(error.message),
        );
    } finally {
        await rm(fixture.root, {recursive: true, force: true});
    }
});

test("Given a primary configured for 300 cards When profiles are preflighted Then normal creation is rejected", async () => {
    const fixture = await createFixture();
    try {
        await writeFile(fixture.currentConfig, JSON.stringify({
            studyKey: "pr-card-sorting-local",
            expectedCardCount: 300,
            participants: ["javier", "diego", "pablo"],
            loginUsernames: {javier: "javier", diego: "diego", pablo: "pablo"},
        }));
        await assert.rejects(
            () => readStudyProfilesInput(fixture.descriptor, fixture.roots),
            error => error.name === "StudyConfigError" && /approved 369-card primary or 30-card validation/.test(error.message),
        );
    } finally {
        await rm(fixture.root, {recursive: true, force: true});
    }
});

test("Given profiles are reversed When the descriptor is preflighted Then the primary source route rejects the order", async () => {
    const fixture = await createFixture();
    try {
        await writeFile(fixture.descriptor, JSON.stringify({profiles: [...fixture.entries].reverse()}));
        await assert.rejects(
            () => readStudyProfilesInput(fixture.descriptor, fixture.roots),
            error => error instanceof StudyProfilesInputError && /must use copilot-369-cards.csv/.test(error.message),
        );
    } finally {
        await rm(fixture.root, {recursive: true, force: true});
    }
});

test("Given an unpinned primary source When profiles are preflighted Then it never falls back to the historical CSV reader", async () => {
    const fixture = await createFixture();
    try {
        const changedCsv = `${await readFile(fixture.currentCsv, "utf8")}private-source-marker`;
        await writeFile(fixture.currentCsv, changedCsv);
        await assert.rejects(
            () => readStudyProfilesInput(fixture.descriptor, fixture.roots),
            error => error.message.includes("CSV_CHECKSUM_MISMATCH") && !error.message.includes("private-source-marker"),
        );
    } finally {
        await rm(fixture.root, {recursive: true, force: true});
    }
});

test("Given a changed primary sidecar When profiles are preflighted Then its pinned manifest checksum rejects input", async () => {
    const fixture = await createFixture();
    try {
        await writeFile(fixture.sourceManifests[0], "{}");
        await assert.rejects(
            () => readStudyProfilesInput(fixture.descriptor, fixture.roots),
            error => error.message.includes("MANIFEST_CHECKSUM_MISMATCH"),
        );
    } finally {
        await rm(fixture.root, {recursive: true, force: true});
    }
});

test("Given a changed validation sidecar When profiles are preflighted Then the historical profile is rejected before bootstrap", async () => {
    const fixture = await createFixture();
    try {
        await writeFile(fixture.sourceManifests[1], "{}");
        await assert.rejects(
            () => readStudyProfilesInput(fixture.descriptor, fixture.roots),
            error => error.message.includes("MANIFEST_CHECKSUM_MISMATCH"),
        );
    } finally {
        await rm(fixture.root, {recursive: true, force: true});
    }
});

test("Given a sidecar symlink outside the CSV mount When profiles are preflighted Then path escape is rejected", async () => {
    const fixture = await createFixture();
    try {
        const outsideSidecar = path.join(fixture.root, "copilot-369-cards.manifest.json");
        await copyFile(fixture.sourceManifests[0], outsideSidecar);
        await rm(fixture.sourceManifests[0]);
        await symlink(outsideSidecar, fixture.sourceManifests[0]);
        await assert.rejects(
            () => readStudyProfilesInput(fixture.descriptor, fixture.roots),
            error => error instanceof StudyProfilesInputError && /approved mounted root/.test(error.message),
        );
    } finally {
        await rm(fixture.root, {recursive: true, force: true});
    }
});
