BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public."labeler_migration"
    WHERE "migration_id" = '010_study_scoped_participant_categories'
  ) THEN
    RAISE EXCEPTION 'Migration 010_study_scoped_participant_categories must be applied before 011_multi_study_cardinality';
  END IF;
END
$$;

DROP INDEX IF EXISTS "study_ready_uidx";

CREATE INDEX IF NOT EXISTS "study_ready_idx"
  ON "study" ("bootstrap_state")
  WHERE "bootstrap_state" = 'READY';

ALTER TABLE "study"
  DROP CONSTRAINT IF EXISTS "study_expected_card_count_check";

ALTER TABLE "study"
  ADD CONSTRAINT "study_expected_card_count_check"
  CHECK ("expected_card_count" IN (30, 300));

INSERT INTO "labeler_migration" ("migration_id")
VALUES ('011_multi_study_cardinality')
ON CONFLICT ("migration_id") DO NOTHING;

COMMIT;
