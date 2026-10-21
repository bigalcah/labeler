import {COPILOT_369_SOURCE_CHECKSUM} from "./copilot-369-source.js";
import {validateCredentialManifest} from "./credential-manifest.js";
import {assertNormalStudyConfig, parseStudyConfig} from "./study-config.js";
import {assertBootstrapCards, assertStudySchemaReady, bootstrapStudy} from "./study-bootstrap.js";
import {verifyExistingStudy, withReadOnlyTransaction} from "./study-existing-validation.js";

const VALIDATION_30_SOURCE_CHECKSUM = "1607cfe84cb687a2cc7b4c56d3e0abf106b1a1044810d7390663ef1d691b63ab";
const PROFILE_SOURCE_CHECKSUMS = Object.freeze({
    "pr-card-sorting-local": COPILOT_369_SOURCE_CHECKSUM,
    "pr-card-sorting-validation-30": VALIDATION_30_SOURCE_CHECKSUM,
});
const ORDERED_PROFILE_KEYS = Object.freeze(["pr-card-sorting-local", "pr-card-sorting-validation-30"]);

class StudyPreparationError extends Error {
    constructor(message) {
        super(message);
        this.name = "StudyPreparationError";
    }
}

const validateProfile = ({bootstrapInput}, expectedStudyKey) => {
    const config = assertNormalStudyConfig(parseStudyConfig(bootstrapInput.config));
    if (config.studyKey !== expectedStudyKey
        || bootstrapInput.sourceChecksum !== PROFILE_SOURCE_CHECKSUMS[expectedStudyKey]
        || bootstrapInput.cards.length !== config.expectedCardCount
        || (expectedStudyKey === "pr-card-sorting-local") !== (bootstrapInput.report !== null)) {
        throw new StudyPreparationError("Study profile input differs from the approved ordered 369+30 source bundle.");
    }
    assertBootstrapCards(bootstrapInput.cards, config.expectedCardCount);
    validateCredentialManifest(bootstrapInput.credentialManifest, config);
};

const assertApprovedProfiles = profiles => {
    if (!Array.isArray(profiles) || profiles.length !== ORDERED_PROFILE_KEYS.length) {
        throw new StudyPreparationError("Ordinary creation requires the ordered 369+30 profile bundle.");
    }
    profiles.forEach((profile, index) => validateProfile(profile, ORDERED_PROFILE_KEYS[index]));
};

const assertFreshStudyDatabase = pool => withReadOnlyTransaction(pool, async client => {
    const {rows: [state]} = await client.query(
        `SELECT EXISTS (SELECT 1 FROM study) AS has_studies,
                EXISTS (SELECT 1 FROM reviewer) AS has_reviewers,
                EXISTS (SELECT 1 FROM pr_cards) AS has_cards`,
    );
    if (state.has_studies || state.has_reviewers || state.has_cards) {
        throw new StudyPreparationError("New 369+30 creation requires an isolated empty study database.");
    }
});

const prepareStudyProfiles = async ({pool, profiles, bootstrap = bootstrapStudy}) => {
    assertApprovedProfiles(profiles);
    await assertStudySchemaReady(pool);
    const existing = await Promise.all(profiles.map(profile => verifyExistingStudy(pool, profile.bootstrapInput)));
    if (existing.every(Boolean)) return existing;
    if (existing.some(Boolean)) {
        throw new StudyPreparationError("Only a complete existing 369+30 pair is read-only; partial profiles require an explicit recovery decision.");
    }
    await assertFreshStudyDatabase(pool);

    const prepared = [];
    for (const profile of profiles) {
        prepared.push(await bootstrap({pool, ...profile.bootstrapInput}));
    }
    return prepared;
};

const prepareStudyProfile = async ({pool, bootstrapInput}) => {
    const config = assertNormalStudyConfig(parseStudyConfig(bootstrapInput.config));
    if (bootstrapInput.sourceChecksum !== PROFILE_SOURCE_CHECKSUMS[config.studyKey]) {
        throw new StudyPreparationError("Single-profile input differs from its approved canonical source.");
    }
    assertBootstrapCards(bootstrapInput.cards, config.expectedCardCount);
    await assertStudySchemaReady(pool);
    const existing = await verifyExistingStudy(pool, bootstrapInput);
    if (!existing) {
        throw new StudyPreparationError("Single-profile creation is disabled; use the approved 369+30 profile coordinator.");
    }
    return existing;
};

export {StudyPreparationError, assertApprovedProfiles, prepareStudyProfile, prepareStudyProfiles};
