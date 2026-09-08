BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public."labeler_migration"
    WHERE "migration_id" = '003_private_pr_discard'
  ) THEN
    RAISE EXCEPTION 'Migration 003_private_pr_discard must be applied before 004_github_pr_api_enrichment';
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS "github_enrichment_run" (
  "id" UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  "study_id" UUID NOT NULL REFERENCES "study" ("id"),
  "source_checksum" TEXT NOT NULL,
  "config_fingerprint" TEXT NOT NULL,
  "normalizer_version" TEXT NOT NULL,
  "state" TEXT NOT NULL CHECK ("state" IN ('RUNNING', 'COMPLETED', 'FAILED')),
  "manifest_checksum" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE ("id", "study_id")
);

CREATE TABLE IF NOT EXISTS "github_card_snapshot" (
  "id" UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  "pr_card_id" UUID NOT NULL REFERENCES "pr_cards" ("id"),
  "snapshot_checksum" TEXT NOT NULL,
  "normalizer_version" TEXT NOT NULL,
  "manifest" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE ("pr_card_id", "snapshot_checksum"),
  UNIQUE ("id", "pr_card_id", "snapshot_checksum")
);

CREATE TABLE IF NOT EXISTS "github_run_page" (
  "run_id" UUID NOT NULL,
  "study_id" UUID NOT NULL,
  "pr_card_id" UUID NOT NULL,
  "endpoint" TEXT NOT NULL,
  "page_ordinal" INTEGER NOT NULL CHECK ("page_ordinal" >= 0),
  "request_fingerprint" TEXT NOT NULL,
  "api_version" TEXT NOT NULL,
  "accept" TEXT NOT NULL,
  "etag" TEXT,
  "http_status" INTEGER,
  "response_checksum" TEXT,
  "normalized_checksum" TEXT,
  "item_count" INTEGER,
  "next_url" TEXT,
  "state" TEXT NOT NULL CHECK ("state" IN ('PARTIAL', 'COMPLETE', 'COMPLETE_EMPTY', 'UNAVAILABLE', 'TRUNCATED', 'FAILED')),
  "normalized_payload" JSONB,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY ("run_id", "pr_card_id", "endpoint", "page_ordinal"),
  FOREIGN KEY ("run_id", "study_id")
    REFERENCES "github_enrichment_run" ("id", "study_id"),
  FOREIGN KEY ("study_id", "pr_card_id")
    REFERENCES "study_card" ("study_id", "pr_card_id")
);

CREATE TABLE IF NOT EXISTS "github_enrichment_run_card" (
  "run_id" UUID NOT NULL,
  "study_id" UUID NOT NULL,
  "pr_card_id" UUID NOT NULL,
  "snapshot_id" UUID NOT NULL,
  "snapshot_checksum" TEXT NOT NULL,
  "ordinal" INTEGER NOT NULL CHECK ("ordinal" >= 0),
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY ("run_id", "study_id", "pr_card_id"),
  UNIQUE ("run_id", "pr_card_id"),
  UNIQUE ("run_id", "ordinal"),
  FOREIGN KEY ("run_id", "study_id")
    REFERENCES "github_enrichment_run" ("id", "study_id"),
  FOREIGN KEY ("study_id", "pr_card_id")
    REFERENCES "study_card" ("study_id", "pr_card_id"),
  FOREIGN KEY ("snapshot_id", "pr_card_id", "snapshot_checksum")
    REFERENCES "github_card_snapshot" ("id", "pr_card_id", "snapshot_checksum")
);

CREATE TABLE IF NOT EXISTS "study_enrichment_promotion" (
  "study_id" UUID PRIMARY KEY REFERENCES "study" ("id"),
  "run_id" UUID NOT NULL UNIQUE,
  "source_checksum" TEXT NOT NULL,
  "promoted_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY ("run_id", "study_id")
    REFERENCES "github_enrichment_run" ("id", "study_id")
);

CREATE INDEX IF NOT EXISTS "github_enrichment_run_study_idx"
  ON "github_enrichment_run" ("study_id", "created_at");
CREATE INDEX IF NOT EXISTS "github_run_page_run_card_idx"
  ON "github_run_page" ("run_id", "pr_card_id");
CREATE INDEX IF NOT EXISTS "github_run_card_study_ordinal_idx"
  ON "github_enrichment_run_card" ("study_id", "ordinal");

ALTER TABLE "pr_classification"
  ADD COLUMN IF NOT EXISTS "study_id" UUID,
  ADD COLUMN IF NOT EXISTS "enrichment_run_id" UUID;
ALTER TABLE "pr_discard"
  ADD COLUMN IF NOT EXISTS "study_id" UUID,
  ADD COLUMN IF NOT EXISTS "enrichment_run_id" UUID;

DO $$
DECLARE
  conflict_count BIGINT;
BEGIN
  SELECT COUNT(*) INTO conflict_count
  FROM (
    SELECT c."id"
    FROM "pr_classification" c
    LEFT JOIN LATERAL (
      SELECT COUNT(DISTINCT "study_id") AS study_count,
             (array_agg(DISTINCT "study_id" ORDER BY "study_id"))[1] AS study_id
      FROM "study_card" WHERE "pr_card_id" = c."pr_card_id"
    ) card_membership ON TRUE
    LEFT JOIN LATERAL (
      SELECT COUNT(DISTINCT "study_id") AS study_count,
             (array_agg(DISTINCT "study_id" ORDER BY "study_id"))[1] AS study_id
      FROM "study_participant" WHERE "reviewer_id" = c."participant_id"
    ) participant_membership ON TRUE
    WHERE card_membership.study_count <> 1
       OR participant_membership.study_count <> 1
       OR card_membership.study_id <> participant_membership.study_id
    UNION ALL
    SELECT d."pr_card_id"
    FROM "pr_discard" d
    LEFT JOIN LATERAL (
      SELECT COUNT(DISTINCT "study_id") AS study_count,
             (array_agg(DISTINCT "study_id" ORDER BY "study_id"))[1] AS study_id
      FROM "study_card" WHERE "pr_card_id" = d."pr_card_id"
    ) card_membership ON TRUE
    LEFT JOIN LATERAL (
      SELECT COUNT(DISTINCT "study_id") AS study_count,
             (array_agg(DISTINCT "study_id" ORDER BY "study_id"))[1] AS study_id
      FROM "study_participant" WHERE "reviewer_id" = d."participant_id"
    ) participant_membership ON TRUE
    WHERE card_membership.study_count <> 1
       OR participant_membership.study_count <> 1
       OR card_membership.study_id <> participant_membership.study_id
  ) conflicts;

  IF conflict_count > 0 THEN
    RAISE EXCEPTION 'Cannot backfill study_id: % decision rows have missing or ambiguous study membership', conflict_count;
  END IF;
END
$$;

UPDATE "pr_classification" c
SET "study_id" = membership."study_id"
FROM (
  SELECT sc."pr_card_id", sp."reviewer_id",
         (array_agg(sc."study_id" ORDER BY sc."study_id"))[1] AS "study_id"
  FROM "study_card" sc
  JOIN "study_participant" sp ON sp."study_id" = sc."study_id"
  GROUP BY sc."pr_card_id", sp."reviewer_id"
) membership
WHERE c."pr_card_id" = membership."pr_card_id"
  AND c."participant_id" = membership."reviewer_id"
  AND c."study_id" IS NULL;

UPDATE "pr_discard" d
SET "study_id" = membership."study_id"
FROM (
  SELECT sc."pr_card_id", sp."reviewer_id",
         (array_agg(sc."study_id" ORDER BY sc."study_id"))[1] AS "study_id"
  FROM "study_card" sc
  JOIN "study_participant" sp ON sp."study_id" = sc."study_id"
  GROUP BY sc."pr_card_id", sp."reviewer_id"
) membership
WHERE d."pr_card_id" = membership."pr_card_id"
  AND d."participant_id" = membership."reviewer_id"
  AND d."study_id" IS NULL;

ALTER TABLE "pr_classification"
  ALTER COLUMN "study_id" SET NOT NULL;
ALTER TABLE "pr_discard"
  ALTER COLUMN "study_id" SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pr_classification_study_card_fk') THEN
    ALTER TABLE "pr_classification"
      ADD CONSTRAINT "pr_classification_study_card_fk"
      FOREIGN KEY ("study_id", "pr_card_id") REFERENCES "study_card" ("study_id", "pr_card_id");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pr_classification_study_participant_fk') THEN
    ALTER TABLE "pr_classification"
      ADD CONSTRAINT "pr_classification_study_participant_fk"
      FOREIGN KEY ("study_id", "participant_id") REFERENCES "study_participant" ("study_id", "reviewer_id");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pr_classification_enrichment_run_card_fk') THEN
    ALTER TABLE "pr_classification"
      ADD CONSTRAINT "pr_classification_enrichment_run_card_fk"
      FOREIGN KEY ("enrichment_run_id", "study_id", "pr_card_id")
      REFERENCES "github_enrichment_run_card" ("run_id", "study_id", "pr_card_id");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pr_discard_study_card_fk') THEN
    ALTER TABLE "pr_discard"
      ADD CONSTRAINT "pr_discard_study_card_fk"
      FOREIGN KEY ("study_id", "pr_card_id") REFERENCES "study_card" ("study_id", "pr_card_id");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pr_discard_study_participant_fk') THEN
    ALTER TABLE "pr_discard"
      ADD CONSTRAINT "pr_discard_study_participant_fk"
      FOREIGN KEY ("study_id", "participant_id") REFERENCES "study_participant" ("study_id", "reviewer_id");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pr_discard_enrichment_run_card_fk') THEN
    ALTER TABLE "pr_discard"
      ADD CONSTRAINT "pr_discard_enrichment_run_card_fk"
      FOREIGN KEY ("enrichment_run_id", "study_id", "pr_card_id")
      REFERENCES "github_enrichment_run_card" ("run_id", "study_id", "pr_card_id");
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION "github_reject_terminal_run_mutation"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD."state" IN ('COMPLETED', 'FAILED') THEN
    RAISE EXCEPTION 'Terminal GitHub enrichment runs are immutable';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END
$$;

CREATE OR REPLACE FUNCTION "github_reject_terminal_child_mutation"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "github_enrichment_run"
    WHERE "id" = COALESCE(NEW."run_id", OLD."run_id")
      AND "state" IN ('COMPLETED', 'FAILED')
  ) THEN
    RAISE EXCEPTION 'Pages and run mappings of terminal GitHub enrichment runs are immutable';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END
$$;

CREATE OR REPLACE FUNCTION "github_reject_snapshot_mutation"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'GitHub card snapshots are immutable';
END
$$;

CREATE OR REPLACE FUNCTION "github_validate_promotion"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  expected_count INTEGER;
  run_state TEXT;
  run_checksum TEXT;
  study_checksum TEXT;
  mapped_count INTEGER;
BEGIN
  SELECT "state", "source_checksum" INTO run_state, run_checksum
  FROM "github_enrichment_run"
  WHERE "id" = NEW."run_id" AND "study_id" = NEW."study_id";
  IF run_state IS DISTINCT FROM 'COMPLETED' THEN
    RAISE EXCEPTION 'Only COMPLETED GitHub enrichment runs can be promoted';
  END IF;
  IF run_checksum IS DISTINCT FROM NEW."source_checksum" THEN
    RAISE EXCEPTION 'Promotion source checksum does not match the run';
  END IF;
  SELECT "source_checksum" INTO study_checksum FROM "study" WHERE "id" = NEW."study_id";
  IF study_checksum IS DISTINCT FROM NEW."source_checksum" THEN
    RAISE EXCEPTION 'Promotion source checksum does not match the study';
  END IF;
  SELECT "expected_card_count" INTO expected_count FROM "study" WHERE "id" = NEW."study_id";
  SELECT COUNT(*) INTO mapped_count
  FROM "github_enrichment_run_card"
  WHERE "run_id" = NEW."run_id" AND "study_id" = NEW."study_id";
  IF mapped_count <> expected_count THEN
    RAISE EXCEPTION 'Promotion requires every study card to have a run snapshot';
  END IF;
  IF EXISTS (SELECT 1 FROM "pr_classification" WHERE "study_id" = NEW."study_id")
     OR EXISTS (SELECT 1 FROM "pr_discard" WHERE "study_id" = NEW."study_id") THEN
    RAISE EXCEPTION 'A study with decisions cannot receive an enrichment promotion';
  END IF;
  RETURN NEW;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'github_enrichment_run_immutable') THEN
    CREATE TRIGGER "github_enrichment_run_immutable"
      BEFORE UPDATE OR DELETE ON "github_enrichment_run"
      FOR EACH ROW EXECUTE FUNCTION "github_reject_terminal_run_mutation"();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'github_run_page_terminal_immutable') THEN
    CREATE TRIGGER "github_run_page_terminal_immutable"
      BEFORE INSERT OR UPDATE OR DELETE ON "github_run_page"
      FOR EACH ROW EXECUTE FUNCTION "github_reject_terminal_child_mutation"();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'github_run_card_terminal_immutable') THEN
    CREATE TRIGGER "github_run_card_terminal_immutable"
      BEFORE INSERT OR UPDATE OR DELETE ON "github_enrichment_run_card"
      FOR EACH ROW EXECUTE FUNCTION "github_reject_terminal_child_mutation"();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'github_card_snapshot_immutable') THEN
    CREATE TRIGGER "github_card_snapshot_immutable"
      BEFORE UPDATE OR DELETE ON "github_card_snapshot"
      FOR EACH ROW EXECUTE FUNCTION "github_reject_snapshot_mutation"();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'study_enrichment_promotion_immutable') THEN
    CREATE TRIGGER "study_enrichment_promotion_immutable"
      BEFORE UPDATE OR DELETE ON "study_enrichment_promotion"
      FOR EACH ROW EXECUTE FUNCTION "github_reject_snapshot_mutation"();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'study_enrichment_promotion_validate') THEN
    CREATE TRIGGER "study_enrichment_promotion_validate"
      BEFORE INSERT ON "study_enrichment_promotion"
      FOR EACH ROW EXECUTE FUNCTION "github_validate_promotion"();
  END IF;
END
$$;

INSERT INTO "labeler_migration" ("migration_id")
VALUES ('004_github_pr_api_enrichment')
ON CONFLICT ("migration_id") DO NOTHING;

COMMIT;
