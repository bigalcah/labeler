import {
    loadStudyExportGate,
    loadStudyExportRows,
    validateIncludedCategories,
    withReadOnlyStudyExportTransaction,
} from "./study-export-repository.js";
import {buildStudyComparisonCsv, StudyExportError} from "./study-export-format.js";

const requireComparisonGate = gate => {
    const requester = gate.completeParticipants.find(participant => participant.participant_id === gate.context.participantId);
    if (!requester || gate.completeParticipants.length < 2) throw new StudyExportError(403);
    return gate.completeParticipants;
};

const getStudyExportAvailability = async ({pool, context}) => withReadOnlyStudyExportTransaction(pool, async client => {
    const gate = await loadStudyExportGate(client, context);
    const requesterComplete = gate.completeParticipants.some(
        participant => participant.participant_id === context.participantId,
    );
    if (!requesterComplete) return {state: "incomplete"};
    if (gate.completeParticipants.length < 2) return {state: "waiting"};

    validateIncludedCategories(gate);
    return {
        state: "ready",
        includedParticipantCount: gate.completeParticipants.length,
        expectedCardCount: gate.study.expected_card_count,
    };
});

const createStudyComparisonExport = async ({pool, context}) => withReadOnlyStudyExportTransaction(pool, async client => {
    const gate = await loadStudyExportGate(client, context);
    const participants = requireComparisonGate(gate);
    validateIncludedCategories(gate);
    const rows = await loadStudyExportRows(client, gate.study.id, participants, gate.cards);
    return buildStudyComparisonCsv({cards: gate.cards, participants, rows});
});

export {StudyExportError, createStudyComparisonExport, getStudyExportAvailability};
