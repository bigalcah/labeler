import {isDeepStrictEqual} from "node:util";
import {canonicalCardContent, computeCardChecksum} from "./pr-card-checksum.js";
import {verifyCopilot369ExistingCards} from "./copilot-369-persistence.js";
import {isValidPasswordHash} from "./credential-policy.js";
import {assertNormalStudyConfig, parseStudyConfig, resolveAuthoritativeStudyConfig, StudyConfigError} from "./study-config.js";

class StudyExistingValidationError extends Error {
    constructor(message) {
        super(message);
        this.name = "StudyExistingValidationError";
    }
}

const withReadOnlyTransaction = async (pool, operation) => {
    const client = await pool.connect();
    try {
        await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
        const result = await operation(client);
        await client.query("COMMIT");
        return result;
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
};

const assertExistingStudy = (study, config, sourceChecksum) => {
    if (config.expectedCardCount === 369 && study.expected_card_count === 300) {
        throw new StudyExistingValidationError(
            "Existing 300-card primary requires the dedicated cutover; ordinary preparation cannot modify it.",
        );
    }
    if (study.expected_card_count !== config.expectedCardCount
        || study.source_checksum !== sourceChecksum
        || study.bootstrap_state !== "READY") {
        throw new StudyExistingValidationError("Existing study profile conflicts with the approved source or cardinality.");
    }
    try {
        resolveAuthoritativeStudyConfig(config, study.config);
    } catch (error) {
        if (!(error instanceof StudyConfigError)) throw error;
        throw new StudyExistingValidationError("Existing study profile conflicts with the approved configuration.");
    }
};

const assertParticipants = async (client, studyId, config) => {
    const {rows} = await client.query(
        `SELECT participant.participant_key, participant.ordinal, reviewer.name AS reviewer_name,
                account.normalized_username, account.password_hash, account.enabled, account.credential_version
         FROM study_participant participant
         LEFT JOIN reviewer ON reviewer.id = participant.reviewer_id
         LEFT JOIN participant_account account
             ON account.study_id = participant.study_id AND account.reviewer_id = participant.reviewer_id
         WHERE participant.study_id = $1
         ORDER BY participant.ordinal`,
        [studyId],
    );
    if (rows.length !== config.participants.length || rows.some((row, ordinal) => {
        const participantKey = config.participants[ordinal];
        return row.participant_key !== participantKey
            || row.ordinal !== ordinal
            || row.reviewer_name !== participantKey
            || row.normalized_username !== config.loginUsernames[participantKey]
            || !isValidPasswordHash(row.password_hash)
            || row.enabled !== true
            || !Number.isInteger(row.credential_version)
            || row.credential_version < 1;
    })) {
        throw new StudyExistingValidationError("Existing study participant or account membership is invalid.");
    }
};

const assertStudyCards = async (client, studyId, {config, cards, sourceChecksum}) => {
    let verifiedCards;
    if (config.expectedCardCount === 369) {
        verifiedCards = await verifyCopilot369ExistingCards(client, cards, sourceChecksum);
        if (verifiedCards.length !== config.expectedCardCount) {
            throw new StudyExistingValidationError("Existing primary card set is incomplete.");
        }
    }

    const {rows} = await client.query(
        `SELECT membership.pr_card_id, membership.source_card_id, membership.ordinal,
                membership.source_checksum AS membership_checksum, card.*
         FROM study_card membership
         INNER JOIN pr_cards card ON card.id = membership.pr_card_id
         WHERE membership.study_id = $1
         ORDER BY membership.ordinal`,
        [studyId],
    );
    if (rows.length !== cards.length) throw new StudyExistingValidationError("Existing study card membership is incomplete.");

    for (const [ordinal, card] of cards.entries()) {
        const row = rows[ordinal];
        const expectedChecksum = computeCardChecksum(card);
        if (row.ordinal !== ordinal
            || row.source_card_id !== card.source_card_id
            || row.content_checksum !== expectedChecksum
            || row.membership_checksum !== expectedChecksum
            || (verifiedCards && (row.pr_card_id !== verifiedCards[ordinal].id
                || row.source_card_id !== verifiedCards[ordinal].source_card_id))
            || (!verifiedCards && (row.source_type !== "CSV"
                || !isDeepStrictEqual(canonicalCardContent(row), canonicalCardContent(card))))) {
            throw new StudyExistingValidationError("Existing study card content or ordered membership differs from its protected CSV.");
        }
    }
};

const verifyExistingStudyClient = async (client, input) => {
    const config = assertNormalStudyConfig(parseStudyConfig(input.config));
    const {rows} = await client.query(
        `SELECT id, study_key, config, source_checksum, expected_card_count, bootstrap_state,
                    created_at, updated_at
             FROM study
             WHERE study_key = $1`,
        [config.studyKey],
    );
    const [study] = rows;
    if (!study) return null;
    if (study.study_key !== config.studyKey) {
        throw new StudyExistingValidationError("Existing study key differs from the approved profile.");
    }
    assertExistingStudy(study, config, input.sourceChecksum);
    await assertParticipants(client, study.id, config);
    await assertStudyCards(client, study.id, input);
    return {...study, created: false};
};

const verifyExistingStudy = (pool, input) => withReadOnlyTransaction(pool, client => verifyExistingStudyClient(client, input));

export {StudyExistingValidationError, verifyExistingStudy, verifyExistingStudyClient, withReadOnlyTransaction};
