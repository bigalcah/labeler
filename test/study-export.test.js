import assert from "node:assert/strict";
import {mkdtemp, mkdir, readFile, rm, stat, writeFile} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {resolveStudyExportInputs} from "../util/study-export-input.js";
import {assertSafeExportData} from "../util/study-export-format.js";
import {createStudyExport} from "../util/study-export.js";

const study = Object.freeze({
    id: "validation-study-id",
    study_key: "pr-card-sorting-validation-30",
    source_checksum: "source-checksum-30",
    expected_card_count: 30,
    bootstrap_state: "READY",
    config: {participants: ["javier", "diego", "pablo"]},
});
const participants = Object.freeze([
    {reviewer_id: 11, participant_key: "javier", participant_ordinal: 0},
    {reviewer_id: 22, participant_key: "diego", participant_ordinal: 1},
    {reviewer_id: 33, participant_key: "pablo", participant_ordinal: 2},
]);
const categories = participants.map(participant => ({
    participant_key: participant.participant_key,
    participant_ordinal: participant.participant_ordinal,
    category_ordinal: 0,
    category_name: `Category ${participant.participant_key}`,
    created_at: new Date("2026-09-01T00:00:00.000Z"),
    updated_at: new Date("2026-09-02T00:00:00.000Z"),
}));
const results = participants.flatMap(participant => Array.from({length: 30}, (_value, cardOrdinal) => {
    const classified = cardOrdinal % 2 === 0;
    return {
        participant_key: participant.participant_key,
        participant_ordinal: participant.participant_ordinal,
        card_ordinal: cardOrdinal,
        source_card_id: `card-${cardOrdinal.toString().padStart(2, "0")}`,
        decision: classified ? "CLASSIFIED" : "DISCARDED",
        category_ordinal: classified ? 0 : null,
        category_name: classified ? `Category ${participant.participant_key}` : null,
        classification_remarks: classified ? `Remark ${cardOrdinal}` : null,
        discard_reason: classified ? null : `Reason ${cardOrdinal}`,
        decision_timestamp: new Date("2026-09-03T00:00:00.000Z"),
        decision_updated_at: classified ? new Date("2026-09-04T00:00:00.000Z") : null,
        decision_revision: classified ? 2 : 1,
        source_html_url: `https://csv.example/pull/${cardOrdinal}`,
        resolved_html_url: `https://github.example/pull/${cardOrdinal}`,
        url_provenance: "GITHUB",
        source_type: "CSV",
        card_source_checksum: `membership-${cardOrdinal}`,
        content_checksum: `content-${cardOrdinal}`,
        enrichment_run_id: "run-30",
        enrichment_snapshot_checksum: `snapshot-${cardOrdinal}`,
    };
}));
const enrichment = Object.freeze({
    run_id: "run-30",
    source_checksum: study.source_checksum,
    promoted_at: new Date("2026-08-31T00:00:00.000Z"),
    state: "COMPLETED",
    manifest_checksum: "enrichment-manifest",
    normalizer_version: "1",
    coverage_count: 30,
    snapshot_checksums_sha256: "snapshot-set-checksum",
});

class ExportClient {
    constructor({exportResults = results} = {}) {
        this.exportResults = exportResults;
        this.queries = [];
    }

    async query(sql, parameters = []) {
        this.queries.push({sql, parameters});
        if (sql.startsWith("BEGIN")) return {rows: []};
        if (sql === "COMMIT" || sql === "ROLLBACK") return {rows: []};
        if (sql.includes("FROM study\n")) return {rows: [study]};
        if (sql.includes("FROM study_participant")) return {rows: participants};
        if (sql.includes("FROM study_card")) return {rows: this.exportResults};
        if (sql.includes("FROM participant_category")) return {rows: categories};
        if (sql.includes("FROM study_enrichment_promotion")) return {rows: [enrichment]};
        throw new Error(`Unexpected export query: ${sql}`);
    }

    release() {}
}

const withDirectory = async operation => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "labeler-study-export-"));
    try {
        return await operation(directory);
    } finally {
        await rm(directory, {recursive: true, force: true});
    }
};

test("complete 30-card export publishes deterministic operator package without touching the 300 study", async () => withDirectory(async directory => {
    const client = new ExportClient();
    const destination = path.join(directory, "validation-export");
    const manifest = await createStudyExport({
        pool: {connect: async () => client},
        studyKey: study.study_key,
        destination,
        hmacSecret: "external-export-secret-with-at-least-32-bytes",
    });

    assert.equal(manifest.study.expectedCardCount, 30);
    assert.deepEqual(manifest.completion.totals, {participants: 3, classified: 45, discarded: 45, terminal: 90});
    const resultsCsv = await readFile(path.join(destination, "results.csv"), "utf8");
    const categoriesCsv = await readFile(path.join(destination, "categories.csv"), "utf8");
    assert.equal(resultsCsv.trim().split("\n").length, 91);
    assert.equal(categoriesCsv.trim().split("\n").length, 4);
    for (const header of ["category_name", "classification_remarks", "discard_reason", "decision_revision",
        "source_html_url", "resolved_html_url", "url_provenance", "enrichment_snapshot_checksum"]) {
        assert.equal(resultsCsv.split("\n")[0].split(",").includes(header), true);
    }
    assert.match(categoriesCsv, /Category javier/);
    assert.equal(manifest.enrichment.coverageCount, 30);
    assert.match(manifest.files["results.csv"].sha256, /^[a-f0-9]{64}$/);
    assert.doesNotMatch(`${resultsCsv}${categoriesCsv}${JSON.stringify(manifest)}`,
        /raw_payload|password_hash|session_id|quota_metadata|external-export-secret/);
    assert.deepEqual(client.queries.map(query => query.sql).slice(0, 2), [
        "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY",
        client.queries[1].sql,
    ]);
    assert.equal(client.queries.at(-1).sql, "COMMIT");
    assert.equal(client.queries.filter(query => query.parameters.length > 0)
        .every(query => query.parameters.includes(study.study_key) || query.parameters.includes(study.id)), true);
    assert.equal(client.queries.some(query => /\b(?:INSERT|UPDATE|DELETE|TRUNCATE)\b/.test(query.sql)), false);
}));

test("incomplete study rolls back and publishes no destination", async () => withDirectory(async directory => {
    const client = new ExportClient({exportResults: results.slice(0, -1)});
    const destination = path.join(directory, "incomplete-export");
    await assert.rejects(() => createStudyExport({
        pool: {connect: async () => client}, studyKey: study.study_key, destination, hmacSecret: "x".repeat(32),
    }), /terminal decision/);
    await assert.rejects(() => stat(destination), {code: "ENOENT"});
    assert.equal(client.queries.at(-1).sql, "ROLLBACK");
}));

test("export rejects prohibited fields before publishing", async () => {
    for (const field of ["token", "secret", "session_id", "password_hash", "raw_payload", "quota_metadata"]) {
        assert.throws(() => assertSafeExportData({safe: "value", [field]: "prohibited"}), /prohibited field/i);
    }
});

test("HMAC pseudonyms are isolated by study and exports are byte-identical", async () => withDirectory(async directory => {
    const first = path.join(directory, "first");
    const second = path.join(directory, "second");
    const otherStudy = path.join(directory, "other-study");
    for (const [destination, studyKey] of [[first, study.study_key], [second, study.study_key], [otherStudy, "other-study"]]) {
        const client = new ExportClient();
        client.query = async (sql, parameters = []) => {
            if (sql.includes("FROM study\n")) return {rows: [{...study, study_key: studyKey}]};
            return ExportClient.prototype.query.call(client, sql, parameters);
        };
        await createStudyExport({pool: {connect: async () => client}, studyKey, destination, hmacSecret: "h".repeat(32)});
    }
    for (const file of ["results.csv", "categories.csv", "manifest.json"]) {
        assert.deepEqual(await readFile(path.join(first, file)), await readFile(path.join(second, file)));
    }
    const firstPseudonym = (await readFile(path.join(first, "results.csv"), "utf8")).split("\n")[1].split(",")[1];
    const otherPseudonym = (await readFile(path.join(otherStudy, "results.csv"), "utf8")).split("\n")[1].split(",")[1];
    assert.notEqual(firstPseudonym, otherPseudonym);
}));

test("export inputs require protected external secret and new external destination", async () => withDirectory(async directory => {
    const repositoryRoot = path.resolve(new URL("..", import.meta.url).pathname);
    const secretFile = path.join(directory, "export-hmac");
    await writeFile(secretFile, "s".repeat(32), {mode: 0o400});
    const inputs = resolveStudyExportInputs([
        "--study-key", study.study_key, "--output", path.join(directory, "package"),
    ], {STUDY_EXPORT_HMAC_SECRET_FILE: secretFile}, repositoryRoot);
    assert.equal(inputs.hmacSecret, "s".repeat(32));
    assert.equal(JSON.stringify(inputs).includes(secretFile), false);
    assert.throws(() => resolveStudyExportInputs(["--study-key", study.study_key, "--output", path.join(repositoryRoot, "package")],
        {STUDY_EXPORT_HMAC_SECRET_FILE: secretFile}, repositoryRoot), /outside the repository/);
    await mkdir(path.join(directory, "existing"));
    assert.throws(() => resolveStudyExportInputs(["--study-key", study.study_key, "--output", path.join(directory, "existing")],
        {STUDY_EXPORT_HMAC_SECRET_FILE: secretFile}, repositoryRoot), /must not exist/);
    const permissiveSecret = path.join(directory, "permissive-secret");
    await writeFile(permissiveSecret, "p".repeat(32), {mode: 0o644});
    assert.throws(() => resolveStudyExportInputs(["--study-key", study.study_key, "--output", path.join(directory, "other")],
        {STUDY_EXPORT_HMAC_SECRET_FILE: permissiveSecret}, repositoryRoot), /HMAC_SECRET_FILE is invalid/);
}));

test("package exposes only the offline study export command", async () => {
    const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
    assert.equal(packageJson.scripts["export:study"], "node scripts/export-study.js");
    assert.equal(Object.keys(packageJson.scripts).some(name => name.includes("export:http")), false);
});
