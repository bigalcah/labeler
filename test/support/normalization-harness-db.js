import assert from "node:assert/strict";
import {readFileSync, writeFileSync} from "node:fs";
import path from "node:path";
import pg from "pg";
import {probeStudyHistory, probeStudyNormalization} from "../../util/study-readiness.js";
import {readStudyProfilesInput} from "../../util/study-profiles-input.js";
import {fingerprintNormalizationRows} from "./study-normalization-fixture.js";

const [mode, host, runtime, project, outputPath] = process.argv.slice(2);
assert.ok(["eligible", "post-normalization", "history", "prepared", "clean", "fingerprint", "clean-ledger"].includes(mode));
const pool = new pg.Pool({host, port: 5432, user: "labeler_inspection", database: "labeling_harness",
    password: readFileSync(path.join(runtime, "inspection-password"), "utf8").trim(), max: 1,
    connectionTimeoutMillis: 5000, idleTimeoutMillis: 3000, statement_timeout: 30000});

try {
    if (mode === "fingerprint") {
        const fingerprint = await fingerprintNormalizationRows(pool);
        if (outputPath === "-") process.stdout.write(`${fingerprint}\n`);
        else writeFileSync(outputPath, `${fingerprint}\n`, {mode: 0o600});
    } else if (mode === "clean-ledger") {
        const {rows: [ledger]} = await pool.query(`SELECT NOT EXISTS (
            SELECT FROM public.labeler_migration WHERE migration_id = '015_normalize_retired_study_schema'
        ) AS fifteen_absent`);
        assert.equal(ledger.fifteen_absent, true);
        writeFileSync(outputPath, "{\"015Absent\":true}\n", {mode: 0o600});
    } else {
        let profiles = [];
        if (mode === "prepared" || mode === "clean") {
            const descriptorPath = path.join(runtime, "host-control/normalization-profiles.json");
            const descriptor = {profiles: [
                {config: path.join(runtime, "study-config.json"), csv: path.resolve("plans/copilot-369-cards.csv"),
                    accountManifest: path.join(runtime, "study-account-manifest.json"), enrichmentEnabled: false},
                {config: path.join(runtime, "validation-study-config.json"), csv: path.resolve("plans/validation-30-cards.csv"),
                    accountManifest: path.join(runtime, "validation-study-account-manifest.json"), enrichmentEnabled: false},
            ]};
            writeFileSync(descriptorPath, `${JSON.stringify(descriptor)}\n`, {mode: 0o600});
            profiles = await readStudyProfilesInput(descriptorPath, {descriptor: path.dirname(descriptorPath),
                config: runtime, csv: path.resolve("plans"), accountManifest: runtime});
        }
        const result = await probeStudyNormalization({pool, profiles, requireRestrictedRole: true});
        result.observation.databaseIdentity.endpoint = `${host}:5432/labeling_harness`;
        result.observation.databaseIdentity.volume = `${project}-data:/var/lib/postgresql/data`;
        assert.equal(result.observation.readOnly.grantsVerified, true);
        assert.equal(result.observation.readOnly.writersStopped, true);
        if (mode === "eligible") {
            assert.equal(result.applied015, false);
            assert.equal(result.eligibility, "eligible");
            assert.equal(result.observation.schema, "014_copilot_369_cardinality");
            assert.equal(result.observation.dataBundle, "empty");
        } else if (mode === "clean") {
            assert.equal(result.applied015, false);
            assert.equal(result.eligibility, "ineligible");
            assert.equal(result.observation.schema, "study-schema-4");
            assert.equal(result.observation.dataBundle, "copilot369-v1");
        } else {
            assert.equal(result.applied015, true);
            assert.equal(result.eligibility, "already-applied");
            assert.equal(result.observation.schema, ["history", "prepared"].includes(mode) ? "study-schema-4" : "study-schema-3");
            assert.equal(result.observation.dataBundle, mode === "prepared" ? "copilot369-v1" : "empty");
            const {rows: [physical]} = await pool.query(`SELECT
                (SELECT count(*) = 1 FROM public.labeler_migration
                    WHERE migration_id = '015_normalize_retired_study_schema') AS ledger_015,
                EXISTS (SELECT FROM pg_constraint constraint_row
                    WHERE constraint_row.conname = 'participant_category_participant_id_fkey'
                    AND constraint_row.conrelid = 'public.participant_category'::regclass
                    AND constraint_row.confrelid = 'public.reviewer'::regclass
                    AND constraint_row.contype = 'f' AND constraint_row.convalidated
                    AND NOT constraint_row.condeferrable
                    AND (SELECT array_agg(attribute.attname ORDER BY key.ordinality)
                        FROM unnest(constraint_row.conkey) WITH ORDINALITY AS key(attnum, ordinality)
                        JOIN pg_attribute attribute ON attribute.attrelid = constraint_row.conrelid
                            AND attribute.attnum = key.attnum) = ARRAY['participant_id']::name[]
                    AND (SELECT array_agg(attribute.attname ORDER BY key.ordinality)
                        FROM unnest(constraint_row.confkey) WITH ORDINALITY AS key(attnum, ordinality)
                        JOIN pg_attribute attribute ON attribute.attrelid = constraint_row.confrelid
                            AND attribute.attnum = key.attnum) = ARRAY['id']::name[]) AS canonical_fk,
                NOT EXISTS (SELECT FROM pg_class index_row JOIN pg_namespace namespace_row
                    ON namespace_row.oid = index_row.relnamespace WHERE namespace_row.nspname = 'public'
                    AND index_row.relname IN ('pr_classification_participant_id_updated_at_idx',
                        'study_card_pr_card_id_idx', 'study_participant_reviewer_id_idx')) AS redundant_indexes_absent`);
            assert.deepEqual(physical, {ledger_015: true, canonical_fk: true, redundant_indexes_absent: true});
        }
        const historyProbe = ["history", "prepared", "clean"].includes(mode)
            ? await probeStudyHistory({pool, profiles, requireRestrictedRole: true}) : null;
        if (historyProbe) {
            historyProbe.observation.databaseIdentity = result.observation.databaseIdentity;
            assert.equal(historyProbe.applied016, true);
        }
        writeFileSync(outputPath, `${JSON.stringify({probe: result, ...(historyProbe ? {historyProbe} : {}), applicationRowsSha256:
            mode === "prepared" ? null : await fingerprintNormalizationRows(pool),
        ...(mode === "post-normalization" ? {physical: {ledger015: true, canonicalFk: true, redundantIndexesAbsent: true}} : {})})}\n`,
        {mode: 0o600});
    }
} finally {
    await pool.end();
}
