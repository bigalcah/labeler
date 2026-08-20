export const get = (req, res) => {
    const query = new URLSearchParams({ status: "pending" });
    if (req.query.participant) query.set("participant", req.query.participant);
    res.redirect(`/instances?${query.toString()}`);
};
