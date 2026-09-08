BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public."labeler_migration"
    WHERE "migration_id" = '001_study_foundation'
  ) THEN
    RAISE EXCEPTION 'Migration 001_study_foundation must be applied before 003_private_pr_discard';
  END IF;
END
$$;

ALTER TABLE "pr_classification"
  ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1
  CHECK ("revision" >= 1);

CREATE TABLE "pr_discard" (
  "pr_card_id" UUID NOT NULL REFERENCES "pr_cards" ("id"),
  "participant_id" INTEGER NOT NULL REFERENCES "reviewer" ("id"),
  "reason" TEXT,
  "discarded_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY ("pr_card_id", "participant_id")
);

CREATE INDEX "pr_discard_participant_discarded_idx"
  ON "pr_discard" ("participant_id", "discarded_at");

CREATE UNIQUE INDEX "study_ready_uidx"
  ON "study" (("bootstrap_state"))
  WHERE "bootstrap_state" = 'READY';

INSERT INTO "labeler_migration" ("migration_id")
VALUES ('003_private_pr_discard');

COMMIT;
