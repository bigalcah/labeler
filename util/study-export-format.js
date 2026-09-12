import {createHash, createHmac} from "node:crypto";

const RESULTS_HEADERS = Object.freeze([
    "participant_ordinal", "participant_pseudonym", "card_ordinal", "source_card_id", "decision",
    "category_ordinal", "category_name", "classification_remarks", "discard_reason", "decision_timestamp",
    "decision_updated_at", "decision_revision", "source_html_url", "resolved_html_url", "url_provenance",
    "source_type", "card_source_checksum", "content_checksum", "enrichment_run_id", "enrichment_snapshot_checksum",
]);
const CATEGORIES_HEADERS = Object.freeze([
    "participant_ordinal", "participant_pseudonym", "category_ordinal", "category_name", "created_at", "updated_at",
]);
const PROHIBITED_FIELD = /(?:^|_)(?:token|secret|session|password|credential|hash|raw_payload|raw_response|throttl|quota)(?:_|$)/i;

class StudyExportError extends Error {
    constructor(message) {
        super(message);
        this.name = "StudyExportError";
    }
}

const assertSafeExportData = value => {
    if (Array.isArray(value)) {
        value.forEach(assertSafeExportData);
        return;
    }
    if (!value || typeof value !== "object" || value instanceof Date) return;
    for (const [key, child] of Object.entries(value)) {
        if (PROHIBITED_FIELD.test(key)) throw new StudyExportError(`Export contains prohibited field: ${key}`);
        assertSafeExportData(child);
    }
};

const text = value => value === null || value === undefined
    ? ""
    : value instanceof Date ? value.toISOString() : String(value);
const csvCell = value => {
    const content = text(value);
    return /[",\r\n]/.test(content) ? `"${content.replaceAll("\"", "\"\"")}"` : content;
};
const csv = (headers, rows) => `${headers.join(",")}\n${rows.map(row => headers.map(header => csvCell(row[header])).join(",")).join("\n")}\n`;
const sha256 = value => createHash("sha256").update(value).digest("hex");
const pseudonym = (secret, studyKey, participantKey) => createHmac("sha256", secret)
    .update(studyKey, "utf8")
    .update("\0", "utf8")
    .update(participantKey, "utf8")
    .digest("hex");

const completion = (participants, results, expectedCardCount) => {
    const byParticipant = participants.map(participant => {
        const decisions = results.filter(row => row.participant_key === participant.participant_key);
        const classified = decisions.filter(row => row.decision === "CLASSIFIED").length;
        const discarded = decisions.filter(row => row.decision === "DISCARDED").length;
        return {
            participantOrdinal: participant.participant_ordinal,
            classified,
            discarded,
            terminal: classified + discarded,
            expected: expectedCardCount,
        };
    });
    const totals = byParticipant.reduce((result, participant) => ({
        participants: result.participants + 1,
        classified: result.classified + participant.classified,
        discarded: result.discarded + participant.discarded,
        terminal: result.terminal + participant.terminal,
    }), {participants: 0, classified: 0, discarded: 0, terminal: 0});
    return {byParticipant, totals};
};

const buildStudyExportPackage = ({study, participants, categories, results, enrichment, hmacSecret}) => {
    const participantPseudonyms = new Map(participants.map(participant => [
        participant.participant_key,
        pseudonym(hmacSecret, study.study_key, participant.participant_key),
    ]));
    const publicResults = results.map(row => ({
        ...row,
        participant_pseudonym: participantPseudonyms.get(row.participant_key),
        participant_key: undefined,
    }));
    const publicCategories = categories.map(row => ({
        ...row,
        participant_pseudonym: participantPseudonyms.get(row.participant_key),
        participant_key: undefined,
    }));
    const resultsCsv = csv(RESULTS_HEADERS, publicResults);
    const categoriesCsv = csv(CATEGORIES_HEADERS, publicCategories);
    const progress = completion(participants, results, study.expected_card_count);
    const membership = [...new Map(results.map(row => [row.card_ordinal, {
        ordinal: row.card_ordinal,
        sourceCardId: row.source_card_id,
        sourceChecksum: row.card_source_checksum,
    }])).values()];
    const enrichmentEvidence = enrichment ? {
        source: "GITHUB",
        runId: enrichment.run_id,
        sourceChecksum: enrichment.source_checksum,
        promotedAt: text(enrichment.promoted_at),
        state: enrichment.state,
        normalizerVersion: enrichment.normalizer_version,
        manifestChecksum: enrichment.manifest_checksum,
        coverageCount: enrichment.coverage_count,
        snapshotChecksumsSha256: enrichment.snapshot_checksums_sha256,
    } : {source: "CSV", runId: null, coverageCount: 0};
    const manifest = {
        manifestVersion: 1,
        study: {
            studyKey: study.study_key,
            expectedCardCount: study.expected_card_count,
            sourceChecksum: study.source_checksum,
            membershipSha256: sha256(JSON.stringify(membership)),
        },
        completion: progress,
        enrichment: enrichmentEvidence,
        pseudonyms: {algorithm: "HMAC-SHA-256", scope: "study_key\\0participant_key", encoding: "hex"},
        files: {
            "results.csv": {rows: publicResults.length, sha256: sha256(resultsCsv)},
            "categories.csv": {rows: publicCategories.length, sha256: sha256(categoriesCsv)},
        },
    };
    assertSafeExportData({results: publicResults, categories: publicCategories, manifest});
    return Object.freeze({
        resultsCsv,
        categoriesCsv,
        manifestJson: `${JSON.stringify(manifest, null, 2)}\n`,
        manifest,
    });
};

export {StudyExportError, assertSafeExportData, buildStudyExportPackage};
