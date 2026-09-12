import {mkdir, rename, rm, stat, writeFile} from "node:fs/promises";
import path from "node:path";
import {randomUUID} from "node:crypto";
import {buildStudyExportPackage, StudyExportError} from "./study-export-format.js";

const assertDestinationAvailable = async destination => {
    try {
        await stat(destination);
        throw new StudyExportError("Export destination must not exist");
    } catch (error) {
        if (error instanceof StudyExportError) throw error;
        if (error.code !== "ENOENT") throw error;
    }
    if (!(await stat(path.dirname(destination))).isDirectory()) {
        throw new StudyExportError("Export destination parent is not a directory");
    }
};

const loadStudy = async (client, studyKey) => {
    const {rows} = await client.query(
        `SELECT id, study_key, config, source_checksum, expected_card_count, bootstrap_state
         FROM study
         WHERE study_key = $1`,
        [studyKey],
    );
    if (rows.length !== 1 || rows[0].bootstrap_state !== "READY") {
        throw new StudyExportError("Export requires one READY study for the explicit study_key");
    }
    if (![30, 300].includes(rows[0].expected_card_count)) {
        throw new StudyExportError("Export study expected_card_count must equal 30 or 300");
    }
    return rows[0];
};

const loadParticipants = async (client, study) => {
    const {rows} = await client.query(
        `SELECT reviewer_id, participant_key, ordinal AS participant_ordinal
         FROM study_participant
         WHERE study_id = $1
         ORDER BY ordinal`,
        [study.id],
    );
    const configured = study.config?.participants;
    if (!Array.isArray(configured) || configured.length !== rows.length
        || rows.some((row, ordinal) => row.participant_ordinal !== ordinal || row.participant_key !== configured[ordinal])) {
        throw new StudyExportError("Persisted study participants do not match the configured participant order");
    }
    return rows;
};

const loadCategories = async (client, studyId) => {
    const {rows} = await client.query(
        `SELECT participant.participant_key, participant.ordinal AS participant_ordinal,
                (ROW_NUMBER() OVER (PARTITION BY category.participant_id
                    ORDER BY category.created_at, category.id) - 1)::INTEGER AS category_ordinal,
                category.raw_name AS category_name, category.created_at, category.updated_at
         FROM participant_category category
         INNER JOIN study_participant participant
             ON participant.study_id = category.study_id AND participant.reviewer_id = category.participant_id
         WHERE category.study_id = $1
         ORDER BY participant.ordinal, category.created_at, category.id`,
        [studyId],
    );
    return rows;
};

const loadResults = async (client, studyId) => {
    const {rows} = await client.query(
        `WITH categories AS (
             SELECT id, study_id, participant_id, raw_name,
                    (ROW_NUMBER() OVER (PARTITION BY participant_id ORDER BY created_at, id) - 1)::INTEGER AS ordinal
             FROM participant_category WHERE study_id = $1
         ), metadata AS (
             SELECT DISTINCT ON (page.run_id, page.pr_card_id) page.run_id, page.pr_card_id,
                    page.normalized_payload ->> 'html_url' AS html_url
             FROM github_run_page page
             WHERE page.study_id = $1 AND page.endpoint = 'metadata'
               AND page.state IN ('COMPLETE', 'COMPLETE_EMPTY')
             ORDER BY page.run_id, page.pr_card_id, page.page_ordinal DESC
         )
         SELECT participant.participant_key, participant.ordinal AS participant_ordinal,
                study_card.ordinal AS card_ordinal, study_card.source_card_id,
                CASE WHEN classification.id IS NOT NULL THEN 'CLASSIFIED'
                     WHEN discard.pr_card_id IS NOT NULL THEN 'DISCARDED' ELSE 'PENDING' END AS decision,
                category.ordinal AS category_ordinal, category.raw_name AS category_name,
                classification.remarks AS classification_remarks, discard.reason AS discard_reason,
                COALESCE(classification.classified_at, discard.discarded_at) AS decision_timestamp,
                classification.updated_at AS decision_updated_at,
                COALESCE(classification.revision, CASE WHEN discard.pr_card_id IS NOT NULL THEN 1 END) AS decision_revision,
                card.html_url AS source_html_url, COALESCE(metadata.html_url, card.html_url) AS resolved_html_url,
                CASE WHEN metadata.html_url IS NOT NULL THEN 'GITHUB' ELSE card.source_type END AS url_provenance,
                card.source_type, study_card.source_checksum AS card_source_checksum, card.content_checksum,
                promotion.run_id AS enrichment_run_id, run_card.snapshot_checksum AS enrichment_snapshot_checksum
         FROM study_card
         CROSS JOIN study_participant participant
         INNER JOIN pr_cards card ON card.id = study_card.pr_card_id
         LEFT JOIN pr_classification classification ON classification.study_id = study_card.study_id
             AND classification.pr_card_id = study_card.pr_card_id AND classification.participant_id = participant.reviewer_id
         LEFT JOIN pr_discard discard ON discard.study_id = study_card.study_id
             AND discard.pr_card_id = study_card.pr_card_id AND discard.participant_id = participant.reviewer_id
         LEFT JOIN categories category ON category.id = classification.category_id
             AND category.study_id = study_card.study_id AND category.participant_id = participant.reviewer_id
         LEFT JOIN study_enrichment_promotion promotion ON promotion.study_id = study_card.study_id
         LEFT JOIN github_enrichment_run_card run_card ON run_card.run_id = promotion.run_id
             AND run_card.study_id = study_card.study_id AND run_card.pr_card_id = study_card.pr_card_id
         LEFT JOIN metadata ON metadata.run_id = promotion.run_id AND metadata.pr_card_id = study_card.pr_card_id
         WHERE study_card.study_id = $1 AND participant.study_id = $1
         ORDER BY participant.ordinal, study_card.ordinal`,
        [studyId],
    );
    return rows;
};

const loadEnrichment = async (client, studyId) => {
    const {rows} = await client.query(
        `SELECT promotion.run_id, promotion.source_checksum, promotion.promoted_at, run.state,
                run.manifest_checksum, run.normalizer_version,
                COUNT(run_card.pr_card_id)::INTEGER AS coverage_count,
                encode(digest(COALESCE(string_agg(run_card.snapshot_checksum, '' ORDER BY run_card.ordinal), ''), 'sha256'), 'hex')
                    AS snapshot_checksums_sha256
         FROM study_enrichment_promotion promotion
         INNER JOIN github_enrichment_run run ON run.id = promotion.run_id AND run.study_id = promotion.study_id
         INNER JOIN github_enrichment_run_card run_card ON run_card.run_id = promotion.run_id AND run_card.study_id = promotion.study_id
         WHERE promotion.study_id = $1
         GROUP BY promotion.run_id, promotion.source_checksum, promotion.promoted_at,
                  run.state, run.manifest_checksum, run.normalizer_version`,
        [studyId],
    );
    if (rows.length > 1) throw new StudyExportError("Study has ambiguous enrichment provenance");
    return rows[0] || null;
};

const assertComplete = (study, participants, results, enrichment) => {
    const expectedRows = study.expected_card_count * participants.length;
    if (results.length !== expectedRows || results.some(row => !["CLASSIFIED", "DISCARDED"].includes(row.decision))) {
        throw new StudyExportError("Every configured participant and study card requires one terminal decision");
    }
    if (results.some(row => row.decision === "CLASSIFIED" && (row.category_ordinal === null || !row.category_name))) {
        throw new StudyExportError("Every classified result requires its persisted category");
    }
    if (enrichment && (enrichment.state !== "COMPLETED" || enrichment.source_checksum !== study.source_checksum
        || enrichment.coverage_count !== study.expected_card_count)) {
        throw new StudyExportError("Promoted enrichment evidence is incomplete or does not match the study");
    }
};

const publishPackage = async (destination, packageData) => {
    const temporary = `${destination}.partial-${process.pid}-${randomUUID()}`;
    try {
        await mkdir(temporary, {mode: 0o700});
        await Promise.all([
            writeFile(path.join(temporary, "results.csv"), packageData.resultsCsv, {flag: "wx", mode: 0o600}),
            writeFile(path.join(temporary, "categories.csv"), packageData.categoriesCsv, {flag: "wx", mode: 0o600}),
            writeFile(path.join(temporary, "manifest.json"), packageData.manifestJson, {flag: "wx", mode: 0o600}),
        ]);
        await rename(temporary, destination);
    } catch (error) {
        if (error.code === "EEXIST" || error.code === "ENOTEMPTY") {
            throw new StudyExportError("Export destination must not exist");
        }
        throw error;
    } finally {
        await rm(temporary, {recursive: true, force: true});
    }
};

const createStudyExport = async ({pool, studyKey, destination, hmacSecret}) => {
    await assertDestinationAvailable(destination);
    const client = await pool.connect();
    let transactionOpen = false;
    try {
        await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
        transactionOpen = true;
        const study = await loadStudy(client, studyKey);
        const participants = await loadParticipants(client, study);
        const [categories, results, enrichment] = await Promise.all([
            loadCategories(client, study.id), loadResults(client, study.id), loadEnrichment(client, study.id),
        ]);
        assertComplete(study, participants, results, enrichment);
        const packageData = buildStudyExportPackage({study, participants, categories, results, enrichment, hmacSecret});
        await client.query("COMMIT");
        transactionOpen = false;
        await publishPackage(destination, packageData);
        return packageData.manifest;
    } catch (error) {
        if (transactionOpen) await client.query("ROLLBACK");
        throw error instanceof StudyExportError ? error : new StudyExportError(`Study export failed: ${error.message}`);
    } finally {
        client.release();
    }
};

export {createStudyExport};
