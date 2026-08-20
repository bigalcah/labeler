import pool from "../../util/pg-pool.js";

const toPositiveInteger = (value, fallback) => {
    const parsed = Number.parseInt(value, 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const getParticipant = async name => {
    if (!name) return null;
    const { rows: [ participant ] } = await pool.query(
        "SELECT id, name FROM reviewer WHERE name = $1 LIMIT 1",
        [ name ],
    );
    return participant || null;
};

export const get = async (req, res) => {
    const current = toPositiveInteger(req.query.page, 1);
    const limit = Math.min(toPositiveInteger(req.query.limit, 20), 100);
    const direction = Number(req.query.id) < 0 ? "DESC" : "ASC";
    const status = [ "pending", "classified" ].includes(req.query.status) ? req.query.status : "all";
    const participant = await getParticipant(req.query.participant);
    const participantId = participant?.id || null;
    const params = [ participantId ];
    const filters = [];

    if (status === "pending") {
        filters.push(participant
            ? "classification.id IS NULL"
            : "NOT EXISTS (SELECT 1 FROM pr_classification pending_classification WHERE pending_classification.pr_card_id = card.id)");
    }
    if (status === "classified") {
        filters.push(participant
            ? "classification.id IS NOT NULL"
            : "EXISTS (SELECT 1 FROM pr_classification classified_classification WHERE classified_classification.pr_card_id = card.id)");
    }

    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    const countQuery = `
        SELECT COUNT(*)::INTEGER AS items
        FROM pr_cards card
        LEFT JOIN pr_classification classification
            ON classification.pr_card_id = card.id
           AND classification.participant_id = $1
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
            CASE
                WHEN $1::INTEGER IS NULL THEN 'SELECT PARTICIPANT'
                WHEN classification.id IS NULL THEN 'PENDING'
                ELSE 'CLASSIFIED'
            END AS status,
            category.raw_name AS own_category
        FROM pr_cards card
        LEFT JOIN pr_classification classification
            ON classification.pr_card_id = card.id
           AND classification.participant_id = $1
        LEFT JOIN participant_category category
            ON category.id = classification.category_id
           AND category.participant_id = $1
        ${where}
        ORDER BY card.source_card_id ${direction}
        OFFSET $2 LIMIT $3`;
    const [
        { rows: [ { items } ] },
        { rows: cards },
    ] = await Promise.all([
        pool.query(countQuery, params),
        pool.query(dataQuery, [ participantId, (current - 1) * limit, limit ]),
    ]);

    const { rows: [ progress ] } = participant
        ? await pool.query(
            `SELECT
                COUNT(*)::INTEGER AS total,
                COUNT(classification.id)::INTEGER AS completed,
                (COUNT(*) - COUNT(classification.id))::INTEGER AS pending
             FROM pr_cards card
             LEFT JOIN pr_classification classification
                 ON classification.pr_card_id = card.id
                AND classification.participant_id = $1`,
            [ participant.id ],
        )
        : { rows: [ { total: items, completed: 0, pending: items } ] };

    res.locals.participant = participant;
    res.render("instances", {
        cards,
        participant,
        status,
        progress,
        pagination: {
            items,
            pages: Math.ceil(items / limit),
            current,
            limit,
            id: direction === "ASC" ? 1 : -1,
        },
    });
};
