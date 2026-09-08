import HTTPStatus from "../../../../../util/http-status.js";
import {withTransaction} from "../../../../../util/transaction.js";
import {
    lockStudyCard,
    normalizeDiscardReason,
    parseExpectedRevision,
    readLockedCardState,
} from "../../../../../util/study-mutation.js";
import {
    findNextPendingCard,
    isUuid,
    respondWithStudyRuntimeError,
    resolveStudyParticipant,
    StudyRuntimeError,
} from "../../../../../util/study-runtime.js";

const continuationPath = (participantName, cardId) => cardId
    ? `/${encodeURIComponent(participantName)}/queue/${encodeURIComponent(cardId)}`
    : `/${encodeURIComponent(participantName)}/queue`;

export const post = async (req, res) => {
    const pool = req.app.locals.dependencies.pool;
    const cardId = req.params.id;
    if (!isUuid(cardId)) {
        res.status(HTTPStatus.BAD_REQUEST).end();
        return;
    }

    let expectedRevision;
    let reason;
    try {
        expectedRevision = parseExpectedRevision(req.body?.expected_revision);
        reason = normalizeDiscardReason(req.body?.reason);
    } catch (error) {
        if (!respondWithStudyRuntimeError(res, error)) throw error;
        return;
    }

    try {
        const nextCardId = await withTransaction(pool, async client => {
            const {study, participant} = await resolveStudyParticipant(client, req.params.name);
            const lockedCard = await lockStudyCard(client, study.id, cardId);
            const state = await readLockedCardState(client, study.id, participant.id, cardId);
            const currentRevision = state.classification_id ? Number(state.revision) : 0;
            if (state.classification_id) {
                throw new StudyRuntimeError(HTTPStatus.CONFLICT, "A classified card cannot be discarded");
            }
            if (expectedRevision !== currentRevision) {
                throw new StudyRuntimeError(HTTPStatus.CONFLICT, "The card revision is stale");
            }
            if (state.discard_card_id) {
                if (state.discard_reason !== reason) {
                    throw new StudyRuntimeError(HTTPStatus.CONFLICT, "The discard reason does not match the saved replay");
                }
                return findNextPendingCard(client, study.id, participant.id, lockedCard.ordinal);
            }

            await client.query(
                `INSERT INTO pr_discard(pr_card_id, participant_id, reason, study_id, enrichment_run_id)
                 VALUES ($1, $2, $3, $4, $5)`,
                [ cardId, participant.id, reason, study.id, lockedCard.enrichment_run_id ],
            );
            return findNextPendingCard(client, study.id, participant.id, lockedCard.ordinal);
        });
        res.redirect(HTTPStatus.SEE_OTHER, continuationPath(req.params.name, nextCardId));
    } catch (error) {
        if (!respondWithStudyRuntimeError(res, error)) throw error;
    }
};
