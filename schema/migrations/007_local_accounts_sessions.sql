BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public."labeler_migration"
    WHERE "migration_id" = '006_github_api_telemetry'
  ) THEN
    RAISE EXCEPTION 'Migration 006_github_api_telemetry must be applied before 007_local_accounts_sessions';
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS "participant_account" (
  "id" UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  "study_id" UUID NOT NULL,
  "reviewer_id" INTEGER NOT NULL,
  "normalized_username" TEXT NOT NULL,
  "password_hash" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT TRUE,
  "credential_version" INTEGER NOT NULL DEFAULT 1 CHECK ("credential_version" >= 1),
  "failed_login_attempts" INTEGER NOT NULL DEFAULT 0 CHECK ("failed_login_attempts" >= 0),
  "failed_login_window_started_at" TIMESTAMPTZ,
  "locked_until" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE ("study_id", "reviewer_id"),
  UNIQUE ("study_id", "normalized_username"),
  UNIQUE ("id", "study_id", "reviewer_id"),
  FOREIGN KEY ("study_id", "reviewer_id")
    REFERENCES "study_participant" ("study_id", "reviewer_id")
);

CREATE TABLE IF NOT EXISTS "app_session" (
  "session_id" TEXT PRIMARY KEY,
  "account_id" UUID NOT NULL,
  "study_id" UUID NOT NULL,
  "reviewer_id" INTEGER NOT NULL,
  "credential_version" INTEGER NOT NULL CHECK ("credential_version" >= 1),
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "last_activity_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "expires_at" TIMESTAMPTZ NOT NULL,
  "absolute_expires_at" TIMESTAMPTZ NOT NULL,
  CHECK ("expires_at" <= "absolute_expires_at"),
  FOREIGN KEY ("study_id", "reviewer_id")
    REFERENCES "study_participant" ("study_id", "reviewer_id"),
  FOREIGN KEY ("account_id", "study_id", "reviewer_id")
    REFERENCES "participant_account" ("id", "study_id", "reviewer_id")
);

CREATE INDEX IF NOT EXISTS "app_session_expiry_idx"
  ON "app_session" ("expires_at");
CREATE INDEX IF NOT EXISTS "app_session_account_membership_idx"
  ON "app_session" ("account_id", "study_id", "reviewer_id", "credential_version");

INSERT INTO "labeler_migration" ("migration_id")
VALUES ('007_local_accounts_sessions')
ON CONFLICT ("migration_id") DO NOTHING;

COMMIT;
