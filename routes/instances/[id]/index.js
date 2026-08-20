import pool from "../../../util/pg-pool.js";
import HTTPStatus from "../../../util/http-status.js";

export const get = async (req, res) => {
    const { rows: [ participant ] } = req.query.participant
        ? await pool.query(
            "SELECT id, name FROM reviewer WHERE name = $1 LIMIT 1",
            [ req.query.participant ],
        )
        : { rows: [] };
    const { rows: [ card ] } = await pool.query(
        `SELECT card.*, classification.category_id, classification.remarks,
                classification.classified_at, category.raw_name AS own_category
         FROM pr_cards card
         LEFT JOIN pr_classification classification
             ON classification.pr_card_id = card.id
            AND classification.participant_id = $2
         LEFT JOIN participant_category category
             ON category.id = classification.category_id
            AND category.participant_id = $2
         WHERE card.id = $1`,
        [ req.params.id, participant?.id || null ],
    );
    if (!card) {
        res.status(HTTPStatus.NOT_FOUND).render("error", {
            icon: "bi-none",
            title: "PR card does not exist!",
        });
        return;
    }

    card.dates = {
        created_at: card.created_at_source,
        closed_at: card.closed_at_source,
        merged_at: card.merged_at_source,
    };
    res.locals.participant = participant;
    res.render("instance", {
        instance: card,
        participant,
    });
};
