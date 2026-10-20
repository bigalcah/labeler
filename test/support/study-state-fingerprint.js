import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import path from "node:path";

const fingerprintPersistentStudy = async ({pool, studyKey, artifactPaths}) => {
    const {rows: [row]} = await pool.query(
        `SELECT jsonb_build_object(
            'study', (SELECT to_jsonb(study) FROM study WHERE id = target.id),
            'migrations', (SELECT COALESCE(jsonb_agg(to_jsonb(migration) ORDER BY migration.migration_id), '[]'::jsonb)
                           FROM labeler_migration migration),
            'reviewers', (SELECT COALESCE(jsonb_agg(to_jsonb(reviewer) ORDER BY reviewer.id), '[]'::jsonb)
                          FROM reviewer JOIN study_participant member ON member.reviewer_id = reviewer.id WHERE member.study_id = target.id),
            'participants', (SELECT COALESCE(jsonb_agg(to_jsonb(member) ORDER BY member.ordinal), '[]'::jsonb)
                             FROM study_participant member WHERE member.study_id = target.id),
            'accounts', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                                'id', account.id, 'study_id', account.study_id, 'reviewer_id', account.reviewer_id,
                                'normalized_username', account.normalized_username, 'password_hash', account.password_hash,
                                'enabled', account.enabled, 'credential_version', account.credential_version,
                                'created_at', account.created_at, 'updated_at', account.updated_at
                            ) ORDER BY account.reviewer_id), '[]'::jsonb)
                         FROM participant_account account WHERE account.study_id = target.id),
            'memberships', (SELECT COALESCE(jsonb_agg(to_jsonb(member) ORDER BY member.ordinal), '[]'::jsonb)
                            FROM study_card member WHERE member.study_id = target.id),
            'cards', (SELECT COALESCE(jsonb_agg(to_jsonb(card) ORDER BY card.source_card_id), '[]'::jsonb)
                      FROM pr_cards card JOIN study_card member ON member.pr_card_id = card.id WHERE member.study_id = target.id),
            'snapshots', (SELECT COALESCE(jsonb_agg(to_jsonb(snapshot) ORDER BY snapshot.pr_card_id, snapshot.id), '[]'::jsonb)
                          FROM github_card_snapshot snapshot JOIN study_card member ON member.pr_card_id = snapshot.pr_card_id WHERE member.study_id = target.id),
            'runs', (SELECT COALESCE(jsonb_agg(to_jsonb(run) ORDER BY run.id), '[]'::jsonb)
                     FROM github_enrichment_run run WHERE run.study_id = target.id),
            'runPages', (SELECT COALESCE(jsonb_agg(to_jsonb(page) ORDER BY page.run_id, page.pr_card_id, page.endpoint, page.page_ordinal), '[]'::jsonb)
                         FROM github_run_page page WHERE page.study_id = target.id),
            'runCards', (SELECT COALESCE(jsonb_agg(to_jsonb(mapping) ORDER BY mapping.run_id, mapping.pr_card_id), '[]'::jsonb)
                         FROM github_enrichment_run_card mapping WHERE mapping.study_id = target.id),
            'promotions', (SELECT COALESCE(jsonb_agg(to_jsonb(promotion) ORDER BY promotion.study_id), '[]'::jsonb)
                           FROM study_enrichment_promotion promotion WHERE promotion.study_id = target.id),
            'categories', (SELECT COALESCE(jsonb_agg(to_jsonb(category) ORDER BY category.participant_id, category.id), '[]'::jsonb)
                           FROM participant_category category WHERE category.study_id = target.id),
            'classifications', (SELECT COALESCE(jsonb_agg(to_jsonb(classification) ORDER BY classification.pr_card_id, classification.participant_id), '[]'::jsonb)
                                FROM pr_classification classification WHERE classification.study_id = target.id),
            'discards', (SELECT COALESCE(jsonb_agg(to_jsonb(discard) ORDER BY discard.pr_card_id, discard.participant_id), '[]'::jsonb)
                         FROM pr_discard discard WHERE discard.study_id = target.id),
            'telemetry', (SELECT COALESCE(jsonb_agg(to_jsonb(event) ORDER BY event.recorded_at, event.event_id), '[]'::jsonb)
                          FROM github_api_telemetry_event event WHERE event.study_id = target.id)
        )::text AS state
        FROM study target WHERE target.study_key = $1`,
        [studyKey],
    );
    if (!row?.state) throw new Error(`Persistent state for ${studyKey} is unavailable`);
    const artifacts = artifactPaths.map(filePath => ({
        file: path.basename(filePath),
        sha256: createHash("sha256").update(readFileSync(filePath)).digest("hex"),
    }));
    return createHash("sha256").update(JSON.stringify({state: JSON.parse(row.state), artifacts})).digest("hex");
};

export {fingerprintPersistentStudy};
