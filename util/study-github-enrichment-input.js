const SUPPORTED_CARD_COUNTS = new Set([30, 300]);

const loadPersistedStudy = async (pool, studyKey) => {
    const {rows: [study]} = await pool.query(
        `SELECT id, study_key, source_checksum, expected_card_count, bootstrap_state
         FROM study
         WHERE study_key = $1`,
        [studyKey],
    );
    if (!study || study.bootstrap_state !== "READY") {
        throw new Error(`Study ${studyKey} is not ready for GitHub enrichment`);
    }
    if (!SUPPORTED_CARD_COUNTS.has(study.expected_card_count)) {
        throw new Error("Persisted study card count must equal 30 or 300");
    }
    return study;
};

const loadPersistedMembership = async (pool, studyId) => {
    const {rows} = await pool.query(
        `SELECT study_card.pr_card_id, study_card.source_card_id, study_card.ordinal,
                pr_cards.repository, pr_cards.pr_number
         FROM study_card
         INNER JOIN pr_cards ON pr_cards.id = study_card.pr_card_id
         WHERE study_card.study_id = $1
         ORDER BY study_card.ordinal`,
        [studyId],
    );
    return rows;
};

const assertSourceMatchesStudy = ({study, requestedStudy, cards, sourceChecksum, membership}) => {
    if (requestedStudy.expectedCardCount !== study.expected_card_count) {
        throw new Error("Requested card count does not match the persisted study");
    }
    if (sourceChecksum !== study.source_checksum) {
        throw new Error("CSV source checksum does not match the persisted study");
    }
    if (cards.length !== study.expected_card_count || membership.length !== study.expected_card_count) {
        throw new Error("CSV and persisted membership must have the exact persisted card count");
    }
    const membershipMatches = membership.every((entry, ordinal) => entry.ordinal === ordinal
        && entry.source_card_id === cards[ordinal].source_card_id);
    if (!membershipMatches) {
        throw new Error("CSV ordered membership does not match the persisted study membership");
    }
};

const prepareStudyGithubEnrichment = async options => {
    const {
        pool,
        csvPath,
        requestedStudy,
        githubConfig,
        readCards,
        createClient,
        enrich,
    } = options;
    if (!githubConfig.enabled) return {status: "DISABLED"};

    const study = await loadPersistedStudy(pool, requestedStudy.studyKey);
    const [{cards, errors, sourceChecksum}, membership] = await Promise.all([
        readCards(csvPath, {expectedCardCount: study.expected_card_count}),
        loadPersistedMembership(pool, study.id),
    ]);
    if (errors.length > 0) throw new Error("CSV validation failed");
    assertSourceMatchesStudy({study, requestedStudy, cards, sourceChecksum, membership});

    return enrich({
        pool,
        study,
        config: githubConfig,
        githubClient: createClient({config: githubConfig}),
        loadCards: async () => membership,
    });
};

export {prepareStudyGithubEnrichment};
