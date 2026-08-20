import {createHash} from "node:crypto";

const normalizeJson = value => {
    if (Array.isArray(value)) return value.map(item => item === undefined ? null : normalizeJson(item));
    if (value && typeof value === "object") {
        return Object.fromEntries(Object.keys(value)
            .filter(key => value[key] !== undefined)
            .sort()
            .map(key => [ key, normalizeJson(value[key]) ]));
    }
    return value;
};

const canonicalCardContent = card => ({
    source_card_id: card.source_card_id,
    source_pr_id: card.source_pr_id?.toString() || null,
    repository: card.repository ?? null,
    pr_number: card.pr_number ?? null,
    title: card.title,
    body: card.body ?? null,
    author: card.author ?? null,
    language: card.language ?? null,
    state: card.state ?? null,
    merged: card.merged ?? null,
    html_url: card.html_url ?? null,
    created_at_source: card.dates?.created_at ?? card.created_at_source ?? null,
    closed_at_source: card.dates?.closed_at ?? card.closed_at_source ?? null,
    merged_at_source: card.dates?.merged_at ?? card.merged_at_source ?? null,
    summary: card.summary ?? {},
    evidence: card.evidence ?? {},
    raw_payload: card.raw_payload,
    source_type: card.source_type,
});

const computeCardChecksum = card => createHash("sha256")
    .update(JSON.stringify(normalizeJson(canonicalCardContent(card))))
    .digest("hex");

export {canonicalCardContent, computeCardChecksum};
