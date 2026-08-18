import pool from "../../../util/pg-pool.js";

export const get = async (req, res) => {
    const { rows: [ participant ] } = await pool.query(
        "SELECT * FROM reviewer WHERE name = $1 LIMIT 1",
        [ req.params.name ],
    );
    const { rows: categories } = participant
        ? await pool.query(
            "SELECT id, raw_name FROM participant_category WHERE participant_id = $1 ORDER BY raw_name",
            [ participant.id ],
        )
        : { rows: [] };
    const { rows: [ progress ] } = participant
        ? await pool.query(
            `SELECT COUNT(*)::INTEGER AS completed
             FROM pr_classification
             WHERE participant_id = $1`,
            [ participant.id ],
        )
        : { rows: [ { completed: 0 } ] };
    const { rows: [ card ] } = participant
        ? await pool.query(
            `SELECT pr_cards.*
             FROM pr_cards
             WHERE NOT EXISTS (
                 SELECT 1
                 FROM pr_classification
                 WHERE pr_classification.pr_card_id = pr_cards.id
                   AND pr_classification.participant_id = $1
             )
             ORDER BY pr_cards.source_card_id
             LIMIT 1`,
            [ participant.id ],
        )
        : { rows: [] };
    if (card) {
        card.dates = {
            created_at: card.created_at_source,
            closed_at: card.closed_at_source,
            merged_at: card.merged_at_source,
        };
    }
    res.render("review", {
        participant,
        categories,
        card,
        progress: progress || { completed: 0 },
        total: participant ? (await pool.query("SELECT COUNT(*)::INTEGER AS total FROM pr_cards")).rows[0].total : 0,
    });
};
