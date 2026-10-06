BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public."labeler_migration"
    WHERE "migration_id" = '012_global_normalized_username'
  ) THEN
    RAISE EXCEPTION 'Migration 012_global_normalized_username must be applied before 013_category_definition_color';
  END IF;
END
$$;

DO $$
DECLARE
  existing_definition_type TEXT;
  existing_definition_not_null BOOLEAN;
  existing_color_type TEXT;
  existing_color_not_null BOOLEAN;
  existing_color_default TEXT;
BEGIN
  SELECT format_type(attribute.atttypid, attribute.atttypmod), attribute.attnotnull
  INTO existing_definition_type, existing_definition_not_null
  FROM pg_attribute attribute
  JOIN pg_class relation ON relation.oid = attribute.attrelid
  JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
  WHERE namespace.nspname = 'public'
    AND relation.relname = 'participant_category'
    AND attribute.attname = 'definition'
    AND attribute.attnum > 0
    AND NOT attribute.attisdropped;

  IF FOUND AND (existing_definition_type <> 'text' OR existing_definition_not_null) THEN
    RAISE EXCEPTION 'Unexpected pre-existing definition column on participant_category: type %, not null %',
      existing_definition_type, existing_definition_not_null;
  END IF;

  SELECT format_type(attribute.atttypid, attribute.atttypmod), attribute.attnotnull,
         pg_get_expr(default_value.adbin, default_value.adrelid)
  INTO existing_color_type, existing_color_not_null, existing_color_default
  FROM pg_attribute attribute
  JOIN pg_class relation ON relation.oid = attribute.attrelid
  JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
  LEFT JOIN pg_attrdef default_value
    ON default_value.adrelid = attribute.attrelid AND default_value.adnum = attribute.attnum
  WHERE namespace.nspname = 'public'
    AND relation.relname = 'participant_category'
    AND attribute.attname = 'color_slot'
    AND attribute.attnum > 0
    AND NOT attribute.attisdropped;

  IF FOUND AND (
    existing_color_type <> 'smallint'
    OR NOT existing_color_not_null
    OR existing_color_default IS NULL
    OR replace(replace(replace(existing_color_default, '(', ''), ')', ''), ' ', '')
       NOT IN ('0', '''0''::smallint', '0::smallint')
  ) THEN
    RAISE EXCEPTION 'Unexpected pre-existing color_slot column on participant_category: type %, not null %, default %',
      existing_color_type, existing_color_not_null, existing_color_default;
  END IF;
END
$$;

ALTER TABLE "participant_category"
  ADD COLUMN IF NOT EXISTS "definition" TEXT;

ALTER TABLE "participant_category"
  ADD COLUMN IF NOT EXISTS "color_slot" SMALLINT NOT NULL DEFAULT 0;

WITH "ranked_category_slots" AS (
  SELECT
    "id",
    (ROW_NUMBER() OVER (PARTITION BY "study_id", "participant_id" ORDER BY "created_at", "id") - 1) % 12 AS "slot"
  FROM "participant_category"
)
UPDATE "participant_category" category
SET "color_slot" = ranked."slot"
FROM "ranked_category_slots" ranked
WHERE category."id" = ranked."id";

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'participant_category_color_slot_check'
      AND conrelid = 'participant_category'::regclass
  ) THEN
    ALTER TABLE "participant_category"
      ADD CONSTRAINT "participant_category_color_slot_check"
      CHECK ("color_slot" >= 0 AND "color_slot" < 12);
  END IF;
END
$$;

INSERT INTO "labeler_migration" ("migration_id")
VALUES ('013_category_definition_color')
ON CONFLICT ("migration_id") DO NOTHING;

COMMIT;
