BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public."labeler_migration"
    WHERE "migration_id" = '013_category_definition_color'
  ) THEN
    RAISE EXCEPTION 'Migration 013_category_definition_color must be applied before 014_copilot_369_cardinality';
  END IF;
END
$$;

ALTER TABLE "study"
  DROP CONSTRAINT IF EXISTS "study_expected_card_count_check";

ALTER TABLE "study"
  ADD CONSTRAINT "study_expected_card_count_check"
  CHECK ("expected_card_count" IN (30, 300, 369));

INSERT INTO "labeler_migration" ("migration_id")
VALUES ('014_copilot_369_cardinality')
ON CONFLICT ("migration_id") DO NOTHING;

COMMIT;
