const AVAILABILITY = Object.freeze({PRESENT: "PRESENT", EMPTY: "EMPTY", UNAVAILABLE: "UNAVAILABLE", TRUNCATED: "TRUNCATED", INCOMPLETE: "INCOMPLETE"});
const OVERLAPPING_FIELDS = Object.freeze({title: "title", body: "body", author: "author", state: "state", merged: "merged", html_url: "html_url"});
const DATE_FIELDS = Object.freeze({created_at: "created_at", closed_at: "closed_at", merged_at: "merged_at"});
const SNAPSHOT_ENDPOINTS = Object.freeze(["metadata", "commits", "files", "reviews", "issueComments", "reviewComments", "timeline"]);
const METRICS = Object.freeze({
    commit_count: {endpoint: "commits", pointer: "/value/commits"},
    changed_file_count: {endpoint: "files", pointer: "/value/changed_files"},
    additions: {endpoint: "files", pointer: "/value/additions"},
    deletions: {endpoint: "files", pointer: "/value/deletions"},
    total_changes: {endpoint: "files", pointer: "/value/total_changes"},
    review_event_count: {endpoint: "reviews", pointer: "/value/reviews"},
    changes_requested_review_count: {endpoint: "reviews", pointer: "/value/changes_requested"},
    issue_comment_count: {endpoint: "issueComments", pointer: "/value/comments"},
    review_comment_count: {endpoint: "reviewComments", pointer: "/value/review_comments"},
});

const csvProvenance = pointer => ({source: "CSV", run_id: null, snapshot_checksum: null, endpoint: null, status: "BASELINE", captured_at: null, pointer});
const githubProvenance = (runId, checksum, endpoint, status, capturedAt, pointer) => ({source: "GITHUB", run_id: runId, snapshot_checksum: checksum, endpoint, status, captured_at: capturedAt ?? null, pointer});
const derivedProvenance = (runId, checksum, endpoint, status, capturedAt, pointer) => ({source: "DERIVED", run_id: runId, snapshot_checksum: checksum, endpoint, status, captured_at: capturedAt ?? null, pointer});

const safeText = value => typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? value : value == null ? null : String(value);
const safeUrl = value => {
    if (typeof value !== "string") return null;
    try {
        const url = new URL(value);
        return url.protocol === "https:" && ["github.com", "www.github.com"].includes(url.hostname) ? url.toString() : null;
    } catch (_error) {
        return null;
    }
};
const safeUser = value => {
    const user = value && typeof value === "object" ? value : {};
    return safeText(user.login ?? user.name);
};
const pagePayload = page => page?.normalized_payload ?? page?.normalizedPayload ?? null;

const endpointPayloads = pages => (Array.isArray(pages) ? pages : []).reduce((result, page) => {
    const endpoint = page.endpoint || "unknown";
    const current = result[endpoint] || {status: AVAILABILITY.EMPTY, pages: [], captured_count: 0, reported_count: null, reason: null, captured_at: null};
    current.pages.push({payload: pagePayload(page), state: page.status || page.state || "COMPLETE", item_count: page.itemCount ?? null, captured_at: page.captured_at ?? page.capturedAt ?? null});
    current.captured_count += Number.isInteger(page.itemCount) ? page.itemCount : Array.isArray(pagePayload(page)) ? pagePayload(page).length : pagePayload(page) == null ? 0 : 1;
    current.captured_at = current.captured_at || page.captured_at || page.capturedAt || null;
    const state = page.status || page.state;
    if (state === "UNAVAILABLE" || state === "FAILED") current.status = AVAILABILITY.UNAVAILABLE;
    else if (state === "TRUNCATED" || state === "PARTIAL") { current.status = AVAILABILITY.TRUNCATED; current.reason = page.reason || "GitHub capture limit reached"; }
    else if (current.status !== AVAILABILITY.UNAVAILABLE && current.status !== AVAILABILITY.TRUNCATED) current.status = state === "COMPLETE_EMPTY" ? AVAILABILITY.EMPTY : AVAILABILITY.PRESENT;
    if (page.reported_count !== undefined) current.reported_count = page.reported_count;
    result[endpoint] = current;
    return result;
}, {});

const values = endpoint => endpoint?.pages.flatMap(page => Array.isArray(page.payload) ? page.payload : []) || [];
const latestObject = endpoint => endpoint?.pages.map(page => page.payload).filter(payload => payload && typeof payload === "object" && !Array.isArray(payload)).at(-1) || null;
const statusFor = (endpoint, hasSnapshot = false) => endpoint?.status || (hasSnapshot ? AVAILABILITY.INCOMPLETE : AVAILABILITY.UNAVAILABLE);
const field = (value, availability, provenance) => ({value, availability, provenance});

const projectEvidenceItems = (endpoint, endpointName, runId, checksum, hasSnapshot) => {
    const status = statusFor(endpoint, hasSnapshot);
    const items = values(endpoint).map(item => ({
        id: safeText(item.id ?? item.sha),
        author: safeUser(item.user ?? item.author ?? item.actor),
        state: safeText(item.state ?? item.event),
        body: safeText(item.body ?? item.message),
        path: safeText(item.path ?? item.filename),
        diff_hunk: safeText(item.diff_hunk),
        line: item.line ?? item.original_line ?? null,
        created_at: safeText(item.submitted_at ?? item.created_at),
        updated_at: safeText(item.updated_at),
        url: safeUrl(item.html_url ?? item.blob_url ?? item.raw_url),
    }));
    items.sort((left, right) => String(left.created_at || left.id || "").localeCompare(String(right.created_at || right.id || "")) || String(left.id || "").localeCompare(String(right.id || "")));
    return {items, availability: status, captured_count: endpoint?.captured_count ?? 0, reported_count: endpoint?.reported_count ?? null, reason: endpoint?.reason ?? (status === AVAILABILITY.INCOMPLETE ? "Endpoint missing from local snapshot" : null), provenance: githubProvenance(runId, checksum, endpointName, status, endpoint?.captured_at, null)};
};

const projectCardV2 = (card, enrichmentInput = null) => {
    const enrichment = enrichmentInput && typeof enrichmentInput === "object" ? enrichmentInput : null;
    const pages = endpointPayloads(enrichment?.pages);
    const runId = enrichment?.run_id ?? null;
    const snapshotChecksum = enrichment?.snapshot_checksum ?? null;
    const hasSnapshot = enrichment !== null;
    const metadataEndpoint = pages.metadata;
    const metadata = latestObject(metadataEndpoint);
    const provenance = {};
    const fields = {};
    for (const [name, githubName] of Object.entries(OVERLAPPING_FIELDS)) {
        const csvValue = name === "author" ? card.author : name === "html_url" ? safeUrl(card.html_url) : card[name];
        const githubValue = name === "author" ? safeUser(metadata?.user) : name === "html_url" ? safeUrl(metadata?.[githubName]) : safeText(metadata?.[githubName]);
        const useGithub = metadataEndpoint?.status === AVAILABILITY.PRESENT && githubValue !== null;
        fields[name] = field(useGithub ? githubValue : csvValue, useGithub ? AVAILABILITY.PRESENT : csvValue == null ? AVAILABILITY.EMPTY : AVAILABILITY.PRESENT, useGithub ? githubProvenance(runId, snapshotChecksum, "metadata", "COMPLETE", metadataEndpoint?.captured_at, `/metadata/${githubName}`) : csvProvenance(`/${name}`));
        provenance[`/${name}`] = fields[name].provenance;
    }
    const csvDates = {created_at: card.created_at_source ?? card.dates?.created_at ?? null, closed_at: card.closed_at_source ?? card.dates?.closed_at ?? null, merged_at: card.merged_at_source ?? card.dates?.merged_at ?? null};
    const dates = {};
    for (const [name, githubName] of Object.entries(DATE_FIELDS)) {
        const githubValue = safeText(metadata?.[githubName]);
        const useGithub = metadataEndpoint?.status === AVAILABILITY.PRESENT && githubValue !== null;
        dates[name] = field(useGithub ? githubValue : csvDates[name], useGithub ? AVAILABILITY.PRESENT : csvDates[name] == null ? AVAILABILITY.EMPTY : AVAILABILITY.PRESENT, useGithub ? githubProvenance(runId, snapshotChecksum, "metadata", "COMPLETE", metadataEndpoint?.captured_at, `/metadata/${githubName}`) : csvProvenance(`/dates/${name}`));
        provenance[`/dates/${name}`] = dates[name].provenance;
    }
    const reviewItems = values(pages.reviews);
    const files = values(pages.files);
    const issueComments = values(pages.issueComments);
    const reviewComments = values(pages.reviewComments);
    const isCaptured = endpoint => endpoint?.status === AVAILABILITY.PRESENT || endpoint?.status === AVAILABILITY.EMPTY;
    const metricValues = {
        commit_count: metadata?.commits ?? (isCaptured(pages.commits) ? values(pages.commits).length : card.summary?.commits),
        changed_file_count: metadata?.changed_files ?? (isCaptured(pages.files) ? files.length : card.summary?.file_count),
        additions: metadata?.additions ?? (isCaptured(pages.files) && files.every(item => Number.isFinite(item.additions)) ? files.reduce((sum, item) => sum + item.additions, 0) : null),
        deletions: metadata?.deletions ?? (isCaptured(pages.files) && files.every(item => Number.isFinite(item.deletions)) ? files.reduce((sum, item) => sum + item.deletions, 0) : null),
        review_event_count: isCaptured(pages.reviews) ? reviewItems.length : card.summary?.reviews,
        changes_requested_review_count: isCaptured(pages.reviews) ? reviewItems.filter(item => item.state === "CHANGES_REQUESTED").length : card.summary?.changes_requested,
        issue_comment_count: metadata?.comments ?? (isCaptured(pages.issueComments) ? issueComments.length : card.summary?.comments),
        review_comment_count: isCaptured(pages.reviewComments) ? reviewComments.length : null,
    };
    metricValues.total_changes = Number.isFinite(metricValues.additions) && Number.isFinite(metricValues.deletions) ? metricValues.additions + metricValues.deletions : null;
    const metrics = {};
    for (const [name, definition] of Object.entries(METRICS)) {
        const value = metricValues[name] ?? null;
        const endpoint = pages[definition.endpoint];
        const complete = isCaptured(endpoint);
        const source = complete && (name === "total_changes" || name === "additions" || name === "deletions" || name === "changed_file_count" || name === "commit_count") ? derivedProvenance(runId, snapshotChecksum, definition.endpoint, endpoint.status, endpoint.captured_at, definition.pointer) : complete ? githubProvenance(runId, snapshotChecksum, definition.endpoint, endpoint.status, endpoint.captured_at, definition.pointer) : csvProvenance(`/metrics/${name}`);
        const endpointStatus = statusFor(endpoint, hasSnapshot);
        metrics[name] = field(value, value === null ? endpointStatus === AVAILABILITY.PRESENT ? AVAILABILITY.EMPTY : endpointStatus : endpointStatus === AVAILABILITY.EMPTY ? AVAILABILITY.EMPTY : complete || !enrichment ? AVAILABILITY.PRESENT : endpointStatus, source);
        provenance[`/metrics/${name}`] = source;
    }
    const evidence = {
        files: projectEvidenceItems(pages.files, "files", runId, snapshotChecksum, hasSnapshot),
        reviews: projectEvidenceItems(pages.reviews, "reviews", runId, snapshotChecksum, hasSnapshot),
        issue_comments: projectEvidenceItems(pages.issueComments, "issueComments", runId, snapshotChecksum, hasSnapshot),
        review_comments: projectEvidenceItems(pages.reviewComments, "reviewComments", runId, snapshotChecksum, hasSnapshot),
        timeline: projectEvidenceItems(pages.timeline, "timeline", runId, snapshotChecksum, hasSnapshot),
        supplementary_activity: projectEvidenceItems(pages.commits, "commits", runId, snapshotChecksum, hasSnapshot),
    };
    return {version: 2, identity: {source_card_id: card.source_card_id ?? card.id ?? null, repository: card.repository ?? null, pr_number: card.pr_number ?? null, ordinal: card.ordinal ?? null}, fields, dates, dataset_language: field(card.language ?? null, card.language == null ? AVAILABILITY.EMPTY : AVAILABILITY.PRESENT, csvProvenance("/language")), metrics, csv_evidence: card.evidence ? {body: card.body ?? null, summary: card.summary ?? null, selected: card.evidence.selected ?? null, all_text: card.evidence.all_text ?? null} : {}, github_evidence: evidence, availability: Object.fromEntries(SNAPSHOT_ENDPOINTS.map(name => [name, statusFor(pages[name], hasSnapshot)])), snapshot: {run_id: runId, snapshot_checksum: snapshotChecksum, captured_at: enrichment?.captured_at ?? null}, provenance};
};

const projectEnrichedCard = (card, enrichmentInput = null) => {
    if (!Object.hasOwn(card, "title")) return card;
    if (!enrichmentInput || typeof enrichmentInput !== "object") {
        const baselineProvenance = Object.fromEntries([
            ...Object.keys(OVERLAPPING_FIELDS).map(name => [`/${name}`, {source: "CSV", run_id: null, endpoint: null, status: "BASELINE"}]),
            ...Object.keys(DATE_FIELDS).map(name => [`/dates/${name}`, {source: "CSV", run_id: null, endpoint: null, status: "BASELINE"}]),
            ...["commits", "reviews", "comments", "changes_requested"].map(name => [`/summary/${name}`, {source: "CSV", run_id: null, endpoint: null, status: "BASELINE"}]),
        ]);
        return {...card, enrichment: {run_id: null, snapshot_checksum: null, completeness: {}, evidence: {github: {}}, provenance: baselineProvenance}};
    }
    const cardV2 = projectCardV2(card, enrichmentInput);
    const projected = {...card, card_v2: cardV2};
    projected.title = cardV2.fields.title.value;
    projected.body = cardV2.fields.body.value;
    projected.author = cardV2.fields.author.value;
    projected.state = cardV2.fields.state.value;
    projected.merged = cardV2.fields.merged.value;
    projected.html_url = cardV2.fields.html_url.value;
    projected.dates = Object.fromEntries(Object.entries(cardV2.dates).map(([name, value]) => [name, value.value]));
    projected.summary = {...(card.summary || {}), commits: cardV2.metrics.commit_count.value, reviews: cardV2.metrics.review_event_count.value, comments: cardV2.metrics.issue_comment_count.value, changes_requested: cardV2.metrics.changes_requested_review_count.value};
    const legacyEvidence = (Array.isArray(enrichmentInput.pages) ? enrichmentInput.pages : []).reduce((result, page) => {
        const name = page.endpoint || "unknown";
        const current = result[name] || {status: page.status || page.state || "COMPLETE_EMPTY", pages: []};
        current.status = page.status || page.state || current.status;
        current.pages.push(pagePayload(page));
        result[name] = current;
        return result;
    }, {});
    const legacyProvenance = Object.fromEntries(Object.entries(cardV2.provenance).map(([pointer, detail]) => [pointer, {source: detail.source, run_id: detail.run_id, endpoint: detail.endpoint, status: detail.status}]));
    projected.enrichment = {run_id: cardV2.snapshot.run_id, snapshot_checksum: cardV2.snapshot.snapshot_checksum, completeness: Object.fromEntries(Object.entries(legacyEvidence).map(([name, endpoint]) => [name, endpoint.status])), evidence: {github: legacyEvidence}, provenance: legacyProvenance};
    return projected;
};

export {AVAILABILITY, projectCardV2, projectEnrichedCard};
