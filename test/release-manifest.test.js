import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {mkdtemp, readFile, rm} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {createReleaseManifest, ReleaseManifestError, run} from "../scripts/create-release-manifest.js";
import {DEFAULT_PROFILE_ROOTS} from "../util/study-profiles-input.js";

const commit = "0123456789abcdef0123456789abcdef01234567";
const serverDigest = `sha256:${"a".repeat(64)}`;
const databaseDigest = `sha256:${"b".repeat(64)}`;
const serverImage = `ghcr.io/example/labeler-server:sha-${commit}@${serverDigest}`;
const databaseImage = `ghcr.io/example/labeler-database:sha-${commit}@${databaseDigest}`;
const inputs = csv => ({
    generation: 42,
    attempt: 3,
    commit,
    serverImage,
    databaseImage,
    csv,
    schemaProduces: "study-schema-2",
    applicationSupports: [ "study-schema-1", "study-schema-2" ],
    workflow: "release/456/3",
    createdAt: "2026-09-11T12:34:56Z",
});

test("release generator emits the canonical deployment manifest", () => {
    // Given
    const csv = Buffer.from("card_id,title\n1,Example\n", "utf8");

    // When
    const manifest = createReleaseManifest(inputs(csv));

    // Then
    assert.deepEqual(manifest, {
        schemaVersion: 1,
        releaseId: `42-3-${commit}`,
        generation: 42,
        commit,
        images: {server: serverImage, database: databaseImage},
        csv: {
            path: "/labeling/data/pr-cards.csv",
            sha256: createHash("sha256").update(csv).digest("hex"),
            commit,
        },
        schemaCompatibility: {
            produces: "study-schema-2",
            applicationSupports: [ "study-schema-1", "study-schema-2" ],
        },
        workflow: "release/456/3",
        createdAt: "2026-09-11T12:34:56Z",
    });
    assert.doesNotMatch(JSON.stringify(manifest), /secret|password|token|credential|private[_-]?key|\.env/i);
});

test("release generator rejects references without the exact commit tag and complete digest", () => {
    // Given
    const csv = Buffer.from("csv", "utf8");
    const invalidReferences = [
        `ghcr.io/example/labeler-server@${serverDigest}`,
        `ghcr.io/example/labeler-server:${commit}@${serverDigest}`,
        `ghcr.io/example/labeler-server:latest@${serverDigest}`,
        `ghcr.io/example/labeler-server:main@${serverDigest}`,
        `ghcr.io/example/labeler-server:${commit}`,
        `ghcr.io/example/labeler-server:${commit}@sha256:${"a".repeat(63)}`,
    ];

    // When / Then
    for (const invalidImage of invalidReferences) {
        assert.throws(
            () => createReleaseManifest({...inputs(csv), serverImage: invalidImage}),
            error => error instanceof ReleaseManifestError && error.code === "INVALID_IMAGE_REFERENCE",
            invalidImage,
        );
    }
});

test("release generator rejects invalid identity and schema compatibility inputs", () => {
    // Given
    const csv = Buffer.from("csv", "utf8");
    const invalidInputs = [
        {...inputs(csv), generation: -1},
        {...inputs(csv), generation: 1.5},
        {...inputs(csv), attempt: 0},
        {...inputs(csv), schemaProduces: "schema with spaces"},
        {...inputs(csv), applicationSupports: []},
        {...inputs(csv), applicationSupports: [ "study-schema-2", "study-schema-2" ]},
        {...inputs(csv), createdAt: "2026-09-11"},
    ];

    // When / Then
    for (const invalidInput of invalidInputs) {
        assert.throws(() => createReleaseManifest(invalidInput), ReleaseManifestError);
    }
});

test("release manifest CLI derives identity and writes the canonical CSV checksum", async () => {
    // Given
    const directory = await mkdtemp(path.join(os.tmpdir(), "labeler-release-manifest-"));
    const csvPath = new URL("../plans/merged_after_rework_cards_seed_20260510.csv", import.meta.url).pathname;
    const outputPath = path.join(directory, "release-manifest.json");

    try {
        // When
        await run([
            "--generation", "42",
            "--attempt", "3",
            "--commit", commit,
            "--server-image", serverImage,
            "--database-image", databaseImage,
            "--csv", csvPath,
            "--schema-produces", "study-schema-2",
            "--schema-application-supports", "study-schema-1,study-schema-2",
            "--workflow", "release/456/3",
            "--created-at", "2026-09-11T12:34:56Z",
            "--output", outputPath,
        ]);

        // Then
        const manifest = JSON.parse(await readFile(outputPath, "utf8"));
        assert.equal(manifest.releaseId, `42-3-${commit}`);
        assert.equal(manifest.csv.sha256, "4051c10c39a1634aa80d9018aa53b59fd6009fdc4d7f2526d5e73708b02f53ef");
        assert.deepEqual(Object.keys(manifest).sort(), [
            "commit", "createdAt", "csv", "generation", "images", "releaseId", "schemaCompatibility",
            "schemaVersion", "workflow",
        ]);
    } finally {
        await rm(directory, {recursive: true, force: true});
    }
});

test("release manifest CLI rejects missing and unknown arguments before reading inputs", async () => {
    // Given
    const incompleteArguments = [ "--generation", "42" ];
    const unknownArguments = [
        "--generation", "42", "--attempt", "3", "--commit", commit,
        "--server-image", serverImage, "--database-image", databaseImage,
        "--csv", "/missing.csv", "--schema-produces", "study-schema-2",
        "--schema-application-supports", "study-schema-2", "--workflow", "release/456/3",
        "--created-at", "2026-09-11T12:34:56Z", "--destination", "/tmp/manifest.json",
    ];

    // When / Then
    await assert.rejects(() => run(incompleteArguments), {code: "USAGE"});
    await assert.rejects(() => run(unknownArguments), {code: "USAGE"});
});

test("Compose and server image package both study CSVs without host plans mounts", async () => {
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
    assert.match(compose, /STUDY_CSV_PATH: \/labeling\/data\/pr-cards\.csv/);
    assert.match(dockerfile, /COPY plans\/merged_after_rework_cards_seed_20260510\.csv data\/pr-cards\.csv/);
    assert.match(dockerfile, /COPY plans\/validation-30-cards\.csv data\/validation-30-cards\.csv/);
    assert.equal(DEFAULT_PROFILE_ROOTS.csv, "/labeling/data");
});

test("package exposes release manifest generation", async () => {
    // Given / When
    const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

    // Then
    assert.equal(packageJson.scripts["release:manifest"], "node scripts/create-release-manifest.js");
});
