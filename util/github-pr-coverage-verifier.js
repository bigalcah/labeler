import {REQUIRED_ENDPOINTS} from "./github-pr-persistence.js";

const ENDPOINTS = Object.freeze([
    ...REQUIRED_ENDPOINTS,
    "timeline",
    "diff",
]);
const FIELD_ENDPOINTS = Object.freeze({
    language: "csv",
    title: "metadata", body: "metadata", author: "metadata", state: "metadata", merged: "metadata",
    html_url: "metadata", created_at: "metadata", closed_at: "metadata", merged_at: "metadata",
    commit_count: "commits", changed_file_count: "files", additions: "files", deletions: "files", total_changes: "files",
    review_event_count: "reviews", changes_requested_review_count: "reviews",
    issue_comment_count: "issueComments", review_comment_count: "reviewComments",
});
const REPORTED_FIELDS = Object.freeze({commits: "commits", files: "changed_files", issueComments: "comments", reviewComments: "review_comments"});

const countBy = values => values.reduce((counts, value) => {
    counts[value] = (counts[value] || 0) + 1;
    return counts;
}, {});

const payloadOf = page => page?.normalized_payload ?? page?.normalizedPayload ?? null;
const pageState = page => page?.state || page?.status || "MISSING";
const endpointStatus = pages => {
    if (pages.length === 0) return "MISSING";
    if (pages.some(page => ["UNAVAILABLE", "FAILED"].includes(pageState(page)))) return "UNAVAILABLE";
    if (pages.some(page => ["TRUNCATED", "PARTIAL"].includes(pageState(page)))) return "TRUNCATED";
    if (pages.every(page => pageState(page) === "COMPLETE_EMPTY")) return "EMPTY";
    if (pages.every(page => ["COMPLETE", "COMPLETE_EMPTY"].includes(pageState(page)))) return "PRESENT";
    return "INCOMPLETE";
};

const capturedCount = pages => pages.reduce((total, page) => {
    if (Number.isInteger(page.item_count)) return total + page.item_count;
    if (Number.isInteger(page.itemCount)) return total + page.itemCount;
    const payload = payloadOf(page);
    return total + (Array.isArray(payload) ? payload.length : payload == null ? 0 : 1);
}, 0);

const metadataValue = (pages, name) => pages
    .map(payloadOf)
    .find(payload => payload && typeof payload === "object" && !Array.isArray(payload))?.[name] ?? null;

const reportedCount = (endpoint, pages, metadataPages) => {
    const explicit = pages.map(page => page.reported_count ?? page.reportedCount).find(Number.isInteger);
    if (Number.isInteger(explicit)) return explicit;
    const metadataField = REPORTED_FIELDS[endpoint];
    return metadataField ? metadataValue(metadataPages, metadataField) : null;
};

const fieldValuePresent = (field, pages, status) => {
    if (status === "MISSING" || status === "UNAVAILABLE" || status === "TRUNCATED" || status === "INCOMPLETE") return false;
    if (status === "EMPTY") return false;
    if (["commit_count", "changed_file_count", "additions", "deletions", "total_changes", "review_event_count", "changes_requested_review_count", "issue_comment_count", "review_comment_count"].includes(field)) return true;
    return pages.some(page => {
        const payload = payloadOf(page);
        return payload && typeof payload === "object" && !Array.isArray(payload) && payload[field] != null;
    });
};

const fieldStatus = (field, pages, status) => {
    if (status === "MISSING" || status === "UNAVAILABLE" || status === "TRUNCATED" || status === "INCOMPLETE") return status;
    return fieldValuePresent(field, pages, status) ? "PRESENT" : "EMPTY";
};

const baselineFieldStatus = (field, cards) => countBy(cards.map(card => card[field] == null ? "EMPTY" : "PRESENT"));

const telemetryReport = telemetry => {
    if (telemetry?.attempt_telemetry_version == null) return {
        telemetry_status: "NOT_INSTRUMENTED",
        event_count: 0,
        rate_limit_403_count: null,
        rate_limit_429_count: null,
    };
    const events = Array.isArray(telemetry.events) ? telemetry.events : [];
    const started = events.filter(event => event.event_type === "ATTEMPT_STARTED");
    const finished = events.filter(event => event.event_type === "ATTEMPT_FINISHED");
    return {
        telemetry_status: started.length === finished.length ? "COMPLETE" : "INCOMPLETE",
        event_count: events.length,
        started_count: started.length,
        finished_count: finished.length,
        rate_limit_403_count: events.filter(event => event.classification === "RATE_LIMIT" && event.http_status === 403).length,
        rate_limit_429_count: events.filter(event => event.classification === "RATE_LIMIT" && event.http_status === 429).length,
    };
};

const verifyGithubCoverage = ({study, cards, run, runCards = [], pages = [], snapshots = [], telemetry = null}) => {
    if (!study || ![30, 300].includes(study.expected_card_count)) {
        throw new Error("Coverage verification requires a persisted 30-card or 300-card study");
    }
    const expectedCardCount = study.expected_card_count;
    const sourceChecksum = study.source_checksum;
    const expected = [...cards].sort((left, right) => left.ordinal - right.ordinal);
    const expectedIds = new Set(expected.map(card => card.source_card_id));
    const mappedIds = new Set(runCards.map(card => card.pr_card_id));
    const snapshotIds = new Set(snapshots.map(snapshot => snapshot.pr_card_id));
    const snapshotsById = new Map(snapshots.map(snapshot => [snapshot.pr_card_id, snapshot]));
    const pagesByCardEndpoint = new Map();
    for (const page of pages) {
        const key = `${page.pr_card_id}:${page.endpoint}`;
        pagesByCardEndpoint.set(key, [...(pagesByCardEndpoint.get(key) || []), page]);
    }
    const metadataByCard = card => pagesByCardEndpoint.get(`${card.source_card_id}:metadata`) || [];
    const endpointReports = Object.fromEntries(ENDPOINTS.map(endpoint => {
        const cardReports = expected.map(card => {
            const endpointPages = pagesByCardEndpoint.get(`${card.source_card_id}:${endpoint}`) || [];
            const status = endpointStatus(endpointPages);
            return {source_card_id: card.source_card_id, status, captured_count: capturedCount(endpointPages), reported_count: reportedCount(endpoint, endpointPages, metadataByCard(card))};
        });
        return [endpoint, {
            denominator: expectedCardCount,
            status_counts: countBy(cardReports.map(report => report.status)),
            captured_count: cardReports.reduce((sum, report) => sum + report.captured_count, 0),
            reported_count: cardReports.every(report => Number.isInteger(report.reported_count))
                ? cardReports.reduce((sum, report) => sum + report.reported_count, 0) : null,
            cards: cardReports,
        }];
    }));
    const fieldReports = Object.fromEntries(Object.entries(FIELD_ENDPOINTS).map(([field, endpoint]) => {
        if (endpoint === "csv") return [field, {denominator: expectedCardCount, status_counts: baselineFieldStatus(field, expected), endpoint: null}];
        const statuses = expected.map(card => fieldStatus(field, pagesByCardEndpoint.get(`${card.source_card_id}:${endpoint}`) || [], endpointStatus(pagesByCardEndpoint.get(`${card.source_card_id}:${endpoint}`) || [])));
        return [field, {denominator: expectedCardCount, status_counts: countBy(statuses), endpoint}];
    }));
    const omittedCards = expected.filter(card => {
        if (!mappedIds.has(card.source_card_id)) return true;
        const requiredStatuses = REQUIRED_ENDPOINTS.map(endpoint => endpointStatus(pagesByCardEndpoint.get(`${card.source_card_id}:${endpoint}`) || []));
        return requiredStatuses.every(status => status === "UNAVAILABLE");
    }).map(card => ({
        source_card_id: card.source_card_id,
        ordinal: card.ordinal,
        repository: card.repository,
        pr_number: card.pr_number,
        reason: mappedIds.has(card.source_card_id) ? "GITHUB_PR_OMITTED" : "MISSING_RUN_CARD",
    }));
    const requiredComplete = expected.every(card => REQUIRED_ENDPOINTS.every(endpoint => ["PRESENT", "EMPTY"].includes(endpointReports[endpoint].cards.find(report => report.source_card_id === card.source_card_id)?.status)));
    const mappingExact = runCards.length === expectedCardCount
        && mappedIds.size === expectedCardCount
        && runCards.every((card, ordinal) => expected[ordinal]?.source_card_id === card.pr_card_id
            && expected[ordinal]?.ordinal === card.ordinal
            && (card.study_id === undefined || card.study_id === study.id));
    const snapshotsExact = snapshots.length === expectedCardCount
        && snapshotIds.size === expectedCardCount
        && snapshots.every(snapshot => expectedIds.has(snapshot.pr_card_id))
        && runCards.every(card => {
            const snapshot = snapshotsById.get(card.pr_card_id);
            return snapshot
                && (card.snapshot_id === undefined || snapshot.id === card.snapshot_id)
                && (card.snapshot_checksum === undefined || snapshot.snapshot_checksum === card.snapshot_checksum);
        });
    const pagesScoped = pages.every(page => expectedIds.has(page.pr_card_id)
        && (page.study_id === undefined || page.study_id === study.id));
    const compatible = expected.length === expectedCardCount
        && run?.study_id === study.id
        && run?.state === "COMPLETED"
        && run?.source_checksum != null
        && run.source_checksum === sourceChecksum
        && mappingExact
        && expected.every(card => mappedIds.has(card.source_card_id))
        && snapshotsExact
        && pagesScoped
        && requiredComplete;
    return {
        verifier_version: 1,
        study: {id: study.id, source_checksum: sourceChecksum, expected_card_count: expectedCardCount},
        run: {id: run?.id ?? null, study_id: run?.study_id ?? null, state: run?.state ?? null, source_checksum: run?.source_checksum ?? null},
        denominator: expectedCardCount,
        canonical_card_count: expected.length,
        persisted_run_card_count: runCards.length,
        persisted_snapshot_count: snapshots.length,
        omitted_cards: omittedCards,
        fields: fieldReports,
        endpoints: endpointReports,
        telemetry: telemetryReport(telemetry),
        card_v2_compatible: compatible,
        incompatibility_reasons: [
            expected.length !== expectedCardCount ? "CANONICAL_CARD_COUNT_MISMATCH" : null,
            run?.study_id !== study.id ? "RUN_STUDY_MISMATCH" : null,
            run?.state !== "COMPLETED" ? "RUN_NOT_COMPLETED" : null,
            run?.source_checksum !== sourceChecksum ? "SOURCE_CHECKSUM_MISMATCH" : null,
            !mappingExact || expected.some(card => !mappedIds.has(card.source_card_id)) ? "RUN_CARD_MAPPING_MISMATCH" : null,
            !snapshotsExact ? "SNAPSHOT_COUNT_MISMATCH" : null,
            !pagesScoped ? "PAGE_SCOPE_MISMATCH" : null,
            !requiredComplete ? "REQUIRED_ENDPOINT_COVERAGE_INCOMPLETE" : null,
        ].filter(Boolean),
    };
};

export {ENDPOINTS, FIELD_ENDPOINTS, verifyGithubCoverage};
