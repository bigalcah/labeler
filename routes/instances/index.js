import {loadStudyProgress, resolveReadyStudy, resolveStudyParticipant, respondWithStudyRuntimeError} from "../../util/study-runtime.js";

const toPositiveInteger = (value, fallback) => {
    const parsed = Number.parseInt(value, 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const allowedStatuses = new Set([ "all", "pending", "classified", "discarded" ]);

const emptyPagination = {items: 0, pages: 0, current: 1, limit: 20, id: 1};

export const get = async (req, res) => {
    const pool = req.app.locals.dependencies.pool;
    const current = toPositiveInteger(req.query.page, 1);
    const limit = Math.min(toPositiveInteger(req.query.limit, 20), 100);
    const direction = Number(req.query.id) < 0 ? "DESC" : "ASC";
    const status = allowedStatuses.has(req.query.status) ? req.query.status : "all";

    try {
        if (!req.query.participant) {
            await resolveReadyStudy(pool);
            res.render("instances", {
                cards: [],
                participant: null,
                status,
                progress: {total: 0, classified: 0, discarded: 0, pending: 0, completed: 0},
                pagination: emptyPagination,
            });
            return;
        }

        const {study, participant} = await resolveStudyParticipant(pool, req.query.participant);
        const params = [ study.id, participant.id ];
        const filters = [ "study_card.study_id = $1" ];
        if (status === "pending") filters.push("classification.pr_card_id IS NULL", "discard.pr_card_id IS NULL");
        if (status === "classified") filters.push("classification.pr_card_id IS NOT NULL");
        if (status === "discarded") filters.push("discard.pr_card_id IS NOT NULL");
        const where = `WHERE ${filters.join(" AND ")}`;
        const countQuery = `
            SELECT COUNT(*)::INTEGER AS items
            FROM pr_cards card
            INNER JOIN study_card ON card.id = study_card.pr_card_id
            LEFT JOIN pr_classification classification
                ON classification.pr_card_id = study_card.pr_card_id
               AND classification.study_id = study_card.study_id
               AND classification.participant_id = $2
            LEFT JOIN pr_discard discard
                ON discard.pr_card_id = study_card.pr_card_id
               AND discard.study_id = study_card.study_id
               AND discard.participant_id = $2
            ${where}`;
        const dataQuery = `
            SELECT
                card.id,
                card.source_card_id,
                card.repository,
                card.pr_number,
                card.title,
                card.state,
                card.merged,
                card.language,
                card.html_url,
                study_card.ordinal,
                CASE
                    WHEN classification.pr_card_id IS NOT NULL THEN 'CLASSIFIED'
                    WHEN discard.pr_card_id IS NOT NULL THEN 'DISCARDED'
                    ELSE 'PENDING'
                END AS status,
                category.raw_name AS own_category,
                discard.reason AS discard_reason
            FROM pr_cards card
            INNER JOIN study_card ON card.id = study_card.pr_card_id
            LEFT JOIN pr_classification classification
                ON classification.pr_card_id = study_card.pr_card_id
               AND classification.study_id = study_card.study_id
               AND classification.participant_id = $2
            LEFT JOIN pr_discard discard
                ON discard.pr_card_id = study_card.pr_card_id
               AND discard.study_id = study_card.study_id
               AND discard.participant_id = $2
            LEFT JOIN participant_category category
                ON category.id = classification.category_id
               AND category.participant_id = $2
            ${where}
            ORDER BY study_card.ordinal ${direction}
            OFFSET $3 LIMIT $4`;
        const [
            {rows: [ {items} ]},
            {rows: cards},
        ] = await Promise.all([
            pool.query(countQuery, params),
            pool.query(dataQuery, [ ...params, (current - 1) * limit, limit ]),
        ]);
        const progress = await loadStudyProgress(pool, study.id, participant.id);

        res.locals.participant = participant;
        res.locals.status = status;
        res.render("instances", {
            cards,
            participant,
            status,
            progress: {...progress, completed: progress.classified + progress.discarded},
            pagination: {
                items,
                pages: Math.ceil(items / limit),
                current,
                limit,
                id: direction === "ASC" ? 1 : -1,
            },
        });
    } catch (error) {
        if (!respondWithStudyRuntimeError(res, error)) throw error;
    }
};
