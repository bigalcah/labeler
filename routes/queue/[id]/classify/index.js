import HTTPStatus from "../../../../util/http-status.js";
import {withTransaction} from "../../../../util/transaction.js";
import {
    assertParticipantCategory,
    lockStudyCard,
    normalizeRemarks,
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
    const categoryId = req.body?.category_id;
    if (!isUuid(cardId) || !isUuid(categoryId)) {
        res.status(HTTPStatus.BAD_REQUEST).end();
        return;
    }

    let expectedRevision;
    try {
        expectedRevision = parseExpectedRevision(req.body?.expected_revision);
    } catch (error) {
        if (!respondWithStudyRuntimeError(res, error)) throw error;
        return;
    }

    try {
        const nextCardId = await withTransaction(pool, async client => {
            const lockedCard = await lockStudyCard(client, context.studyId, cardId);
            await assertParticipantCategory(client, context, categoryId);
            const state = await readLockedCardState(client, context.studyId, context.participantId, cardId);
            const currentRevision = state.classification_id ? Number(state.revision) : 0;
            if (state.discard_card_id) {
                throw new StudyRuntimeError(HTTPStatus.CONFLICT, "A discarded card cannot be classified");
            }
            if (expectedRevision !== currentRevision) {
                throw new StudyRuntimeError(HTTPStatus.CONFLICT, "The card revision is stale");
            }

            if (state.classification_id) {
                const {rowCount} = await client.query(
                    `UPDATE pr_classification
                     SET category_id = $3,
                         remarks = $4,
                         revision = revision + 1,
                         updated_at = NOW(),
                         study_id = $6,
                         enrichment_run_id = $7
                     WHERE pr_card_id = $1
                       AND participant_id = $2
                       AND study_id = $6
                       AND revision = $5`,
                    [ cardId, context.participantId, categoryId, normalizeRemarks(req.body?.remarks), expectedRevision, context.studyId, lockedCard.enrichment_run_id ],
                );
                if (rowCount !== 1) {
                    throw new StudyRuntimeError(HTTPStatus.CONFLICT, "The card revision is stale");
                }
            } else {
                await client.query(
                    `INSERT INTO pr_classification(
                        pr_card_id, participant_id, category_id, remarks, revision, study_id, enrichment_run_id
                    ) VALUES ($1, $2, $3, $4, 1, $5, $6)`,
                    [ cardId, context.participantId, categoryId, normalizeRemarks(req.body?.remarks), context.studyId, lockedCard.enrichment_run_id ],
                );
            }

            return findNextPendingCard(client, context.studyId, context.participantId, lockedCard.ordinal);
        });
        res.redirect(HTTPStatus.SEE_OTHER, continuationPath(nextCardId));
    } catch (error) {
        if (!respondWithStudyRuntimeError(res, error)) throw error;
    }
};

export {isUuid};
