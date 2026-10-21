import {isDeepStrictEqual} from "node:util";
import {readPullRequestCards} from "./csv-pr-provider.js";
import {COPILOT_369_SOURCE_CHECKSUM, readCopilot369Cards} from "./copilot-369-source.js";
import {canonicalCardContent, computeCardChecksum} from "./pr-card-checksum.js";
import {verifyCopilot369ExistingCards} from "./copilot-369-persistence.js";
import {DEFAULT_STUDY_CONFIG, parseStudyConfig} from "./study-config.js";
import {CUTOVER_TABLES} from "./copilot-369-schema-contract.js";
import {assertStudySourceHistory} from "./study-source-history.js";

const LEGACY_300_CHECKSUM = "4051c10c39a1634aa80d9018aa53b59fd6009fdc4d7f2526d5e73708b02f53ef";
const CUTOVER_CONFIRMATION = "cutover-primary-300-to-copilot-369";
const DECISION_TABLES = Object.freeze(["pr_classification", "pr_discard"]);
const requireEqual = (actual, expected, label) => {
    if (!isDeepStrictEqual(actual, expected)) throw new Error(`Cutover ${label} mismatch`);
};

const prepareCopilot369Cutover = async options => {
    requireEqual(options.confirmation, CUTOVER_CONFIRMATION, "operator intention");
    requireEqual(options.maintenance, {applicationStopped: true, preparationStopped: true,
        enrichmentStopped: true, schemaWritersStopped: true}, "maintenance attestation");
    if (typeof options.expectedStudyId !== "string"
        || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(options.expectedStudyId)) {
        throw new Error("Cutover requires an explicit expected study UUID");
    }
    requireEqual(options.expectedStudyKey, DEFAULT_STUDY_CONFIG.studyKey, "study key");
    requireEqual(options.expectedLegacyChecksum, LEGACY_300_CHECKSUM, "legacy checksum");
    requireEqual(options.expectedTargetChecksum, COPILOT_369_SOURCE_CHECKSUM, "target checksum");
    const legacyConfig = parseStudyConfig(options.expectedLegacyConfig);
    requireEqual(legacyConfig, {...DEFAULT_STUDY_CONFIG, expectedCardCount: 300}, "legacy configuration");
    requireEqual(options.expectedLegacyConfig, legacyConfig, "exact legacy configuration");
    const [legacy, target] = await Promise.all([
        readPullRequestCards(options.legacyCsvPath, {expectedCardCount: 300}),
        readCopilot369Cards(options.targetCsvPath, {manifestPath: options.targetManifestPath}),
    ]);
    requireEqual(legacy.errors, [], "legacy CSV validation");
    requireEqual(legacy.sourceChecksum, LEGACY_300_CHECKSUM, "legacy CSV checksum");
    requireEqual(legacy.cards.length, 300, "legacy CSV count");
    if (!Array.isArray(options.expectedLegacyMemberships) || options.expectedLegacyMemberships.length !== 300) {
        throw new Error("Cutover requires the exact ordered 300 legacy memberships");
    }
    const memberships = structuredClone(options.expectedLegacyMemberships);
    for (const [ordinal, card] of legacy.cards.entries()) {
        const member = memberships[ordinal];
        requireEqual(Object.keys(member).sort(), ["ordinal", "pr_card_id", "source_card_id", "source_checksum"], "legacy membership fields");
        requireEqual(member.ordinal, ordinal, "legacy membership ordinal");
        requireEqual(member.source_card_id, card.source_card_id, "legacy membership identity");
        if (member.source_checksum !== computeCardChecksum(card)
            || typeof member.pr_card_id !== "string" || !/^[0-9a-f-]{36}$/.test(member.pr_card_id)) {
            throw new Error("Cutover legacy membership checksum or card UUID mismatch");
        }
    }
    return {studyId: options.expectedStudyId, studyKey: options.expectedStudyKey,
        legacyConfig, targetConfig: {...legacyConfig, expectedCardCount: 369}, memberships, legacy, target};
};

const assertNoCopilot369History = async (client, studyId) => {
    for (const table of DECISION_TABLES) {
        const {rows} = await client.query(`SELECT 1 FROM public.${table} WHERE study_id = $1 LIMIT 1`, [studyId]);
        if (rows.length) throw new Error(`Cutover blocked by primary history in ${table}`);
    }
    const {rows: running} = await client.query(
        "SELECT 1 FROM public.github_enrichment_run WHERE study_id=$1 AND state='RUNNING' LIMIT 1", [studyId]);
    if (running.length) throw new Error("Cutover blocked by RUNNING primary history");
    await assertStudySourceHistory(client);
};

const inspectCopilot369Study = async (client, input) => {
    const {rows: [study]} = await client.query("SELECT * FROM public.study WHERE study_key = $1", [input.studyKey]);
    if (!study || study.id !== input.studyId || study.bootstrap_state !== "READY") {
        throw new Error("Cutover study identity or READY state mismatch");
    }
    const target = study.expected_card_count === 369;
    requireEqual(study.config, target ? input.targetConfig : input.legacyConfig, "persisted configuration");
    requireEqual(study.expected_card_count, target ? 369 : 300, "persisted count");
    requireEqual(study.source_checksum, target ? input.target.sourceChecksum : LEGACY_300_CHECKSUM, "persisted source");
    const {rows: members} = await client.query(
        `SELECT pr_card_id, source_card_id, ordinal, source_checksum FROM public.study_card
         WHERE study_id = $1 ORDER BY ordinal`, [input.studyId]);
    if (target) {
        await assertStudySourceHistory(client);
        const cards = await verifyCopilot369ExistingCards(client, input.target.cards, input.target.sourceChecksum);
        requireEqual(cards.length, 369, "complete existing target cards");
        requireEqual(members, cards.map((card, ordinal) => ({pr_card_id: card.id,
            source_card_id: card.source_card_id, ordinal, source_checksum: card.content_checksum})), "target membership");
    } else {
        requireEqual(members, input.memberships, "legacy membership");
        const {rows: cards} = await client.query(
            "SELECT * FROM public.pr_cards WHERE id = ANY($1::uuid[])", [members.map(member => member.pr_card_id)]);
        const byId = new Map(cards.map(card => [card.id, card]));
        for (const [ordinal, card] of input.legacy.cards.entries()) {
            const actual = byId.get(members[ordinal].pr_card_id);
            if (!actual) throw new Error("Cutover legacy card is missing");
            requireEqual(canonicalCardContent(actual), canonicalCardContent(card), "legacy card content");
            requireEqual(actual.source_checksum, LEGACY_300_CHECKSUM, "legacy card source checksum");
            requireEqual(actual.content_checksum, computeCardChecksum(card), "legacy card content checksum");
        }
        await assertNoCopilot369History(client, input.studyId);
        await verifyCopilot369ExistingCards(client, input.target.cards, input.target.sourceChecksum);
    }
    const {rows: participants} = await client.query(
        "SELECT participant_key, ordinal FROM public.study_participant WHERE study_id = $1 ORDER BY ordinal", [input.studyId]);
    requireEqual(participants, input.legacyConfig.participants.map((participant_key, ordinal) => ({participant_key, ordinal})), "participants");
    return {study, target};
};

const fingerprintCopilot369PreservedState = async (client, scope) => {
    const fingerprints = {};
    for (const table of CUTOVER_TABLES) {
        let filter = "";
        let parameters = [];
        let row = "jsonb_build_array(to_jsonb(record), record.xmin::text)";
        if (table === "study") {
            row = `CASE WHEN record.id = $1 THEN to_jsonb(record)
                - ARRAY['config', 'source_checksum', 'expected_card_count', 'updated_at']
                ELSE jsonb_build_array(to_jsonb(record), record.xmin::text) END`;
            parameters = [scope.studyId];
        } else if (table === "study_card") {
            filter = "WHERE record.study_id <> $1";
            parameters = [scope.studyId];
        } else if (table === "pr_cards") {
            filter = "WHERE record.id = ANY($1::uuid[])";
            parameters = [scope.existingCardIds];
        } else if (["study_card_reference", "study_source_membership"].includes(table)) {
            filter = "WHERE to_jsonb(record) IN (SELECT value FROM jsonb_array_elements($1::jsonb))";
            parameters = [JSON.stringify(scope.historyRows[table])];
        }
        const {rows: [result]} = await client.query(`SELECT count(*)::integer AS count,
            encode(public.digest(COALESCE(string_agg(encode(public.digest((${row})::text, 'sha256'), 'hex'),
                '' ORDER BY (${row})::text), ''), 'sha256'), 'hex') AS fingerprint
            FROM public.${table} record ${filter}`, parameters);
        fingerprints[table] = result;
    }
    return fingerprints;
};

export {CUTOVER_CONFIRMATION, LEGACY_300_CHECKSUM, assertNoCopilot369History,
    fingerprintCopilot369PreservedState, inspectCopilot369Study, prepareCopilot369Cutover};
