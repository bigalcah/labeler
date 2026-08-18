import pool from "../../../../../util/pg-pool.js";

export const post = async (req, res) => {
    const { rows: [ participant ] } = await pool.query(
        "SELECT id FROM reviewer WHERE name = $1 LIMIT 1",
        [ req.params.name ],
    );
    if (!participant) {
        res.status(404).end();
        return;
    }

    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const { rows: [ category ] } = await client.query(
            `SELECT id
             FROM participant_category
             WHERE id = $1 AND participant_id = $2`,
            [ req.body.category_id, participant.id ],
        );
        if (!category) {
            await client.query("ROLLBACK");
            res.status(400).end();
            return;
        }

        await client.query(
            `INSERT INTO pr_classification(pr_card_id, participant_id, category_id, remarks)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (pr_card_id, participant_id) DO UPDATE SET
                 category_id = EXCLUDED.category_id,
                 remarks = EXCLUDED.remarks,
                 updated_at = NOW()`,
            [ req.params.id, participant.id, category.id, req.body.remarks || null ],
        );
        await client.query("COMMIT");
        res.redirect(`/${encodeURIComponent(req.params.name)}/queue`);
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
};
