BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public."labeler_migration"
    WHERE "migration_id" = '011_multi_study_cardinality'
  ) THEN
    RAISE EXCEPTION 'Migration 011_multi_study_cardinality must be applied before 012_global_normalized_username';
  END IF;
END
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT "normalized_username"
    FROM "participant_account"
    GROUP BY "normalized_username"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate normalized usernames prevent global uniqueness';
  END IF;
END
$$;

CREATE UNIQUE INDEX "participant_account_normalized_username_uidx"
  ON "participant_account" ("normalized_username");

INSERT INTO "labeler_migration" ("migration_id")
VALUES ('012_global_normalized_username')
ON CONFLICT ("migration_id") DO NOTHING;

COMMIT;
