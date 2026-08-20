import pool from "../../util/pg-pool.js";

export const get = async (req, res) => {
    const { rows: [ participant ] } = req.query.participant
        ? await pool.query(
            "SELECT id, name FROM reviewer WHERE name = $1 LIMIT 1",
            [ req.query.participant ],
        )
        : { rows: [] };
    const { rows: reviewers } = await pool.query(
        `SELECT
            reviewer.id,
            reviewer.name,
            totals.total,
            COUNT(classification.id)::INTEGER AS completed,
            (totals.total - COUNT(classification.id))::INTEGER AS pending,
            ROUND(100.0 * COUNT(classification.id) / NULLIF(totals.total, 0), 1) AS percentage
         FROM reviewer
         CROSS JOIN (SELECT COUNT(*)::INTEGER AS total FROM pr_cards) totals
         LEFT JOIN pr_classification classification
             ON classification.participant_id = reviewer.id
         GROUP BY reviewer.id, reviewer.name, totals.total
         ORDER BY reviewer.id`,
    );
    const selectedProgress = participant
        ? reviewers.find(reviewer => reviewer.id === participant.id)
        : null;

    res.locals.participant = participant;
    res.render("progress", { reviewers, participant, selectedProgress });
};
