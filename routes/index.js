import {sessionParticipant} from "../util/study-runtime.js";

export const get = async (req, res) => {
    const participant = req.sessionContext ? sessionParticipant(req.sessionContext) : null;
    res.locals.participant = participant;
    res.render("index", {participant});
};
