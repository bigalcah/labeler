import {REQUIRED_ENDPOINTS} from "./github-pr-persistence.js";

const EXPECTED_CARD_COUNT = 300;
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

const verifyGithubCoverage = ({cards, run, runCards = [], pages = [], snapshots = [], telemetry = null, sourceChecksum = null, expectedCardCount = EXPECTED_CARD_COUNT}) => {
    const expected = [...cards].sort((left, right) => left.ordinal - right.ordinal);
    const mappedIds = new Set(runCards.map(card => card.pr_card_id));
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
    const compatible = expected.length === expectedCardCount
        && run?.state === "COMPLETED"
        && run?.source_checksum != null
        && (sourceChecksum == null || run.source_checksum === sourceChecksum)
        && mappedIds.size === expectedCardCount
        && expected.every(card => mappedIds.has(card.source_card_id))
        && snapshots.length === expectedCardCount
        && requiredComplete;
    return {
        verifier_version: 1,
        run: {id: run?.id ?? null, state: run?.state ?? null, source_checksum: run?.source_checksum ?? null},
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
            run?.state !== "COMPLETED" ? "RUN_NOT_COMPLETED" : null,
            sourceChecksum != null && run?.source_checksum !== sourceChecksum ? "SOURCE_CHECKSUM_MISMATCH" : null,
            mappedIds.size !== expectedCardCount || expected.some(card => !mappedIds.has(card.source_card_id)) ? "RUN_CARD_MAPPING_MISMATCH" : null,
            snapshots.length !== expectedCardCount ? "SNAPSHOT_COUNT_MISMATCH" : null,
            !requiredComplete ? "REQUIRED_ENDPOINT_COVERAGE_INCOMPLETE" : null,
        ].filter(Boolean),
    };
};

export {ENDPOINTS, FIELD_ENDPOINTS, verifyGithubCoverage};
