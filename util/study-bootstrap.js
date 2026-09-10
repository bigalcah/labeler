import {persistCards} from "./pr-card-persistence.js";
import {resolveAuthoritativeStudyConfig} from "./study-config.js";
import {managedMigrations} from "./study-schema.js";
import {withTransaction} from "./transaction.js";
import {provisionParticipantAccounts} from "./credential-accounts.js";
import {validateCredentialManifest} from "./credential-manifest.js";

class StudyBootstrapConflictError extends Error {
    constructor(message) {
        super(message);
        this.name = "StudyBootstrapConflictError";
    }
}

const assertBootstrapCards = (cards, expectedCardCount) => {
    const sourceCardIds = cards.map(card => card.source_card_id);
    if (cards.length !== expectedCardCount || new Set(sourceCardIds).size !== expectedCardCount) {
        throw new StudyBootstrapConflictError(
            `Bootstrap requires exactly ${expectedCardCount} cards with unique source_card_id values`,
        );
    }
};

const assertStudySchemaReady = async pool => {
    const prerequisiteMigrationIds = managedMigrations.map(migration => migration.id);
    let rows;
    try {
        ({rows} = await pool.query(
            `SELECT migration_id
             FROM labeler_migration
             WHERE migration_id = ANY($1::text[])`,
            [ prerequisiteMigrationIds ],
        ));
    } catch (error) {
        if (error.code === "42P01") {
            throw new StudyBootstrapConflictError("Study schema migrations are missing");
        }
        throw error;
    }
    const applied = new Set(rows.map(row => row.migration_id));
    if (prerequisiteMigrationIds.some(migrationId => !applied.has(migrationId))) {
        throw new StudyBootstrapConflictError(
            `Bootstrap requires migrations ${prerequisiteMigrationIds.join(", ")}`,
        );
    }
};

const findOrCreateStudy = async (client, config, sourceChecksum) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [ config.studyKey ]);
    const {rows: existingRows} = await client.query(
        `SELECT id, config, source_checksum, bootstrap_state
         FROM study
         WHERE study_key = $1
         FOR UPDATE`,
        [ config.studyKey ],
    );
    const [ existing ] = existingRows;
    if (existing) {
        resolveAuthoritativeStudyConfig(config, existing.config);
        if (existing.source_checksum !== sourceChecksum) {
            throw new StudyBootstrapConflictError(`Source checksum drift for studyKey ${config.studyKey}`);
        }
        return {...existing, created: false};
    }

    const {rows: [ study ]} = await client.query(
        `INSERT INTO study(study_key, config, source_checksum, expected_card_count)
         VALUES ($1, $2, $3, $4)
         RETURNING id, config, source_checksum, bootstrap_state`,
        [ config.studyKey, config, sourceChecksum, config.expectedCardCount ],
    );
    return {...study, created: true};
};

const assertMembership = (actual, expected, valueField, label) => {
    if (actual.length !== expected.length
        || actual.some((row, index) => row.ordinal !== index || row[valueField] !== expected[index])) {
        throw new StudyBootstrapConflictError(`${label} membership drift`);
    }
};

const persistParticipants = async options => {
    const {client, studyId, participants, allowCreate} = options;
    const {rows: memberships} = await client.query(
        `SELECT participant_key, ordinal
         FROM study_participant
         WHERE study_id = $1
         ORDER BY ordinal`,
        [ studyId ],
    );
    if (memberships.length > 0) {
        assertMembership(memberships, participants, "participant_key", "Participant");
        return;
    }
    if (!allowCreate) throw new StudyBootstrapConflictError("Participant membership drift");

    for (const [ ordinal, participantKey ] of participants.entries()) {
        const {rows: inserted} = await client.query(
            `INSERT INTO reviewer(name)
             VALUES ($1)
             ON CONFLICT (name) DO NOTHING
             RETURNING id`,
            [ participantKey ],
        );
        const reviewerId = inserted[0]?.id || (await client.query(
            "SELECT id FROM reviewer WHERE name = $1",
            [ participantKey ],
        )).rows[0].id;
        await client.query(
            `INSERT INTO study_participant(study_id, reviewer_id, participant_key, ordinal)
             VALUES ($1, $2, $3, $4)`,
            [ studyId, reviewerId, participantKey, ordinal ],
        );
    }
};

const persistStudyCards = async options => {
    const {client, studyId, cards, persistedCards, allowCreate} = options;
    const expected = cards.map((card, ordinal) => ({
        source_card_id: card.source_card_id,
        source_checksum: persistedCards[ordinal].content_checksum,
        ordinal,
    }));
    const {rows: memberships} = await client.query(
        `SELECT source_card_id, source_checksum, ordinal
         FROM study_card
         WHERE study_id = $1
         ORDER BY ordinal`,
        [ studyId ],
    );
    if (memberships.length > 0) {
        const actualKeys = memberships.map(row => `${row.source_card_id}:${row.source_checksum}`);
        const expectedKeys = expected.map(row => `${row.source_card_id}:${row.source_checksum}`);
        assertMembership(
            actualKeys.map((key, ordinal) => ({key, ordinal})),
            expectedKeys,
            "key",
            "Card",
        );
        return;
    }
    if (!allowCreate) throw new StudyBootstrapConflictError("Card membership drift");

    for (const membership of expected) {
        const persistedCard = persistedCards[membership.ordinal];
        await client.query(
            `INSERT INTO study_card(study_id, pr_card_id, source_card_id, ordinal, source_checksum)
             VALUES ($1, $2, $3, $4, $5)`,
            [
                studyId,
                persistedCard.id,
                membership.source_card_id,
                membership.ordinal,
                membership.source_checksum,
            ],
        );
    }
};

const bootstrapStudy = async options => {
    const {pool, config, cards, sourceChecksum, credentialManifest} = options;
    await assertStudySchemaReady(pool);
    assertBootstrapCards(cards, config.expectedCardCount);
    const manifest = validateCredentialManifest(credentialManifest, config);
    return withTransaction(pool, async client => {
        const study = await findOrCreateStudy(client, config, sourceChecksum);
        await persistParticipants({
            client,
            studyId: study.id,
            participants: config.participants,
            allowCreate: study.created,
        });
        const persistedCards = await persistCards(client, cards, sourceChecksum);
        await persistStudyCards({
            client,
            studyId: study.id,
            cards,
            persistedCards,
            allowCreate: study.created,
        });
        await provisionParticipantAccounts({
            client,
            studyId: study.id,
            config,
            manifest,
        });
        await client.query(
            `UPDATE study
             SET bootstrap_state = 'READY', updated_at = NOW()
             WHERE id = $1`,
            [ study.id ],
        );
        return {...study, bootstrap_state: "READY"};
    });
};

export {StudyBootstrapConflictError, assertBootstrapCards, assertStudySchemaReady, bootstrapStudy};
