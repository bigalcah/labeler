const ERROR_MESSAGES = Object.freeze({
    403: "Comparison export is not available.",
    409: "We couldn't prepare the export.",
});

class StudyExportError extends Error {
    constructor(status) {
        const message = ERROR_MESSAGES[status];
        if (!message) throw new TypeError("StudyExportError status must be 403 or 409");
        super(message);
        this.name = "StudyExportError";
        this.status = status;
    }
}

const formulaPrefix = /^[ ]*(?:[=+\-@]|\t|\r|\n)/;

const csvText = value => {
    if (value === null || value === undefined) return "";
    const text = String(value);
    return formulaPrefix.test(text) ? `'${text}` : text;
};

const csvCell = value => {
    const text = csvText(value);
    return /[",\r\n]/.test(text) ? `"${text.replaceAll("\"", "\"\"")}"` : text;
};

const participantHeaders = participants => participants.flatMap(participant => {
    const ordinal = participant.participant_ordinal + 1;
    return [
        `categoria_usuario_${ordinal}`,
        `descripcion_categoria_usuario_${ordinal}`,
        `comentario_clasificacion_usuario_${ordinal}`,
    ];
});

const buildStudyComparisonCsv = ({cards, participants, rows}) => {
    const headers = ["pr_id", "pr_url", ...participantHeaders(participants)];
    const rowByParticipantAndCard = new Map(rows.map(row => [
        `${row.participant_id}:${row.card_ordinal}`,
        row,
    ]));
    const csvRows = cards.map(card => {
        const firstParticipantRow = rowByParticipantAndCard.get(`${participants[0].participant_id}:${card.card_ordinal}`);
        const row = [card.source_card_id, firstParticipantRow.promoted_html_url ?? firstParticipantRow.source_html_url];
        for (const participant of participants) {
            const decision = rowByParticipantAndCard.get(`${participant.participant_id}:${card.card_ordinal}`);
            if (decision.decision === "DISCARDED") {
                row.push("DESCARTADO", "", "");
            } else {
                row.push(decision.category_name, decision.category_definition, decision.classification_remarks);
            }
        }
        return row;
    });
    const records = [headers, ...csvRows];
    return Buffer.from(`${records.map(record => record.map(csvCell).join(",")).join("\r\n")}\r\n`, "utf8");
};

export {StudyExportError, buildStudyComparisonCsv};
