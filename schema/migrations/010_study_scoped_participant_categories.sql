BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public."labeler_migration"
    WHERE "migration_id" = '009_csrf_contexts'
  ) THEN
    RAISE EXCEPTION 'Migration 009_csrf_contexts must be applied before 010_study_scoped_participant_categories';
  END IF;
END
$$;

ALTER TABLE "participant_category"
  ADD COLUMN IF NOT EXISTS "study_id" UUID;

ALTER TABLE "participant_category"
  DROP CONSTRAINT IF EXISTS "participant_category_participant_id_normalized_name_key";

CREATE TEMPORARY TABLE "participant_category_study_mapping"
ON COMMIT DROP
AS
SELECT
  category."id" AS "original_category_id",
  classification."study_id",
  CASE
    WHEN ROW_NUMBER() OVER (PARTITION BY category."id" ORDER BY classification."study_id") = 1
      THEN category."id"
    ELSE gen_random_uuid()
  END AS "scoped_category_id"
FROM "participant_category" category
JOIN (
  SELECT DISTINCT "category_id", "participant_id", "study_id"
  FROM "pr_classification"
) classification
  ON classification."category_id" = category."id"
 AND classification."participant_id" = category."participant_id";

DO $$
DECLARE
  conflict_count BIGINT;
BEGIN
  SELECT COUNT(*) INTO conflict_count
  FROM "participant_category_study_mapping" mapping
  JOIN "participant_category" category
    ON category."id" = mapping."original_category_id"
  WHERE category."study_id" IS NOT NULL
    AND category."study_id" <> mapping."study_id";

  IF conflict_count > 0 THEN
    RAISE EXCEPTION 'Cannot scope classified participant categories: % rows conflict with existing study ownership', conflict_count;
  END IF;
END
$$;

UPDATE "participant_category" category
SET "study_id" = mapping."study_id"
FROM "participant_category_study_mapping" mapping
WHERE category."id" = mapping."original_category_id"
  AND mapping."scoped_category_id" = mapping."original_category_id"
  AND category."study_id" IS NULL;

INSERT INTO "participant_category" (
  "id",
  "study_id",
  "participant_id",
  "raw_name",
  "normalized_name",
  "created_at",
  "updated_at"
)
SELECT
  mapping."scoped_category_id",
  mapping."study_id",
  category."participant_id",
  category."raw_name",
  category."normalized_name",
  category."created_at",
  category."updated_at"
FROM "participant_category_study_mapping" mapping
JOIN "participant_category" category
  ON category."id" = mapping."original_category_id"
WHERE mapping."scoped_category_id" <> mapping."original_category_id";

UPDATE "pr_classification" classification
SET "category_id" = mapping."scoped_category_id"
FROM "participant_category_study_mapping" mapping
WHERE classification."category_id" = mapping."original_category_id"
  AND classification."study_id" = mapping."study_id"
  AND classification."category_id" <> mapping."scoped_category_id";

DO $$
DECLARE
  conflict_count BIGINT;
BEGIN
  SELECT COUNT(*) INTO conflict_count
  FROM (
    SELECT category."id"
    FROM "participant_category" category
    LEFT JOIN "study_participant" participant
      ON participant."reviewer_id" = category."participant_id"
    WHERE category."study_id" IS NULL
    GROUP BY category."id"
    HAVING COUNT(DISTINCT participant."study_id") <> 1
  ) conflicts;

  IF conflict_count > 0 THEN
    RAISE EXCEPTION 'Cannot scope unclassified participant categories: % rows have missing or ambiguous study membership', conflict_count;
  END IF;
END
$$;

UPDATE "participant_category" category
SET "study_id" = membership."study_id"
FROM (
  SELECT
    category."id",
    (array_agg(DISTINCT participant."study_id" ORDER BY participant."study_id"))[1] AS "study_id"
  FROM "participant_category" category
  JOIN "study_participant" participant
    ON participant."reviewer_id" = category."participant_id"
  WHERE category."study_id" IS NULL
  GROUP BY category."id"
  HAVING COUNT(DISTINCT participant."study_id") = 1
) membership
WHERE category."id" = membership."id";

ALTER TABLE "participant_category"
  ALTER COLUMN "study_id" SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'participant_category_study_participant_name_key'
      AND conrelid = 'participant_category'::regclass
  ) THEN
    ALTER TABLE "participant_category"
      ADD CONSTRAINT "participant_category_study_participant_name_key"
      UNIQUE ("study_id", "participant_id", "normalized_name");
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'participant_category_id_study_participant_key'
      AND conrelid = 'participant_category'::regclass
  ) THEN
    ALTER TABLE "participant_category"
      ADD CONSTRAINT "participant_category_id_study_participant_key"
      UNIQUE ("id", "study_id", "participant_id");
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'participant_category_study_participant_fk'
      AND conrelid = 'participant_category'::regclass
  ) THEN
    ALTER TABLE "participant_category"
      ADD CONSTRAINT "participant_category_study_participant_fk"
      FOREIGN KEY ("study_id", "participant_id")
      REFERENCES "study_participant" ("study_id", "reviewer_id");
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'pr_classification_category_study_participant_fk'
      AND conrelid = 'pr_classification'::regclass
  ) THEN
    ALTER TABLE "pr_classification"
      ADD CONSTRAINT "pr_classification_category_study_participant_fk"
      FOREIGN KEY ("category_id", "study_id", "participant_id")
      REFERENCES "participant_category" ("id", "study_id", "participant_id");
  END IF;
END
$$;

INSERT INTO "labeler_migration" ("migration_id")
VALUES ('010_study_scoped_participant_categories')
ON CONFLICT ("migration_id") DO NOTHING;

COMMIT;
