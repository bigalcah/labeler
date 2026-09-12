import {readFile} from "node:fs/promises";

const EXPECTED_CARD_COUNT = 300;
const SUPPORTED_EXPECTED_CARD_COUNTS = Object.freeze([30, 300]);
const DEFAULT_STUDY_CONFIG = Object.freeze({
    studyKey: "pr-card-sorting-local",
    expectedCardCount: EXPECTED_CARD_COUNT,
    participants: Object.freeze([ "javier", "diego", "pablo" ]),
    loginUsernames: Object.freeze({javier: "javier", diego: "diego", pablo: "pablo"}),
});
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const LOGIN_USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/;

class StudyConfigError extends Error {
    constructor(message) {
        super(message);
        this.name = "StudyConfigError";
    }
}

const validateIdentifier = (value, field) => {
    if (typeof value !== "string" || !IDENTIFIER_PATTERN.test(value)) {
        throw new StudyConfigError(`${field} must be a non-empty identifier using letters, numbers, dot, underscore, or hyphen`);
    }
    return value;
};

const parseLoginUsernames = (value, participants) => {
    if (value === undefined) {
        return Object.fromEntries(participants.map(participantKey => [participantKey, participantKey]));
    }
    if (!value || typeof value !== "object" || Array.isArray(value)
        || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...participants].sort())) {
        throw new StudyConfigError("loginUsernames must contain exactly one entry for each participant");
    }
    const loginUsernames = Object.fromEntries(participants.map(participantKey => {
        const loginUsername = value[participantKey];
        if (typeof loginUsername !== "string" || !LOGIN_USERNAME_PATTERN.test(loginUsername)) {
            throw new StudyConfigError(`loginUsernames.${participantKey} must be a normalized lowercase identifier`);
        }
        return [participantKey, loginUsername];
    }));
    if (new Set(Object.values(loginUsernames)).size !== participants.length) {
        throw new StudyConfigError("loginUsernames must contain unique identifiers");
    }
    return loginUsernames;
};

const parseStudyConfig = value => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new StudyConfigError("Study configuration must be a JSON object");
    }
    const studyKey = validateIdentifier(value.studyKey, "studyKey");
    if (!SUPPORTED_EXPECTED_CARD_COUNTS.includes(value.expectedCardCount)) {
        throw new StudyConfigError("expectedCardCount must equal 30 or 300");
    }
    if (!Array.isArray(value.participants) || value.participants.length === 0) {
        throw new StudyConfigError("participants must be a non-empty array");
    }
    const participants = value.participants.map((participant, index) =>
        validateIdentifier(participant, `participants[${index}]`));
    if (new Set(participants).size !== participants.length) {
        throw new StudyConfigError("participants must contain unique identifiers");
    }
    const loginUsernames = parseLoginUsernames(value.loginUsernames, participants);
    return {studyKey, expectedCardCount: value.expectedCardCount, participants, loginUsernames};
};

const readStudyConfig = async input => {
    if (input === undefined || input === null) return parseStudyConfig(DEFAULT_STUDY_CONFIG);
    if (typeof input !== "string" || input.trim() === "") {
        throw new StudyConfigError("Study configuration input must be inline JSON or a JSON file path");
    }
    const trimmed = input.trim();
    const json = trimmed.startsWith("{")
        ? trimmed
        : await readFile(trimmed, "utf8");
    try {
        return parseStudyConfig(JSON.parse(json));
    } catch (error) {
        if (error instanceof StudyConfigError) throw error;
        throw new StudyConfigError(`Invalid study configuration JSON: ${error.message}`);
    }
};

const resolveAuthoritativeStudyConfig = (requested, persisted) => {
    const requestedConfig = parseStudyConfig(requested);
    if (!persisted) return requestedConfig;
    const persistedConfig = parseStudyConfig(persisted);
    if (JSON.stringify(requestedConfig) !== JSON.stringify(persistedConfig)) {
        throw new StudyConfigError(`Configuration drift for studyKey ${persistedConfig.studyKey}`);
    }
    return persistedConfig;
};

export {
    DEFAULT_STUDY_CONFIG,
    EXPECTED_CARD_COUNT,
    StudyConfigError,
    parseStudyConfig,
    readStudyConfig,
    resolveAuthoritativeStudyConfig,
};
