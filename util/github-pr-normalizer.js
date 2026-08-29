import {GithubRequestError} from "./github-pr-errors.js";

const pick = (value, fields) => Object.fromEntries(fields
    .filter(field => value?.[field] !== undefined)
    .map(field => [field, value[field]]));

const normalizeUser = value => {
    if (!value || typeof value !== "object") return null;
    const login = typeof value.login === "string" ? value.login : null;
    const name = typeof value.name === "string" ? value.name : null;
    return login || name ? {login, name} : null;
};

const normalizeItem = (endpoint, value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const fields = {
        commits: ["sha", "message", "author", "committer", "html_url", "commit_url"],
        files: ["sha", "filename", "status", "additions", "deletions", "changes", "blob_url", "raw_url", "patch"],
        reviews: ["id", "user", "state", "body", "submitted_at", "commit_id", "html_url"],
        issueComments: ["id", "user", "body", "created_at", "updated_at", "html_url"],
        reviewComments: ["id", "user", "body", "path", "diff_hunk", "line", "original_line", "created_at", "updated_at", "html_url"],
        timeline: ["id", "event", "actor", "body", "created_at", "updated_at", "commit_id", "html_url"],
    }[endpoint];
    const normalized = fields ? pick(value, fields) : {};
    if (Object.hasOwn(normalized, "user")) normalized.user = normalizeUser(normalized.user);
    if (Object.hasOwn(normalized, "author")) normalized.author = normalizeUser(normalized.author);
    if (Object.hasOwn(normalized, "committer")) normalized.committer = normalizeUser(normalized.committer);
    if (Object.hasOwn(normalized, "actor")) normalized.actor = normalizeUser(normalized.actor);
    return normalized;
};

const normalizeResponse = (endpoint, value) => {
    if (endpoint === "diff") {
        if (typeof value !== "string") throw new GithubRequestError("MALFORMED_RESPONSE", "GitHub diff response shape is invalid", {endpoint});
        return value;
    }
    if (endpoint === "metadata") {
        if (!value || typeof value !== "object" || Array.isArray(value)) throw new GithubRequestError("MALFORMED_RESPONSE", "GitHub metadata response shape is invalid", {endpoint});
        const normalized = pick(value, ["id", "number", "title", "body", "state", "merged", "user", "html_url", "created_at", "updated_at", "closed_at", "merged_at", "additions", "deletions", "changed_files", "commits", "comments", "review_comments"]);
        if (Object.hasOwn(normalized, "user")) normalized.user = normalizeUser(normalized.user);
        return normalized;
    }
    if (!Array.isArray(value)) throw new GithubRequestError("MALFORMED_JSON", "GitHub response shape is invalid", {endpoint});
    return value.map(item => normalizeItem(endpoint, item));
};

export {normalizeResponse, normalizeUser};
