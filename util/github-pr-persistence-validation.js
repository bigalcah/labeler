import {buildRunManifest, checksumRunManifest} from "./github-pr-manifest.js";

const SUPPORTED_EXPECTED_CARD_COUNTS = new Set([30, 300]);

class GithubPersistenceError extends Error {
    constructor(code, message) {
        super(message);
        this.name = "GithubPersistenceError";
        this.code = code;
    }
}

const assertExactCards = (cards, expectedCount) => {
    if (!SUPPORTED_EXPECTED_CARD_COUNTS.has(expectedCount)) {
        throw new GithubPersistenceError("CARD_COUNT_UNSUPPORTED", "Study card count must equal 30 or 300");
    }
    const ordinals = cards.map(card => card.ordinal);
    if (cards.length !== expectedCount
        || new Set(cards.map(card => card.pr_card_id)).size !== expectedCount
        || ordinals.some((ordinal, index) => ordinal !== index)) {
        throw new GithubPersistenceError("CARD_MANIFEST_INCOMPLETE", `Study must contain exactly ${expectedCount} ordered cards`);
    }
};

const assertStudyMapping = (studyCards, runCards, expectedCount) => {
    assertExactCards(studyCards, expectedCount);
    if (studyCards.length !== runCards.length
        || studyCards.some((card, index) => card.pr_card_id !== runCards[index].pr_card_id || card.ordinal !== runCards[index].ordinal)) {
        throw new GithubPersistenceError("CARD_MANIFEST_MISMATCH", "Run mappings do not match study membership");
    }
};

const assertRunCards = (cards, expectedCount) => {
    assertExactCards(cards, expectedCount);
    const snapshots = cards.map(card => ({ordinal: card.ordinal, snapshotChecksum: card.snapshot_checksum}));
    return {
        manifest: buildRunManifest({snapshots}),
        manifestChecksum: checksumRunManifest({snapshots}),
    };
};

export {GithubPersistenceError, assertExactCards, assertRunCards, assertStudyMapping};
