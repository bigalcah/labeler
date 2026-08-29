BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public."labeler_migration"
    WHERE "migration_id" = '004_github_pr_api_enrichment'
  ) THEN
    RAISE EXCEPTION 'Migration 004_github_pr_api_enrichment must be applied before 005_github_enrichment_checkpoints';
  END IF;
END
$$;

ALTER TABLE "github_enrichment_run"
  ADD COLUMN IF NOT EXISTS "checkpoint" JSONB,
  ADD COLUMN IF NOT EXISTS "quota_metadata" JSONB,
  ADD COLUMN IF NOT EXISTS "next_resume_at" TIMESTAMPTZ;

INSERT INTO "labeler_migration" ("migration_id")
VALUES ('005_github_enrichment_checkpoints')
ON CONFLICT ("migration_id") DO NOTHING;

COMMIT;
