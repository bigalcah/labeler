BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public."labeler_migration"
    WHERE "migration_id" = '005_github_enrichment_checkpoints'
  ) THEN
    RAISE EXCEPTION 'Migration 005_github_enrichment_checkpoints must be applied before 006_github_api_telemetry';
  END IF;
END
$$;

ALTER TABLE "github_enrichment_run"
  ADD COLUMN IF NOT EXISTS "attempt_telemetry_version" SMALLINT;

CREATE TABLE IF NOT EXISTS "github_api_telemetry_event" (
  "event_id" UUID PRIMARY KEY,
  "event_type" TEXT NOT NULL CHECK ("event_type" IN ('ATTEMPT_STARTED', 'ATTEMPT_FINISHED', 'PAUSE_COMMITTED', 'RESUME_STARTED')),
  "run_id" UUID NOT NULL,
  "study_id" UUID NOT NULL,
  "execution_id" UUID,
  "pr_card_id" UUID,
  "attempt_id" UUID,
  "endpoint" TEXT,
  "page_ordinal" INTEGER CHECK ("page_ordinal" IS NULL OR "page_ordinal" >= 0),
  "attempt_number" INTEGER CHECK ("attempt_number" IS NULL OR "attempt_number" > 0),
  "fingerprint" TEXT,
  "occurred_at" TIMESTAMPTZ NOT NULL,
  "recorded_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "duration_ms" INTEGER CHECK ("duration_ms" IS NULL OR "duration_ms" >= 0),
  "classification" TEXT CHECK ("classification" IS NULL OR "classification" IN ('SUCCESS', 'NOT_MODIFIED', 'RATE_LIMIT', 'RETRYABLE_HTTP', 'TERMINAL_HTTP', 'TRANSPORT_ERROR', 'TIMEOUT')),
  "decision" TEXT CHECK ("decision" IS NULL OR "decision" IN ('ACCEPT', 'RETRY', 'PAUSE', 'UNAVAILABLE', 'FAIL')),
  "http_status" INTEGER CHECK ("http_status" IS NULL OR "http_status" BETWEEN 100 AND 599),
  "error_code" TEXT,
  "rate_limit_type" TEXT CHECK ("rate_limit_type" IS NULL OR "rate_limit_type" IN ('PRIMARY', 'SECONDARY', 'UNSPECIFIED')),
  "quota_remaining" INTEGER CHECK ("quota_remaining" IS NULL OR "quota_remaining" >= 0),
  "quota_reset_at" TIMESTAMPTZ,
  "retry_after_ms" INTEGER CHECK ("retry_after_ms" IS NULL OR "retry_after_ms" >= 0),
  "effective_retry_at" TIMESTAMPTZ,
  "retry_source" TEXT CHECK ("retry_source" IS NULL OR "retry_source" IN ('RETRY_AFTER', 'RESET', 'FALLBACK_RATE_LIMIT', 'BACKOFF')),
  "wait_source" TEXT CHECK ("wait_source" IS NULL OR "wait_source" IN ('RETRY_AFTER', 'RESET', 'FALLBACK', 'BACKOFF')),
  "scheduled_wait_ms" INTEGER CHECK ("scheduled_wait_ms" IS NULL OR "scheduled_wait_ms" >= 0),
  "request_id" TEXT,
  "pause_reason" TEXT,
  "causal_event_id" UUID,
  "checkpoint" JSONB,
  FOREIGN KEY ("run_id", "study_id") REFERENCES "github_enrichment_run" ("id", "study_id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "github_api_telemetry_attempt_type_uidx"
  ON "github_api_telemetry_event" ("attempt_id", "event_type")
  WHERE "attempt_id" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "github_api_telemetry_run_idx"
  ON "github_api_telemetry_event" ("run_id", "occurred_at");

CREATE OR REPLACE FUNCTION "github_reject_telemetry_mutation"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'GitHub API telemetry events are append-only';
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'github_api_telemetry_immutable') THEN
    CREATE TRIGGER "github_api_telemetry_immutable"
      BEFORE UPDATE OR DELETE ON "github_api_telemetry_event"
      FOR EACH ROW EXECUTE FUNCTION "github_reject_telemetry_mutation"();
  END IF;
END
$$;

INSERT INTO "labeler_migration" ("migration_id")
VALUES ('006_github_api_telemetry')
ON CONFLICT ("migration_id") DO NOTHING;

COMMIT;
