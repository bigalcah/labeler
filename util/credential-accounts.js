import {createPasswordHash, isValidPasswordHash} from "./credential-policy.js";
import {validateCredentialManifest} from "./credential-manifest.js";
import {withTransaction} from "./transaction.js";

class CredentialAccountError extends Error {
    constructor() {
        super("CREDENTIAL_ACCOUNT_INVALID");
        this.name = "CredentialAccountError";
        this.code = "CREDENTIAL_ACCOUNT_INVALID";
    }
}

const fail = () => {
    throw new CredentialAccountError();
};

const provisionParticipantAccounts = async ({client, studyId, config, manifest}) => {
    const validated = validateCredentialManifest(manifest, config);
    const {rows: memberships} = await client.query(
        `SELECT reviewer_id, participant_key
         FROM study_participant
         WHERE study_id = $1
         ORDER BY ordinal`,
        [ studyId ],
    );
    if (memberships.length !== config.participants.length
        || memberships.some((membership, index) => membership.participant_key !== config.participants[index])) fail();
    for (const [index, membership] of memberships.entries()) {
        const account = validated.accounts[index];
        await client.query(
            `INSERT INTO participant_account(study_id, reviewer_id, normalized_username, password_hash)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (study_id, reviewer_id) DO NOTHING`,
            [ studyId, membership.reviewer_id, account.normalizedUsername, account.passwordHash ],
        );
    }
    const {rows: accounts} = await client.query(
        `SELECT account.reviewer_id, account.normalized_username, account.password_hash,
                account.enabled, account.credential_version, participant.participant_key
         FROM participant_account account
         INNER JOIN study_participant participant
             ON participant.study_id = account.study_id AND participant.reviewer_id = account.reviewer_id
         WHERE account.study_id = $1
         ORDER BY participant.ordinal`,
        [ studyId ],
    );
    if (accounts.length !== validated.accounts.length || accounts.some((account, index) => {
        const expected = validated.accounts[index];
        return account.participant_key !== expected.participantKey
            || account.normalized_username !== expected.normalizedUsername
            || account.enabled !== true
            || !Number.isInteger(account.credential_version) || account.credential_version < 1
            || !isValidPasswordHash(account.password_hash);
    })) fail();
};

const resetParticipantCredential = async ({pool, studyKey, participantKey, password}) => {
    const passwordHash = await createPasswordHash(password);
    return withTransaction(pool, async client => {
        const {rows: [account]} = await client.query(
            `SELECT account.id
             FROM participant_account account
             INNER JOIN study_participant participant
                 ON participant.study_id = account.study_id AND participant.reviewer_id = account.reviewer_id
             INNER JOIN study ON study.id = participant.study_id
             WHERE study.study_key = $1 AND participant.participant_key = $2
             FOR UPDATE`,
            [ studyKey, participantKey ],
        );
        if (!account) fail();
        await client.query(
            `UPDATE participant_account
             SET password_hash = $1, credential_version = credential_version + 1, updated_at = NOW()
             WHERE id = $2`,
            [ passwordHash, account.id ],
        );
        await client.query("DELETE FROM app_session WHERE account_id = $1", [ account.id ]);
    });
};

export {CredentialAccountError, provisionParticipantAccounts, resetParticipantCredential};
