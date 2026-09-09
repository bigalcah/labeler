BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public."labeler_migration"
    WHERE "migration_id" = '008_login_rate_limits'
  ) THEN
    RAISE EXCEPTION 'Migration 008_login_rate_limits must be applied before 009_csrf_contexts';
  END IF;
END
$$;

ALTER TABLE "app_session"
  ADD COLUMN IF NOT EXISTS "csrf_token" TEXT;

UPDATE "app_session"
SET "csrf_token" = rtrim(replace(replace(encode(gen_random_bytes(32), 'base64'), '+', '-'), '/', '_'), '=')
WHERE "csrf_token" IS NULL;

ALTER TABLE "app_session"
  ALTER COLUMN "csrf_token" SET NOT NULL;

CREATE TABLE IF NOT EXISTS "login_csrf_context" (
  "context_id" TEXT PRIMARY KEY,
  "token" TEXT NOT NULL,
  "expires_at" TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS "login_csrf_context_expiry_idx"
  ON "login_csrf_context" ("expires_at");

INSERT INTO "labeler_migration" ("migration_id")
VALUES ('009_csrf_contexts')
ON CONFLICT ("migration_id") DO NOTHING;

COMMIT;
