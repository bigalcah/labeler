BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public."labeler_migration"
    WHERE "migration_id" = '007_local_accounts_sessions'
  ) THEN
    RAISE EXCEPTION 'Migration 007_local_accounts_sessions must be applied before 008_login_rate_limits';
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS "login_ip_attempt" (
  "ip_address" TEXT PRIMARY KEY,
  "attempt_count" INTEGER NOT NULL CHECK ("attempt_count" >= 1),
  "window_started_at" TIMESTAMPTZ NOT NULL
);

INSERT INTO "labeler_migration" ("migration_id")
VALUES ('008_login_rate_limits')
ON CONFLICT ("migration_id") DO NOTHING;

COMMIT;
