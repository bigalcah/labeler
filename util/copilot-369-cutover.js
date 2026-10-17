import {isDeepStrictEqual} from "node:util";
import {persistCopilot369Cards} from "./copilot-369-persistence.js";
import {CUTOVER_TABLES, assertCopilot369SchemaContract} from "./copilot-369-schema-contract.js";
import {assertNoCopilot369History, fingerprintCopilot369PreservedState,
    inspectCopilot369Study, prepareCopilot369Cutover} from "./copilot-369-cutover-preflight.js";

const cutoverCopilot369 = async options => {
    const input = await prepareCopilot369Cutover(options);
    const client = await options.pool.connect();
    try {
        await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
        await client.query("SET LOCAL search_path TO public, pg_catalog, pg_temp");
        await assertCopilot369SchemaContract(client);
        const initial = await inspectCopilot369Study(client, input);
        await client.query("COMMIT");
        if (initial.target) return {status: "ALREADY_369", studyId: input.studyId, cardCount: 369};

        await client.query("BEGIN ISOLATION LEVEL READ COMMITTED");
        await client.query("SET LOCAL search_path TO public, pg_catalog, pg_temp");
        await client.query("SET LOCAL lock_timeout = '2s'");
        await client.query("SELECT pg_advisory_xact_lock(hashtext('labeler:study-schema'))");
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [input.studyKey]);
        for (const table of CUTOVER_TABLES) {
            await client.query(`LOCK TABLE public.${table} IN EXCLUSIVE MODE NOWAIT`);
        }
        await assertCopilot369SchemaContract(client);
        await client.query("SELECT id FROM public.study WHERE id = $1 FOR UPDATE", [input.studyId]);
        const locked = await inspectCopilot369Study(client, input);
        if (locked.target) throw new Error("Cutover changed during preflight; rerun for read-only verification");
        const {rows: oldCards} = await client.query("SELECT id FROM public.pr_cards ORDER BY id");
        const scope = {studyId: input.studyId, existingCardIds: oldCards.map(card => card.id)};
        const before = await fingerprintCopilot369PreservedState(client, scope);
        const persisted = await persistCopilot369Cards(client, input.target.cards, input.target.sourceChecksum);
        await client.query("DELETE FROM public.study_card WHERE study_id = $1", [input.studyId]);
        await client.query(
            `INSERT INTO public.study_card(study_id, pr_card_id, source_card_id, ordinal, source_checksum)
             SELECT $1, card.id, card.source_card_id, card.ordinal, card.content_checksum
             FROM jsonb_to_recordset($2::jsonb) AS card(id uuid, source_card_id text, ordinal integer, content_checksum text)`,
            [input.studyId, JSON.stringify(persisted.map((card, ordinal) => ({...card, ordinal})))],
        );
        await client.query(
            `UPDATE public.study SET config = $2::jsonb, source_checksum = $3,
                expected_card_count = 369, updated_at = clock_timestamp() WHERE id = $1`,
            [input.studyId, JSON.stringify(input.targetConfig), input.target.sourceChecksum],
        );
        const final = await inspectCopilot369Study(client, input);
        if (!final.target) throw new Error("Cutover final target verification failed");
        await assertNoCopilot369History(client, input.studyId);
        const after = await fingerprintCopilot369PreservedState(client, scope);
        if (!isDeepStrictEqual(before, after)) throw new Error("Cutover changed protected persistent data");
        await assertCopilot369SchemaContract(client);
        await client.query("COMMIT");
        return {status: "CUTOVER_369", studyId: input.studyId, cardCount: 369};
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
};

export {cutoverCopilot369};
