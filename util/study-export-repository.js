import {StudyExportError} from "./study-export-format.js";

const DATA_ERROR = () => new StudyExportError(409);
const ELIGIBILITY_ERROR = () => new StudyExportError(403);

const withReadOnlyStudyExportTransaction = async (pool, operation) => {
    const client = await pool.connect();
    let transactionOpen = false;
    try {
        await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
        transactionOpen = true;
        const result = await operation(client);
        await client.query("COMMIT");
        transactionOpen = false;
        return result;
    } catch (error) {
        if (transactionOpen) await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
};

const assertContext = context => {
    if (!context || context.studyId === undefined || context.studyId === null
        || context.participantId === undefined || context.participantId === null) {
        throw ELIGIBILITY_ERROR();
    }
};

const assertStudyScope = (studyRows, context) => {
    if (studyRows.length !== 1 || studyRows[0].id !== context.studyId) throw ELIGIBILITY_ERROR();
    const study = studyRows[0];
    if (study.bootstrap_state !== "READY" || ![30, 300, 369].includes(study.expected_card_count)) throw DATA_ERROR();
    return study;
};

const assertParticipants = (participants, study, context) => {
    const configured = study.config?.participants;
    if (!Array.isArray(configured) || configured.length < 2 || configured.length !== participants.length) {
        throw DATA_ERROR();
    }
    const participantIds = new Set();
    for (const [ordinal, participant] of participants.entries()) {
        if (participant.participant_ordinal !== ordinal || participant.participant_key !== configured[ordinal]
            || participant.participant_id === null || participant.participant_id === undefined
            || participantIds.has(participant.participant_id)) {
            throw DATA_ERROR();
        }
        participantIds.add(participant.participant_id);
    }
    if (!participantIds.has(context.participantId)) throw ELIGIBILITY_ERROR();
};

const assertCards = (cards, study) => {
    if (cards.length !== study.expected_card_count) throw DATA_ERROR();
    const cardIds = new Set();
    const sourceCardIds = new Set();
    for (const [ordinal, card] of cards.entries()) {
        if (card.card_ordinal !== ordinal || typeof card.pr_card_id !== "string" || !card.pr_card_id
            || typeof card.source_card_id !== "string" || !card.source_card_id
            || cardIds.has(card.pr_card_id) || sourceCardIds.has(card.source_card_id)) {
            throw DATA_ERROR();
        }
        cardIds.add(card.pr_card_id);
        sourceCardIds.add(card.source_card_id);
    }
};

const keyFor = (participantId, cardOrdinal) => `${participantId}:${cardOrdinal}`;

const loadTerminalSummary = async (client, studyId, participants, cards) => {
    const {rows} = await client.query(
        `/* study-export:terminal-summary */
         WITH classification_summary AS (
             SELECT classification.study_id, classification.participant_id, classification.pr_card_id,
                    COUNT(*)::INTEGER AS classification_count,
                    COUNT(DISTINCT classification.category_id)::INTEGER AS category_reference_count,
                    COUNT(category.id)::INTEGER AS valid_category_count
             FROM pr_classification classification
             LEFT JOIN participant_category category
                 ON category.id = classification.category_id
                AND category.study_id = classification.study_id
                AND category.participant_id = classification.participant_id
             WHERE classification.study_id = $1
             GROUP BY classification.study_id, classification.participant_id, classification.pr_card_id
         ), discard_summary AS (
             SELECT discard.study_id, discard.participant_id, discard.pr_card_id,
                    COUNT(*)::INTEGER AS discard_count
             FROM pr_discard discard
             WHERE discard.study_id = $1
             GROUP BY discard.study_id, discard.participant_id, discard.pr_card_id
         )
         SELECT participant.reviewer_id AS participant_id,
                participant.ordinal AS participant_ordinal,
                card.ordinal AS card_ordinal,
                COALESCE(classification.classification_count, 0) AS classification_count,
                COALESCE(discard.discard_count, 0) AS discard_count,
                COALESCE(classification.category_reference_count, 0) AS category_reference_count,
                COALESCE(classification.valid_category_count, 0) AS valid_category_count
         FROM study_participant participant
         CROSS JOIN study_card card
         LEFT JOIN classification_summary classification
             ON classification.study_id = participant.study_id
            AND classification.participant_id = participant.reviewer_id
            AND classification.pr_card_id = card.pr_card_id
         LEFT JOIN discard_summary discard
             ON discard.study_id = participant.study_id
            AND discard.participant_id = participant.reviewer_id
            AND discard.pr_card_id = card.pr_card_id
         WHERE participant.study_id = $1 AND card.study_id = $1
         ORDER BY participant.ordinal, card.ordinal`,
        [studyId],
    );
    const expectedRows = participants.length * cards.length;
    if (rows.length !== expectedRows) throw DATA_ERROR();

    const summaries = new Map();
    for (const row of rows) {
        const key = keyFor(row.participant_id, row.card_ordinal);
        if (summaries.has(key)) throw DATA_ERROR();
        for (const field of ["classification_count", "discard_count", "category_reference_count", "valid_category_count"]) {
            if (!Number.isSafeInteger(row[field]) || row[field] < 0) throw DATA_ERROR();
        }
        if (row.classification_count > 1 || row.discard_count > 1
            || row.classification_count > 0 && row.discard_count > 0
            || row.category_reference_count > row.classification_count
            || row.valid_category_count > row.classification_count) {
            throw DATA_ERROR();
        }
        summaries.set(key, row);
    }

    const completeParticipants = participants.filter(participant => cards.every(card => {
        const summary = summaries.get(keyFor(participant.participant_id, card.card_ordinal));
        return summary && summary.classification_count + summary.discard_count === 1;
    }));
    return {summaries, completeParticipants};
};

const loadStudyExportGate = async (client, context) => {
    assertContext(context);
    const {rows: studyRows} = await client.query(
        `/* study-export:study */
         SELECT id, bootstrap_state, expected_card_count, config
         FROM study
         WHERE id = $1`,
        [context.studyId],
    );
    const study = assertStudyScope(studyRows, context);
    const {rows: participants} = await client.query(
        `/* study-export:participants */
         SELECT reviewer_id AS participant_id, participant_key, ordinal AS participant_ordinal
         FROM study_participant
         WHERE study_id = $1
         ORDER BY ordinal`,
        [study.id],
    );
    assertParticipants(participants, study, context);
    const {rows: cards} = await client.query(
        `/* study-export:cards */
         SELECT pr_card_id, source_card_id, ordinal AS card_ordinal
         FROM study_card
         WHERE study_id = $1
         ORDER BY ordinal`,
        [study.id],
    );
    assertCards(cards, study);
    const {summaries, completeParticipants} = await loadTerminalSummary(client, study.id, participants, cards);
    return {context, study, participants, cards, summaries, completeParticipants};
};

const validateIncludedCategories = gate => {
    for (const participant of gate.completeParticipants) {
        for (const card of gate.cards) {
            const summary = gate.summaries.get(keyFor(participant.participant_id, card.card_ordinal));
            if (summary.classification_count === 1
                && (summary.category_reference_count !== 1 || summary.valid_category_count !== 1)) {
                throw DATA_ERROR();
            }
        }
    }
};

const loadStudyExportRows = async (client, studyId, participants, cards) => {
    const {rows} = await client.query(
        `/* study-export:comparison-rows */
         WITH promoted_metadata AS (
             SELECT DISTINCT ON (page.run_id, page.pr_card_id)
                    page.run_id, page.pr_card_id,
                    page.normalized_payload ->> 'html_url' AS promoted_html_url
             FROM github_run_page page
             WHERE page.study_id = $1 AND page.endpoint = 'metadata'
               AND page.state IN ('COMPLETE', 'COMPLETE_EMPTY')
             ORDER BY page.run_id, page.pr_card_id, page.page_ordinal DESC
         )
         SELECT participant.reviewer_id AS participant_id,
                participant.ordinal AS participant_ordinal,
                card.ordinal AS card_ordinal,
                card.source_card_id,
                source_card.html_url AS source_html_url,
                metadata.promoted_html_url,
                CASE WHEN classification.id IS NOT NULL THEN 'CLASSIFIED'
                     WHEN discard.pr_card_id IS NOT NULL THEN 'DISCARDED'
                     ELSE 'PENDING' END AS decision,
                classification.category_id,
                category.id AS valid_category_id,
                category.raw_name AS category_name,
                category.definition AS category_definition,
                classification.remarks AS classification_remarks
         FROM study_participant participant
         INNER JOIN study_card card ON card.study_id = participant.study_id
         INNER JOIN pr_cards source_card ON source_card.id = card.pr_card_id
             AND source_card.source_card_id = card.source_card_id
         LEFT JOIN pr_classification classification
             ON classification.study_id = participant.study_id
            AND classification.pr_card_id = card.pr_card_id
            AND classification.participant_id = participant.reviewer_id
         LEFT JOIN participant_category category
             ON category.id = classification.category_id
            AND category.study_id = participant.study_id
            AND category.participant_id = participant.reviewer_id
         LEFT JOIN pr_discard discard
             ON discard.study_id = participant.study_id
            AND discard.pr_card_id = card.pr_card_id
            AND discard.participant_id = participant.reviewer_id
         LEFT JOIN study_enrichment_promotion promotion ON promotion.study_id = participant.study_id
         LEFT JOIN promoted_metadata metadata
             ON metadata.run_id = promotion.run_id AND metadata.pr_card_id = card.pr_card_id
         WHERE participant.study_id = $1 AND participant.reviewer_id = ANY($2::INTEGER[])
         ORDER BY participant.ordinal, card.ordinal`,
        [studyId, participants.map(participant => participant.participant_id)],
    );
    return validateComparisonRows(rows, participants, cards);
};

const nullableText = value => value === null || typeof value === "string";

const validateComparisonRows = (rows, participants, cards) => {
    if (rows.length !== participants.length * cards.length) throw DATA_ERROR();
    const participantById = new Map(participants.map(participant => [participant.participant_id, participant]));
    const cardByOrdinal = new Map(cards.map(card => [card.card_ordinal, card]));
    const rowByParticipantAndCard = new Map();
    const urlsByCard = new Map();

    for (const row of rows) {
        const participant = participantById.get(row.participant_id);
        const card = cardByOrdinal.get(row.card_ordinal);
        const key = keyFor(row.participant_id, row.card_ordinal);
        if (!participant || !card || rowByParticipantAndCard.has(key)
            || row.participant_ordinal !== participant.participant_ordinal
            || row.source_card_id !== card.source_card_id
            || !["CLASSIFIED", "DISCARDED"].includes(row.decision)
            || row.source_html_url !== null && typeof row.source_html_url !== "string"
            || row.promoted_html_url !== null && typeof row.promoted_html_url !== "string") {
            throw DATA_ERROR();
        }
        const effectiveUrl = row.promoted_html_url ?? row.source_html_url;
        const previousUrl = urlsByCard.get(row.card_ordinal);
        if (previousUrl !== undefined && previousUrl !== effectiveUrl) throw DATA_ERROR();
        urlsByCard.set(row.card_ordinal, effectiveUrl);

        if (row.decision === "CLASSIFIED") {
            if (typeof row.category_id !== "string" || row.valid_category_id !== row.category_id
                || typeof row.category_name !== "string"
                || !nullableText(row.category_definition)
                || !nullableText(row.classification_remarks)) {
                throw DATA_ERROR();
            }
        } else if (row.category_id !== null || row.valid_category_id !== null || row.category_name !== null
            || row.category_definition !== null || row.classification_remarks !== null) {
            throw DATA_ERROR();
        }
        rowByParticipantAndCard.set(key, row);
    }

    for (const participant of participants) {
        for (const card of cards) {
            if (!rowByParticipantAndCard.has(keyFor(participant.participant_id, card.card_ordinal))) throw DATA_ERROR();
        }
    }
    return rows;
};

export {
    loadStudyExportGate,
    loadStudyExportRows,
    validateComparisonRows,
    validateIncludedCategories,
    withReadOnlyStudyExportTransaction,
};
