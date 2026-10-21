const COPILOT_369_CSV_HEADERS = Object.freeze([
    "pr_id|agent|pr_url|merged_at|variant_a_status|english_eligible|variant_b_status|temporal_status|selection_status_before_window|raw_observable_status_before_window",
    "evidence_exclusion_cause|acquisition_status|technical_pending_before_window|included_before_window|within_analysis_window|eligibility_status|reason|classification_status|sampling_design|sampling_role",
    "sampling_stratum|sampling_rank|sampling_population_size|sampling_target_size|sampling_inclusion_probability|sampling_weight|sampling_seed|number|title|body",
    "user_id|user|state|created_at|closed_at|repo_id|repo_url|html_url|repository_url|repository_license|repository_full_name|repository_is_forked",
    "repository_language|repository_forks|repository_stars|commit_count|commit_sha_set_sha256|first_human_feedback_at|eligible_feedback_json|post_interaction_commits_json|post_interaction_commit_count|manual_classification_status",
    "qualifying_feedback_count|github_post_feedback_pre_merge_commit_count|github_post_feedback_pre_merge_temporal_status|github_feedback_temporal_evidence_available|commits_json|commits_listed_count|commits_with_message_count|commits_sha_set_sha256|commits_match_expected_count|commits_match_expected_sha_set",
    "commits_coverage_status|commits_evidence_basis|aidev_commits_listed_count|aidev_commits_sha_set_sha256|commits_match_aidev_expected_count|commits_match_aidev_expected_sha_set|github_full_commit_count|github_full_commit_sha_set_sha256|github_full_committed_dates_available|github_aidev_sha_subset",
    "github_full_commit_evidence_verified|pr_comments_json|inline_comments_json|reviews_json|feedback_pre_merge_events_json|feedback_evidence_status|feedback_summary_consistency_status|post_feedback_pre_merge_commits_json|post_feedback_pre_merge_commits_listed_count|post_feedback_pre_merge_commits_status",
    "pre_merge_timeline_json|pre_merge_timeline_status|code_change_evidence_status",
].flatMap(headerLine => headerLine.split("|")));

const JSON_SCHEMAS = Object.freeze({
    eligible_feedback_json: {actor: "string", body: "nullable_string", event_at: "timestamp", event_key: "string", source_table: "string", source_url: "string"},
    post_interaction_commits_json: {commit_sha: "string", commit_message: "nullable_string", committed_at: "timestamp"},
    commits_json: {sha: "string", message: "nullable_string", author: "nullable_string", committed_at: "timestamp"},
    pr_comments_json: {id: "string", user: "string", body: "string", created_at: "timestamp", event_at: "timestamp", event_key: "string", event_type: "string", source_table: "string", source_url: "string", user_type: "string"},
    inline_comments_json: {id: "string", user: "string", body: "string", created_at: "timestamp", event_at: "timestamp", event_key: "string", event_type: "string", path: "string", source_table: "string", source_url: "string", user_type: "string"},
    reviews_json: {id: "string", user: "string", state: "string", body: "nullable_string", submitted_at: "timestamp", event_at: "timestamp", event_key: "string", event_type: "string", source_table: "string", source_url: "string", user_type: "string"},
    feedback_pre_merge_events_json: {id: "string", event_at: "timestamp", event_key: "string", event_type: "string", source_url: "string", temporal_relation: "string"},
    post_feedback_pre_merge_commits_json: {sha: "string", committed_at: "timestamp", message: "nullable_string", author: "nullable_string"},
});

const CONVERSATION_FIELDS = Object.freeze({
    reviews_json: "reviews",
    pr_comments_json: "comments",
    inline_comments_json: "review_comments",
});

const isRecord = value => value !== null && typeof value === "object" && !Array.isArray(value);
const isTimestamp = value => {
    if (typeof value !== "string") return false;
    const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|([+-])(\d{2}):(\d{2}))$/.exec(value) || [];
    const year = Number(parts[1]), month = Number(parts[2]), day = Number(parts[3]);
    const daysInMonth = [31, year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
    return parts[7] !== undefined && daysInMonth !== undefined && month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth
        && Number(parts[4]) <= 23 && Number(parts[5]) <= 59 && Number(parts[6]) <= 59
        && (parts[7] === "Z" || Number(parts[9]) <= 23 && Number(parts[10]) <= 59) && Number.isFinite(Date.parse(value));
};

const addError = (errors, {code, rowNumber, row, field, message, itemIndex = null}) => {
    errors.push({
        code,
        row_number: rowNumber,
        pr_id: typeof row?.pr_id === "string" ? row.pr_id : null,
        field,
        item_index: itemIndex,
        message,
    });
};

const addOmission = (omissions, {field, reason, prId}) => {
    const key = `${field}\u0000${reason}`;
    let omission = omissions.get(key);
    if (!omission) {
        omission = {field, reason, count: 0, pr_ids: []};
        omissions.set(key, omission);
    }
    omission.count++;
    omission.pr_ids.push(prId);
};

const validateSchemaField = (item, name, type) => {
    if (!Object.hasOwn(item, name)) return `Missing required property ${name}`;
    const value = item[name];
    if (type === "nullable_string" && (value === null || typeof value === "string")) return null;
    if (type === "timestamp" && isTimestamp(value)) return null;
    if (type === "string" && typeof value === "string") return null;
    return `Invalid ${name}: expected ${type}`;
};

const validateJsonItem = (field, item, {rowNumber, row, errors, itemIndex}) => {
    if (!isRecord(item)) {
        addError(errors, {rowNumber, row, code: "JSON_ITEM_SCHEMA_INVALID", field, message: "Expected each JSON array item to be an object", itemIndex});
        return;
    }
    if (field === "pre_merge_timeline_json") {
        const commitRecord = typeof item.sha === "string";
        const interactionRecord = typeof item.event_key === "string";
        if (commitRecord === interactionRecord) {
            addError(errors, {rowNumber, row, code: "JSON_ITEM_SCHEMA_INVALID", field, message: "Expected exactly one timeline item discriminator: sha or event_key", itemIndex});
            return;
        }
        const schema = commitRecord
            ? {sha: "string", committed_at: "timestamp", timestamp_semantics: "string", url: "string"}
            : {id: "string", event_at: "timestamp", event_key: "string", event_type: "string", source_url: "string", temporal_relation: "string"};
        for (const [name, type] of Object.entries(schema)) {
            const issue = validateSchemaField(item, name, type);
            if (issue) addError(errors, {rowNumber, row, code: "JSON_ITEM_SCHEMA_INVALID", field, message: issue, itemIndex});
        }
        return;
    }
    for (const [name, type] of Object.entries(JSON_SCHEMAS[field])) {
        const issue = validateSchemaField(item, name, type);
        if (issue) addError(errors, {rowNumber, row, code: "JSON_ITEM_SCHEMA_INVALID", field, message: issue, itemIndex});
    }
};

const parseJsonColumns = (row, {rowNumber, errors, omissions}) => {
    const parsed = {};
    for (const field of Object.keys(JSON_SCHEMAS).concat("pre_merge_timeline_json")) {
        const source = row[field];
        if (source === undefined || source === "") {
            addOmission(omissions, {field, reason: "empty_json_cell", prId: row.pr_id ?? null});
            continue;
        }
        let value;
        try {
            value = JSON.parse(source);
        } catch (error) {
            addError(errors, {rowNumber, row, code: "JSON_MALFORMED", field, message: error.message});
            continue;
        }
        if (!Array.isArray(value)) {
            addError(errors, {rowNumber, row, code: "JSON_SCHEMA_INVALID", field, message: "Expected a JSON array"});
            continue;
        }
        value.forEach((item, itemIndex) => validateJsonItem(field, item, {rowNumber, row, errors, itemIndex}));
        parsed[field] = value;
    }
    return parsed;
};

const parseTimestamp = (row, field, {rowNumber, errors, omissions, required = false}) => {
    const value = row[field];
    if (value === undefined || value === "") {
        if (required) addError(errors, {rowNumber, row, code: "REQUIRED_FIELD_MISSING", field, message: `Missing required timestamp ${field}`});
        else addOmission(omissions, {field, reason: "empty_source_cell", prId: row.pr_id ?? null});
        return undefined;
    }
    if (!isTimestamp(value)) {
        addError(errors, {rowNumber, row, code: "TIMESTAMP_INVALID", field, message: `Invalid ISO timestamp: ${value}`});
        return undefined;
    }
    return value;
};

const validatePullRequestUrls = (row, rowNumber, errors) => {
    const htmlUrl = /^https:\/\/github\.com\/([^/]+\/[^/]+)\/pull\/([1-9]\d*)$/.exec(row.html_url);
    const apiUrl = `https://api.github.com/repos/${row.repository_full_name}`;
    if (!htmlUrl || htmlUrl[1] !== row.repository_full_name || row.pr_url !== row.html_url) {
        addError(errors, {rowNumber, row, code: "URL_IDENTITY_MISMATCH", field: "html_url", message: "pr_url and html_url must identify the declared repository and number"});
    }
    if (htmlUrl && htmlUrl[2] !== row.number) {
        addError(errors, {rowNumber, row, code: "URL_NUMBER_MISMATCH", field: "number", message: "The URL pull number does not match number"});
    }
    if (row.repo_url !== apiUrl || row.repository_url !== apiUrl) {
        addError(errors, {rowNumber, row, code: "REPOSITORY_URL_MISMATCH", field: "repository_url", message: "repo_url and repository_url must identify repository_full_name"});
    }
};

const normalizeCopilot369Rows = (rows, {sourceChecksum = null, provenance = {}} = {}) => {
    const cards = [];
    const errors = [];
    const omissions = new Map();
    const seenIds = new Set();

    rows.forEach((row, index) => {
        const rowNumber = index + 2;
        const prId = row.pr_id;
        const json = parseJsonColumns(row, {rowNumber, errors, omissions});
        if (typeof prId !== "string" || !/^[1-9]\d*$/.test(prId)) {
            addError(errors, {rowNumber, row, code: "PR_ID_INVALID", field: "pr_id", message: "Expected a positive decimal string identity"});
        } else if (seenIds.has(prId)) {
            addError(errors, {rowNumber, row, code: "PR_ID_DUPLICATE", field: "pr_id", message: `Duplicate pr_id ${prId}`});
        } else {
            seenIds.add(prId);
        }
        if (row.agent !== "Copilot") addError(errors, {rowNumber, row, code: "AGENT_MISMATCH", field: "agent", message: "Expected Copilot source rows"});
        if (typeof row.repository_full_name !== "string" || !/^[^/\s]+\/[^/\s]+$/.test(row.repository_full_name)) {
            addError(errors, {rowNumber, row, code: "REPOSITORY_INVALID", field: "repository_full_name", message: "Expected owner/repository"});
        }
        let prNumber;
        if (row.number === undefined || row.number === "") {
            addError(errors, {rowNumber, row, code: "REQUIRED_FIELD_MISSING", field: "number", message: "Missing required integer number"});
        } else if (typeof row.number !== "string" || !/^[1-9]\d*$/.test(row.number)) {
            addError(errors, {rowNumber, row, code: "INTEGER_INVALID", field: "number", message: `Expected a positive decimal integer: ${row.number}`});
        } else if (!Number.isSafeInteger(Number(row.number))) {
            addError(errors, {rowNumber, row, code: "INTEGER_OUT_OF_RANGE", field: "number", message: `Integer exceeds the safe numeric range: ${row.number}`});
        } else {
            prNumber = Number(row.number);
            validatePullRequestUrls(row, rowNumber, errors);
        }
        if (typeof row.title !== "string" || row.title === "") addError(errors, {rowNumber, row, code: "REQUIRED_FIELD_MISSING", field: "title", message: "Missing required pull request title"});
        if (!["open", "closed"].includes(row.state)) addError(errors, {rowNumber, row, code: "STATE_INVALID", field: "state", message: `Unsupported pull request state: ${row.state}`});

        const timestampContext = {rowNumber, errors, omissions};
        const createdAt = parseTimestamp(row, "created_at", {...timestampContext, required: true});
        const closedAt = parseTimestamp(row, "closed_at", timestampContext);
        const mergedAt = parseTimestamp(row, "merged_at", timestampContext);
        if (row.state === "open" && (closedAt !== undefined || mergedAt !== undefined)) {
            addError(errors, {rowNumber, row, code: "STATE_TIMESTAMP_MISMATCH", field: "state", message: "An open pull request cannot have closed_at or merged_at"});
        }
        if (mergedAt !== undefined && row.state !== "closed") {
            addError(errors, {rowNumber, row, code: "STATE_TIMESTAMP_MISMATCH", field: "merged_at", message: "A merged pull request must have closed state"});
        }
        if (createdAt && closedAt && Date.parse(closedAt) < Date.parse(createdAt)) {
            addError(errors, {rowNumber, row, code: "TIMESTAMP_ORDER_INVALID", field: "closed_at", message: "closed_at precedes created_at"});
        }
        if (createdAt && mergedAt && Date.parse(mergedAt) < Date.parse(createdAt)) {
            addError(errors, {rowNumber, row, code: "TIMESTAMP_ORDER_INVALID", field: "merged_at", message: "merged_at precedes created_at"});
        }

        const language = row.repository_language;
        if (language === undefined || language === "") addOmission(omissions, {field: "repository_language", reason: "empty_source_cell", prId: prId ?? null});
        if (typeof row.body !== "string" || row.body === "") addOmission(omissions, {field: "body", reason: "empty_source_cell", prId: prId ?? null});
        if (typeof row.user !== "string" || row.user === "") addOmission(omissions, {field: "author", reason: "empty_source_cell", prId: prId ?? null});
        if (row.commit_count === undefined || row.commit_count === "") {
            addOmission(omissions, {field: "summary.commits", reason: "empty_source_cell", prId: prId ?? null});
        } else if (!/^(0|[1-9]\d*)$/.test(row.commit_count) || !Number.isSafeInteger(Number(row.commit_count))) {
            addError(errors, {rowNumber, row, code: "INTEGER_INVALID", field: "commit_count", message: `Expected a non-negative safe integer: ${row.commit_count}`});
        }
        addOmission(omissions, {field: "evidence_text", reason: "column_absent_from_source", prId: prId ?? null});

        if (errors.some(error => error.row_number === rowNumber)) return;
        const dates = {created_at: createdAt};
        if (closedAt !== undefined) dates.closed_at = closedAt;
        if (mergedAt !== undefined) dates.merged_at = mergedAt;
        const evidence = {source: "CSV"};
        for (const [sourceField, targetField] of Object.entries(CONVERSATION_FIELDS)) {
            if (Object.hasOwn(json, sourceField)) {
                evidence[targetField] = json[sourceField].map(item => typeof item.user === "string" ? {...item, author: item.user} : {...item});
            }
        }
        const card = {
            source_type: "CSV",
            source_checksum: sourceChecksum,
            source_card_id: prId,
            source_pr_id: prId,
            repository: row.repository_full_name,
            pr_number: prNumber,
            title: row.title,
            state: row.state,
            html_url: row.html_url,
            dates,
            evidence,
            raw_payload: {...row},
        };
        if (typeof row.body === "string" && row.body !== "") card.body = row.body;
        if (typeof row.user === "string" && row.user !== "") card.author = row.user;
        if (typeof language === "string" && language !== "") card.language = language;
        if (mergedAt !== undefined) card.merged = true;
        else if (row.state === "open") card.merged = false;
        else addOmission(omissions, {field: "merged", reason: "closed_state_without_merged_at", prId});
        if (row.commit_count !== undefined && row.commit_count !== "") card.summary = {commits: Number(row.commit_count)};
        cards.push(card);
    });

    const omissionsReport = [...omissions.values()];
    return {
        cards: errors.length === 0 ? cards : [],
        errors,
        report: {
            source_type: "CSV",
            source_checksum: sourceChecksum,
            provenance,
            omissions: omissionsReport,
        },
    };
};

export {COPILOT_369_CSV_HEADERS, normalizeCopilot369Rows};
