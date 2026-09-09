import HTTPStatus from "../../../../util/http-status.js";
import {withTransaction} from "../../../../util/transaction.js";
import {
    lockStudyCard,
    normalizeDiscardReason,
    parseExpectedRevision,
    readLockedCardState,
} from "../../../../util/study-mutation.js";
import {
    findNextPendingCard,
    isUuid,
    requireStudySession,
    respondWithStudyRuntimeError,
    StudyRuntimeError,
} from "../../../../util/study-runtime.js";

const continuationPath = cardId => cardId
    ? `/queue/${encodeURIComponent(cardId)}`
    : "/queue";

export const post = async (req, res) => {
    const context = requireStudySession(req, res);
    if (!context) return;

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
            const lockedCard = await lockStudyCard(client, context.studyId, cardId);
            const state = await readLockedCardState(client, context.studyId, context.participantId, cardId);
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
                return findNextPendingCard(client, context.studyId, context.participantId, lockedCard.ordinal);
            }

            await client.query(
                `INSERT INTO pr_discard(pr_card_id, participant_id, reason, study_id, enrichment_run_id)
                 VALUES ($1, $2, $3, $4, $5)`,
                [ cardId, context.participantId, reason, context.studyId, lockedCard.enrichment_run_id ],
            );
            return findNextPendingCard(client, context.studyId, context.participantId, lockedCard.ordinal);
        });
        res.redirect(HTTPStatus.SEE_OTHER, continuationPath(nextCardId));
    } catch (error) {
        if (!respondWithStudyRuntimeError(res, error)) throw error;
    }
};
