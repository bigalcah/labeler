import {createHash} from "node:crypto";
import {readFile, writeFile} from "node:fs/promises";
import path from "node:path";
import {isDeepStrictEqual} from "node:util";
import {parse} from "csv-parse/sync";
import {COPILOT_369_CSV_HEADERS, normalizeCopilot369Rows} from "./copilot-369-normalizer.js";

const COPILOT_369_SOURCE_CHECKSUM = "fad0881b9e40b1b68a577e84ad60c90d48fcebe79db8d55d05613fc1746794fb";
const COPILOT_369_SOURCE_MANIFEST_CHECKSUM = "a0647f1d2136a9602393f815d9f921edd95d665e5e0e7d71236b8c3030427a11";
const COPILOT_369_CARD_COUNT = 369;
const COPILOT_369_COLUMN_COUNT = 85;
const COPILOT_369_CANONICAL_FILENAME = "copilot-369-cards.csv";
const COPILOT_369_MANIFEST_FILENAME = "copilot-369-cards.manifest.json";
const ORIGINAL_CSV_FILENAME = "muestra_copilot.csv";
const ORIGINAL_MANIFEST_FILENAME = "manifest.json";

const COPILOT_369_SOURCE_PROVENANCE = Object.freeze({
    filename: ORIGINAL_MANIFEST_FILENAME,
    sha256: COPILOT_369_SOURCE_MANIFEST_CHECKSUM,
    dataset: "hao-li/AIDev-7.6M",
    dataset_profile: "v5",
    dataset_revision: "37bbe1533e26cc1e1374917dba1186d1c8a4dc81",
    export_fingerprint: "2f71d3177352a16c12aea779549def515bd53cec832e51ced32765e7f95292d0",
    source_export_fingerprint: "8457482738cd5dce5e8c9466fbf880788d168c7e6a958261be5f61d51a7aa4f7",
    sampling_fingerprint: "8a960506c50ede0e94646c7cab6cf2fad765fde7ef47013f898cb170ad9c42cb",
    sampling_design: "copilot_srs",
    sampling_method: "simple_random_without_replacement",
    selection_scope: "observable_review_and_commit",
    selection_schema_version: "observable-v2",
    sampling_seed: 20260910,
    population_size: 9320,
    selected_pr_count: COPILOT_369_CARD_COUNT,
    reserve_pr_count: 37,
    reserve_imported: false,
    study_agents: Object.freeze(["Copilot"]),
    timestamp_semantics: "git_committer_date_proxy",
    csv: Object.freeze({
        filename: ORIGINAL_CSV_FILENAME,
        sha256: COPILOT_369_SOURCE_CHECKSUM,
        size_bytes: 26262782,
        rows: COPILOT_369_CARD_COUNT,
        source_artifact: "copilot_sample_csv",
    }),
});

class Copilot369SourceError extends Error {
    constructor(code, message, {errors = [], report = null} = {}) {
        super(message);
        this.name = "Copilot369SourceError";
        this.code = code;
        this.errors = errors;
        this.report = report;
    }
}

const digest = buffer => createHash("sha256").update(buffer).digest("hex");

const makeSourceError = (code, message, field) => new Copilot369SourceError(code, message, {
    errors: [{code, row_number: null, pr_id: null, field, item_index: null, message}],
});

const makeReportProvenance = (csvPath, sourceChecksum) => ({
    source_type: "CSV",
    source_file: path.basename(csvPath),
    source_checksum: sourceChecksum,
    source_manifest_sha256: COPILOT_369_SOURCE_MANIFEST_CHECKSUM,
    dataset: COPILOT_369_SOURCE_PROVENANCE.dataset,
    dataset_profile: COPILOT_369_SOURCE_PROVENANCE.dataset_profile,
    dataset_revision: COPILOT_369_SOURCE_PROVENANCE.dataset_revision,
    export_fingerprint: COPILOT_369_SOURCE_PROVENANCE.export_fingerprint,
    sampling_fingerprint: COPILOT_369_SOURCE_PROVENANCE.sampling_fingerprint,
    sampling_design: COPILOT_369_SOURCE_PROVENANCE.sampling_design,
});

const parseCsvBuffer = buffer => {
    let records;
    try {
        records = parse(buffer, {bom: true, skip_empty_lines: true, relax_column_count: false, skip_records_with_error: false});
    } catch (error) {
        throw makeSourceError("CSV_PARSE_FAILED", `Could not parse Copilot369 CSV: ${error.message}`, "csv");
    }
    if (records.length === 0) throw makeSourceError("CSV_EMPTY", "Copilot369 CSV has no header", "header");
    const [header, ...values] = records;
    if (!isDeepStrictEqual(header, COPILOT_369_CSV_HEADERS)) {
        throw makeSourceError("CSV_HEADER_MISMATCH", `Expected the pinned ${COPILOT_369_COLUMN_COUNT}-column Copilot369 header`, "header");
    }
    if (values.length !== COPILOT_369_CARD_COUNT) {
        throw makeSourceError("CSV_CARD_COUNT_MISMATCH", `Expected ${COPILOT_369_CARD_COUNT} rows; received ${values.length}`, "rows");
    }
    return values.map(row => Object.fromEntries(header.map((name, index) => [name, row[index]])));
};

const sourceManifestMatches = manifest => {
    const csv = manifest?.files?.[ORIGINAL_CSV_FILENAME];
    const copilotSampling = manifest?.designs?.copilot_srs;
    const actual = {
        filename: ORIGINAL_MANIFEST_FILENAME,
        sha256: COPILOT_369_SOURCE_MANIFEST_CHECKSUM,
        dataset: manifest?.source_provenance?.dataset,
        dataset_profile: manifest?.source_provenance?.dataset_profile,
        dataset_revision: manifest?.source_provenance?.dataset_revision,
        export_fingerprint: manifest?.export_fingerprint,
        source_export_fingerprint: manifest?.source_export_fingerprint,
        sampling_fingerprint: manifest?.sampling_fingerprint,
        sampling_design: manifest?.sampling_design,
        sampling_method: manifest?.sampling_method,
        selection_scope: manifest?.selection_scope,
        selection_schema_version: manifest?.selection_schema_version,
        sampling_seed: manifest?.config?.seed,
        population_size: copilotSampling?.population_size,
        selected_pr_count: manifest?.classification_context?.selected_pr_count,
        reserve_pr_count: manifest?.classification_context?.reserve_pr_count,
        reserve_imported: false,
        study_agents: manifest?.study_agents,
        timestamp_semantics: manifest?.classification_view?.timestamp_semantics,
        csv: {
            filename: ORIGINAL_CSV_FILENAME,
            sha256: csv?.sha256,
            size_bytes: csv?.size_bytes,
            rows: csv?.rows,
            source_artifact: csv?.source_artifact,
        },
    };
    return isDeepStrictEqual(actual, COPILOT_369_SOURCE_PROVENANCE);
};

const buildSidecar = (rows, byteLength) => ({
    schema_version: 1,
    source: {
        filename: ORIGINAL_CSV_FILENAME,
        sha256: COPILOT_369_SOURCE_CHECKSUM,
        size_bytes: byteLength,
        row_count: COPILOT_369_CARD_COUNT,
        column_count: COPILOT_369_COLUMN_COUNT,
        header: COPILOT_369_CSV_HEADERS,
    },
    source_manifest: COPILOT_369_SOURCE_PROVENANCE,
    ordered_pr_ids: rows.map(row => row.pr_id),
});

const readCopilot369Cards = async (csvPath, {manifestPath = path.join(path.dirname(csvPath), COPILOT_369_MANIFEST_FILENAME)} = {}) => {
    let csvBuffer;
    try {
        csvBuffer = await readFile(csvPath);
    } catch (error) {
        throw makeSourceError("CSV_READ_FAILED", `Could not read Copilot369 CSV: ${error.message}`, "csv");
    }
    const sourceChecksum = digest(csvBuffer);
    if (sourceChecksum !== COPILOT_369_SOURCE_CHECKSUM) {
        throw makeSourceError("CSV_CHECKSUM_MISMATCH", `Expected ${COPILOT_369_SOURCE_CHECKSUM}; received ${sourceChecksum}`, "sha256");
    }

    const rows = parseCsvBuffer(csvBuffer);
    let manifestBuffer;
    try {
        manifestBuffer = await readFile(manifestPath);
    } catch (error) {
        throw makeSourceError("MANIFEST_READ_FAILED", `Could not read Copilot369 sidecar: ${error.message}`, "manifest");
    }
    let sidecar;
    try {
        sidecar = JSON.parse(manifestBuffer.toString("utf8"));
    } catch (error) {
        throw makeSourceError("MANIFEST_PARSE_FAILED", `Could not parse Copilot369 sidecar: ${error.message}`, "manifest");
    }
    const expectedSidecar = buildSidecar(rows, csvBuffer.length);
    if (!isDeepStrictEqual(sidecar, expectedSidecar)) {
        throw makeSourceError("MANIFEST_MISMATCH", "Copilot369 sidecar does not match the pinned source, header, provenance, or ordered PR identities", "manifest");
    }

    const provenance = makeReportProvenance(csvPath, sourceChecksum);
    const normalized = normalizeCopilot369Rows(rows, {sourceChecksum, provenance});
    if (normalized.errors.length > 0) {
        throw new Copilot369SourceError("COPILOT_369_SOURCE_INVALID", "Copilot369 source contains invalid rows", {
            errors: normalized.errors,
            report: normalized.report,
        });
    }
    return {cards: normalized.cards, errors: [], sourceChecksum, report: normalized.report};
};

const prepareCopilot369Source = async ({sourcePath, sourceManifestPath, outputCsvPath, manifestPath}) => {
    let sourceBuffer;
    let sourceManifestBuffer;
    try {
        [sourceBuffer, sourceManifestBuffer] = await Promise.all([readFile(sourcePath), readFile(sourceManifestPath)]);
    } catch (error) {
        throw makeSourceError("PREPARATION_INPUT_READ_FAILED", `Could not read source CSV or manifest: ${error.message}`, "source");
    }
    if (digest(sourceBuffer) !== COPILOT_369_SOURCE_CHECKSUM) {
        throw makeSourceError("CSV_CHECKSUM_MISMATCH", `Expected ${COPILOT_369_SOURCE_CHECKSUM}; received ${digest(sourceBuffer)}`, "sha256");
    }
    if (digest(sourceManifestBuffer) !== COPILOT_369_SOURCE_MANIFEST_CHECKSUM) {
        throw makeSourceError("SOURCE_MANIFEST_CHECKSUM_MISMATCH", `Expected ${COPILOT_369_SOURCE_MANIFEST_CHECKSUM}; received ${digest(sourceManifestBuffer)}`, "source_manifest_sha256");
    }
    let sourceManifest;
    try {
        sourceManifest = JSON.parse(sourceManifestBuffer.toString("utf8"));
    } catch (error) {
        throw makeSourceError("SOURCE_MANIFEST_PARSE_FAILED", `Could not parse source manifest: ${error.message}`, "source_manifest");
    }
    if (!sourceManifestMatches(sourceManifest)) {
        throw makeSourceError("SOURCE_MANIFEST_INVALID", "Original Copilot369 manifest provenance does not match the pinned dataset", "source_manifest");
    }
    const rows = parseCsvBuffer(sourceBuffer);
    const provenance = makeReportProvenance(outputCsvPath, COPILOT_369_SOURCE_CHECKSUM);
    const normalized = normalizeCopilot369Rows(rows, {sourceChecksum: COPILOT_369_SOURCE_CHECKSUM, provenance});
    if (normalized.errors.length > 0) {
        throw new Copilot369SourceError("COPILOT_369_SOURCE_INVALID", "Copilot369 source contains invalid rows", {
            errors: normalized.errors,
            report: normalized.report,
        });
    }
    const sidecar = buildSidecar(rows, sourceBuffer.length);
    await writeFile(outputCsvPath, sourceBuffer);
    await writeFile(manifestPath, `${JSON.stringify(sidecar, null, 2)}\n`, "utf8");
    return {cards: normalized.cards, errors: [], sourceChecksum: COPILOT_369_SOURCE_CHECKSUM, report: normalized.report};
};

export {
    COPILOT_369_CANONICAL_FILENAME,
    COPILOT_369_CARD_COUNT,
    COPILOT_369_COLUMN_COUNT,
    COPILOT_369_CSV_HEADERS,
    COPILOT_369_MANIFEST_FILENAME,
    COPILOT_369_SOURCE_CHECKSUM,
    COPILOT_369_SOURCE_MANIFEST_CHECKSUM,
    COPILOT_369_SOURCE_PROVENANCE,
    Copilot369SourceError,
    normalizeCopilot369Rows,
    prepareCopilot369Source,
    readCopilot369Cards,
};
