const JSON_FIELDS = [
    "all_evidence_json",
    "pr_reviews_json",
    "pr_review_comments_json",
    "pr_comments_json",
];

const INTEGER_FIELDS = [
    "pr_id",
    "repo_id",
    "stars",
    "forks",
    "commit_count",
    "file_count",
    "total_changes",
    "review_count",
    "human_review_count",
    "bot_review_count",
    "approved_review_count",
    "changes_requested_review_count",
    "commented_review_count",
    "review_comment_count",
    "pr_comment_count",
    "timeline_event_count",
    "human_comment_count",
    "bot_comment_count",
    "textual_evidence_count",
    "non_pr_textual_evidence_count",
    "evidence_count",
];

const BOOLEAN_FIELDS = [ "merged", "needs_manual_context_check" ];

const NUMBER_FIELDS = [ "task_confidence", "time_to_close_hours", "time_to_merge_hours", "evidence_quality_score" ];

const toNullableInteger = value => {
    if (value === "" || value === undefined) return null;
    const parsed = Number.parseInt(value, 10);
    if (Number.isNaN(parsed)) throw new Error(`Expected integer, received: ${value}`);
    return parsed;
};

const toNullableNumber = value => {
    if (value === "" || value === undefined) return null;
    const parsed = Number(value);
    if (Number.isNaN(parsed)) throw new Error(`Expected number, received: ${value}`);
    return parsed;
};

const toNullableBoolean = value => {
    if (value === "" || value === undefined) return null;
    if ([ "true", "t", "1" ].includes(value.toLowerCase())) return true;
    if ([ "false", "f", "0" ].includes(value.toLowerCase())) return false;
    throw new Error(`Expected boolean, received: ${value}`);
};

const parseJsonField = (field, value) => {
    if (value === "" || value === undefined) return null;
    try {
        return JSON.parse(value);
    } catch (error) {
        throw new Error(`Invalid JSON in ${field}: ${error.message}`);
    }
};

const parsePullNumber = url => {
    if (!url) return null;
    const match = url.match(/\/pull\/(\d+)(?:[/?#]|$)/);
    return match ? Number.parseInt(match[1], 10) : null;
};

const convertRawRow = row => {
    const converted = { ...row };
    for (const field of INTEGER_FIELDS) converted[field] = toNullableInteger(row[field]);
    for (const field of NUMBER_FIELDS) converted[field] = toNullableNumber(row[field]);
    for (const field of BOOLEAN_FIELDS) converted[field] = toNullableBoolean(row[field]);
    for (const field of JSON_FIELDS) converted[field] = parseJsonField(field, row[field]);
    return converted;
};

const buildPullRequestCard = row => {
    const raw = convertRawRow(row);
    if (!raw.card_id) throw new Error("Missing card_id");
    if (!raw.html_url) throw new Error("Missing html_url");

    const prNumber = parsePullNumber(raw.html_url);
    if (!prNumber) throw new Error(`Cannot extract pull request number from ${raw.html_url}`);

    return {
        source_type: "CSV",
        source_card_id: raw.card_id,
        source_pr_id: raw.pr_id,
        repository: raw.repo_full_name || null,
        pr_number: prNumber,
        title: raw.pr_title || "Untitled pull request",
        body: raw.pr_body_text,
        author: raw.pr_author,
        language: raw.language,
        state: raw.pr_state,
        merged: raw.merged,
        html_url: raw.html_url,
        dates: {
            created_at: raw.created_at,
            closed_at: raw.closed_at,
            merged_at: raw.merged_at,
        },
        summary: {
            context: raw.context_summary,
            task_type: raw.task_type,
            complexity: raw.complexity_bin,
            commits: raw.commit_count,
            reviews: raw.review_count,
            comments: raw.pr_comment_count,
            changes_requested: raw.changes_requested_review_count,
        },
        evidence: {
            selected: raw.evidence_text,
            source: raw.evidence_source,
            path: raw.evidence_path,
            diff_hunk: raw.evidence_diff_hunk,
            all_text: raw.all_evidence_text,
            changes_requested: raw.changes_requested_text,
            review_comments: raw.review_comment_text,
            pull_request_comments: raw.pr_comment_text,
            timeline: raw.timeline_text,
            all: raw.all_evidence_json,
            reviews: raw.pr_reviews_json,
            review_comments_json: raw.pr_review_comments_json,
            comments: raw.pr_comments_json,
        },
        raw_payload: raw,
    };
};

export {buildPullRequestCard};
