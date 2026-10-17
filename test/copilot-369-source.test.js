import assert from "node:assert/strict";
import {mkdtemp, readFile, rm, writeFile} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
import test from "node:test";
import {
    COPILOT_369_CARD_COUNT,
    COPILOT_369_COLUMN_COUNT,
    COPILOT_369_SOURCE_CHECKSUM,
    COPILOT_369_SOURCE_MANIFEST_CHECKSUM,
    Copilot369SourceError,
    readCopilot369Cards,
} from "../util/copilot-369-source.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const csvPath = path.join(projectRoot, "plans", "copilot-369-cards.csv");
const sidecarPath = path.join(projectRoot, "plans", "copilot-369-cards.manifest.json");

test("pinned Copilot369 source returns ordered exact IDs and provenance", async () => {
    const {cards, errors, sourceChecksum, report} = await readCopilot369Cards(csvPath);
    const sidecar = JSON.parse(await readFile(sidecarPath, "utf8"));
    const ids = cards.map(card => card.source_pr_id);
    const missingLanguages = report.omissions.find(omission => omission.field === "repository_language");
    const missingEvidence = report.omissions.find(omission => omission.field === "evidence_text");

    assert.equal(sourceChecksum, COPILOT_369_SOURCE_CHECKSUM);
    assert.deepEqual(errors, []);
    assert.equal(cards.length, COPILOT_369_CARD_COUNT);
    assert.equal(sidecar.source.column_count, COPILOT_369_COLUMN_COUNT);
    assert.deepEqual(sidecar.source.header, Object.keys(cards[0].raw_payload));
    assert.deepEqual(sidecar.ordered_pr_ids, ids);
    assert.equal(new Set(ids).size, COPILOT_369_CARD_COUNT);
    assert.ok(ids.every(id => typeof id === "string" && /^[1-9]\d*$/.test(id)));
    assert.ok(cards.every(card => card.source_card_id === card.source_pr_id));
    assert.ok(cards.every(card => card.source_checksum === sourceChecksum));
    assert.ok(cards.every(card => card.raw_payload.agent === "Copilot"));
    assert.ok(cards.every(card => card.author === card.raw_payload.user));
    assert.ok(cards.every(card => card.merged === true && card.state === "closed"));
    assert.equal(missingLanguages.count, 3);
    assert.equal(missingLanguages.reason, "empty_source_cell");
    assert.deepEqual(missingLanguages.pr_ids, cards.filter(card => !Object.hasOwn(card, "language")).map(card => card.source_pr_id));
    assert.equal(missingEvidence.count, COPILOT_369_CARD_COUNT);
    assert.equal(missingEvidence.reason, "column_absent_from_source");
    assert.deepEqual(missingEvidence.pr_ids, ids);
    assert.equal(report.provenance.source_checksum, sourceChecksum);
    assert.equal(report.provenance.source_manifest_sha256, COPILOT_369_SOURCE_MANIFEST_CHECKSUM);
    assert.equal(report.provenance.dataset, "hao-li/AIDev-7.6M");
    assert.equal(report.provenance.sampling_design, "copilot_srs");
    assert.ok(cards.some(card => card.body.includes("\n")));
    assert.ok(cards.some(card => card.evidence.reviews?.some(review => review.body?.includes("\n"))));
});

test("reader rejects a missing source path with a typed error before returning cards", async () => {
    await assert.rejects(
        readCopilot369Cards(path.join(os.tmpdir(), "missing-copilot-369-source.csv")),
        error => error instanceof Copilot369SourceError && error.code === "CSV_READ_FAILED" && error.errors.length === 1,
    );
});

test("reader rejects an unpinned CSV before parsing or returning cards", async t => {
    const tempDirectory = await mkdtemp(path.join(os.tmpdir(), "copilot-369-source-"));
    t.after(() => rm(tempDirectory, {recursive: true, force: true}));
    const changedCsvPath = path.join(tempDirectory, "changed.csv");
    await writeFile(changedCsvPath, "not,the,pinned,source\n", "utf8");

    await assert.rejects(
        readCopilot369Cards(changedCsvPath),
        error => error instanceof Copilot369SourceError && error.code === "CSV_CHECKSUM_MISMATCH" && error.errors.length === 1,
    );
});

test("reader rejects sidecar order drift against the pinned row order", async t => {
    const tempDirectory = await mkdtemp(path.join(os.tmpdir(), "copilot-369-sidecar-"));
    t.after(() => rm(tempDirectory, {recursive: true, force: true}));
    const sidecar = JSON.parse(await readFile(sidecarPath, "utf8"));
    [sidecar.ordered_pr_ids[0], sidecar.ordered_pr_ids[1]] = [sidecar.ordered_pr_ids[1], sidecar.ordered_pr_ids[0]];
    const changedManifestPath = path.join(tempDirectory, "changed.manifest.json");
    await writeFile(changedManifestPath, JSON.stringify(sidecar), "utf8");

    await assert.rejects(
        readCopilot369Cards(csvPath, {manifestPath: changedManifestPath}),
        error => error instanceof Copilot369SourceError && error.code === "MANIFEST_MISMATCH" && error.errors.length === 1,
    );
});

test("reader rejects an unavailable sidecar", async () => {
    await assert.rejects(
        readCopilot369Cards(csvPath, {manifestPath: path.join(os.tmpdir(), "missing-copilot-369-manifest.json")}),
        error => error instanceof Copilot369SourceError && error.code === "MANIFEST_READ_FAILED",
    );
});

test("reader rejects malformed sidecar JSON with a typed error", async t => {
    const tempDirectory = await mkdtemp(path.join(os.tmpdir(), "copilot-369-bad-sidecar-"));
    t.after(() => rm(tempDirectory, {recursive: true, force: true}));
    const malformedManifestPath = path.join(tempDirectory, "malformed.manifest.json");
    await writeFile(malformedManifestPath, "{\"schema_version\":", "utf8");

    await assert.rejects(
        readCopilot369Cards(csvPath, {manifestPath: malformedManifestPath}),
        error => error instanceof Copilot369SourceError && error.code === "MANIFEST_PARSE_FAILED" && error.errors.length === 1,
    );
});
