import {readPullRequestCards} from "./csv-pr-provider.js";
import {canonicalCardContent, computeCardChecksum} from "./pr-card-checksum.js";
import {isDeepStrictEqual} from "node:util";
import {isValidPasswordHash} from "./credential-policy.js";
import {verifyExistingStudyClient, withReadOnlyTransaction} from "./study-existing-validation.js";
import {DEFAULT_STUDY_CONFIG} from "./study-config.js";

const readHistoricalReadinessSource = async (legacyCsvPath = new URL("../data/pr-cards.csv", import.meta.url)) => {
    const legacy = await readPullRequestCards(legacyCsvPath, {expectedCardCount: 300});
    if (legacy.errors.length || legacy.sourceChecksum !== "4051c10c39a1634aa80d9018aa53b59fd6009fdc4d7f2526d5e73708b02f53ef") {
        throw new Error("Historical source identity is not available for inventory.");
    }
    return legacy;
};

const verifyLegacyReadinessClient = async (client, profiles, legacyCsvPath) => {
    if (profiles.length !== 2) throw new Error("Legacy inventory requires both approved profiles.");
    const legacy = await readHistoricalReadinessSource(legacyCsvPath);
    await verifyExistingStudyClient(client, profiles[1].bootstrapInput);
    const {rows: [study]} = await client.query("SELECT * FROM public.study WHERE study_key = 'pr-card-sorting-local'");
    if (study.source_checksum !== legacy.sourceChecksum || study.bootstrap_state !== "READY"
        || !isDeepStrictEqual(study.config, {...DEFAULT_STUDY_CONFIG, expectedCardCount: 300})) throw new Error("Historical primary drift.");
    const {rows: members} = await client.query(`SELECT card.*, membership.ordinal,
            membership.source_checksum AS membership_checksum FROM public.study_card membership
            JOIN public.pr_cards card ON card.id = membership.pr_card_id WHERE membership.study_id = $1
            ORDER BY membership.ordinal`, [study.id]);
    if (members.length !== 300 || members.some((member, index) => member.ordinal !== index
            || member.source_card_id !== legacy.cards[index].source_card_id
            || member.content_checksum !== computeCardChecksum(legacy.cards[index])
            || member.membership_checksum !== member.content_checksum
            || !isDeepStrictEqual(canonicalCardContent(member), canonicalCardContent(legacy.cards[index])))) {
        throw new Error("Historical ordered memberships or content drift.");
    }
    const {rows: accounts} = await client.query(`SELECT participant.participant_key, participant.ordinal,
            reviewer.name, account.* FROM public.study_participant participant
            JOIN public.reviewer ON reviewer.id = participant.reviewer_id
            JOIN public.participant_account account ON account.study_id = participant.study_id
                AND account.reviewer_id = participant.reviewer_id
            WHERE participant.study_id = $1 ORDER BY participant.ordinal`, [study.id]);
    if (accounts.length !== 3 || accounts.some((account, ordinal) => account.ordinal !== ordinal
            || account.participant_key !== ["javier", "diego", "pablo"][ordinal]
            || account.name !== account.participant_key || account.normalized_username !== account.participant_key
            || !account.enabled || !isValidPasswordHash(account.password_hash) || account.credential_version < 1)) {
        throw new Error("Historical accounts drift.");
    }
};

const verifyLegacyReadiness = (pool, profiles, legacyCsvPath) => withReadOnlyTransaction(pool,
    client => verifyLegacyReadinessClient(client, profiles, legacyCsvPath));

export {readHistoricalReadinessSource, verifyLegacyReadiness, verifyLegacyReadinessClient};
