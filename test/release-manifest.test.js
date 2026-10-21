import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {mkdtemp, readFile, rm} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {createReleaseManifest, ReleaseManifestError, run} from "../scripts/create-release-manifest.js";
import {parseReleaseManifest, validateReleaseManifest} from "../util/release-manifest.js";
import {DEFAULT_PROFILE_ROOTS} from "../util/study-profiles-input.js";
import {
    canonicalManifestInputFixture,
    createCanonicalManifestFixture,
    invalidManifestFixtures,
    invalidRawManifestFixtures,
} from "./release-manifest-v2-fixtures.js";

test("release generator emits the exact canonical v2 deployment manifest", () => {
    const manifest = createReleaseManifest(canonicalManifestInputFixture());

    assert.deepEqual(manifest, createCanonicalManifestFixture());
    assert.deepEqual(Object.keys(manifest).sort(), [
        "commit", "createdAt", "dataBundle", "dataCompatibility", "generation", "images", "releaseId",
        "schemaCompatibility", "schemaVersion", "workflow",
    ]);
    assert.doesNotMatch(JSON.stringify(manifest), /secret|password|token|credential|private[_-]?key|\.env/i);
});

test("release generator rejects invalid, ambiguous, or v1 input", () => {
    const input = canonicalManifestInputFixture();
    const invalidInputs = [
        {...input, generation: "42"},
        {...input, generation: 2_147_483_648},
        {...input, attempt: 0},
        {...input, attempt: "03"},
        {...input, commit: input.commit.toUpperCase()},
        {...input, serverImage: input.serverImage.replace(input.commit, "f".repeat(40))},
        {...input, databaseImage: input.databaseImage.slice(0, -1)},
        {...input, workflow: "release/456/3?"},
        {...input, createdAt: "2026-02-30T12:34:56Z"},
        {...input, csv: Buffer.from("draft v1 input")},
    ];

    for (const invalidInput of invalidInputs) {
        assert.throws(() => createReleaseManifest(invalidInput), ReleaseManifestError);
    }
    for (const workflow of ["release/secret/3", "release/password/3", "release/token/3"]) {
        assert.throws(() => createReleaseManifest({...input, workflow}), ReleaseManifestError);
    }
});

test("release manifest preserves historical workflow syntax and accepts large Actions run IDs", () => {
    const canonical = createCanonicalManifestFixture();
    const historicalWorkflows = [
        "workflow_dispatch",
        "release-legacy.v1/path_name",
        `a${"b".repeat(255)}`,
    ];
    const largeRunId = "9007199254740991";

    for (const workflow of historicalWorkflows) {
        assert.equal(validateReleaseManifest({...canonical, workflow}).workflow, workflow);
    }
    assert.equal(
        validateReleaseManifest({...canonical, workflow: `release/${largeRunId}/3`}).workflow,
        `release/${largeRunId}/3`,
    );
});

test("strict manifest validator rejects every declared invalid v2 fixture", () => {
    for (const fixture of invalidManifestFixtures()) {
        assert.throws(
            () => validateReleaseManifest(fixture.manifest),
            error => error instanceof ReleaseManifestError && error.code === fixture.expectedError,
            fixture.name,
        );
    }
});

test("strict raw parser rejects duplicate keys, invalid JSON, and incoming v1", () => {
    for (const fixture of invalidRawManifestFixtures) {
        assert.throws(
            () => parseReleaseManifest(fixture.raw),
            error => error instanceof ReleaseManifestError && error.code === fixture.expectedError,
            fixture.name,
        );
    }
});

test("strict raw parser rejects invalid UTF-8 and validates valid raw JSON", () => {
    const manifest = createCanonicalManifestFixture();
    const raw = Buffer.from(JSON.stringify(manifest));

    assert.deepEqual(parseReleaseManifest(raw), manifest);
    assert.throws(
        () => parseReleaseManifest(Buffer.from([0xc3, 0x28])),
        error => error instanceof ReleaseManifestError && error.code === "INVALID_JSON",
    );
});

test("producer hashes are the fixed digests of the four physical canonical sources", async () => {
    const manifest = createCanonicalManifestFixture();
    const sourceFiles = [
        ["../plans/copilot-369-cards.csv", manifest.dataBundle.profiles[0].csv.sha256],
        ["../plans/copilot-369-cards.manifest.json", manifest.dataBundle.profiles[0].manifest.sha256],
        ["../plans/validation-30-cards.csv", manifest.dataBundle.profiles[1].csv.sha256],
        ["../plans/validation-30-cards.manifest.json", manifest.dataBundle.profiles[1].manifest.sha256],
    ];

    for (const [sourcePath, expectedHash] of sourceFiles) {
        const bytes = await readFile(new URL(sourcePath, import.meta.url));
        assert.equal(createHash("sha256").update(bytes).digest("hex"), expectedHash, sourcePath);
    }
});

test("release manifest CLI writes v2 without reading or deriving source hashes", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "labeler-release-manifest-"));
    const outputPath = path.join(directory, "release-manifest.json");
    const input = canonicalManifestInputFixture();

    try {
        await run([
            "--generation", String(input.generation),
            "--attempt", String(input.attempt),
            "--commit", input.commit,
            "--server-image", input.serverImage,
            "--database-image", input.databaseImage,
            "--workflow", input.workflow,
            "--created-at", input.createdAt,
            "--output", outputPath,
        ]);

        const manifest = parseReleaseManifest(await readFile(outputPath));
        assert.deepEqual(manifest, createCanonicalManifestFixture());
    } finally {
        await rm(directory, {recursive: true, force: true});
    }
});

test("release manifest CLI rejects missing, repeated, unknown, and v1 options before writing", async () => {
    const input = canonicalManifestInputFixture();
    const validOptions = [
        "--generation", String(input.generation), "--attempt", String(input.attempt),
        "--commit", input.commit, "--server-image", input.serverImage,
        "--database-image", input.databaseImage, "--workflow", input.workflow,
        "--created-at", input.createdAt, "--output", "/tmp/unused-release-manifest.json",
    ];

    await assert.rejects(() => run(["--generation", "42"]), {code: "USAGE"});
    await assert.rejects(() => run([...validOptions, "--csv", "/missing.csv"]), {code: "USAGE"});
    await assert.rejects(() => run([...validOptions, "--generation", "42"]), {code: "USAGE"});
});

test("local Compose selects Copilot369 while the image preserves all protected sources without host plans mounts", async () => {
    // Given / When
    const [compose, cleanCompose, dockerfile] = await Promise.all([
        readFile(new URL("../deployment/docker-compose.yml", import.meta.url), "utf8"),
        readFile(new URL("../deployment/docker-compose.clean.yml", import.meta.url), "utf8"),
        readFile(new URL("../deployment/server/Dockerfile", import.meta.url), "utf8"),
    ]);

    // Then
    assert.match(compose, /image: \$\{LABELER_DATABASE_IMAGE:-seart\/labeling-database:1\.0\.0\}/);
    assert.equal((compose.match(/image: \$\{LABELER_SERVER_IMAGE:-seart\/labeling-server:1\.0\.0\}/g) ?? []).length, 2);
    assert.equal((compose.match(/^\s{4}build:$/gm) ?? []).length, 3);
    assert.doesNotMatch(`${compose}\n${cleanCompose}`, /\.\.\/plans\//);
    assert.match(compose, /STUDY_CSV_PATH: \/labeling\/data\/copilot-369-cards\.csv/);
    assert.match(dockerfile, /COPY plans\/merged_after_rework_cards_seed_20260510\.csv data\/pr-cards\.csv/);
    assert.match(dockerfile, /COPY plans\/validation-30-cards\.csv data\/validation-30-cards\.csv/);
    assert.match(dockerfile, /COPY plans\/copilot-369-cards\.csv data\/copilot-369-cards\.csv/);
    assert.match(dockerfile, /COPY plans\/copilot-369-cards\.manifest\.json data\/copilot-369-cards\.manifest\.json/);
    assert.match(dockerfile, /COPY plans\/validation-30-cards\.manifest\.json data\/validation-30-cards\.manifest\.json/);
    assert.equal(DEFAULT_PROFILE_ROOTS.csv, "/labeling/data");
});

test("package exposes release manifest generation", async () => {
    // Given / When
    const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

    // Then
    assert.equal(packageJson.scripts["release:manifest"], "node scripts/create-release-manifest.js");
});
