export const get = (req, res) => {
    const query = req.query.participant
        ? `?participant=${encodeURIComponent(req.query.participant)}`
        : "";
    res.redirect(`/instances/${encodeURIComponent(req.params.id)}${query}`);
};
