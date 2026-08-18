import pool from "../../../util/pg-pool.js";
import HTTPStatus from "../../../util/http-status.js";

const normalize = value => value.trim().toLowerCase().replace(/\s+/g, " ");

export const post = async (req, res) => {
    const { rows: [ participant ] } = await pool.query(
        "SELECT id FROM reviewer WHERE name = $1 LIMIT 1",
        [ req.params.name ],
    );
    const rawName = typeof req.body.name === "string" ? req.body.name.trim() : "";
    if (!participant || !rawName) {
        res.status(HTTPStatus.BAD_REQUEST).end();
        return;
    }

    try {
        const { rows: [ category ] } = await pool.query(
            `INSERT INTO participant_category(participant_id, raw_name, normalized_name)
             VALUES ($1, $2, $3)
             RETURNING id, raw_name`,
            [ participant.id, rawName, normalize(rawName) ],
        );
        res.status(HTTPStatus.CREATED).json(category);
    } catch (error) {
        if (error.code === "23505") {
            res.status(HTTPStatus.CONFLICT).end();
            return;
        }
        throw error;
    }
};
