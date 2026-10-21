BEGIN;

SET LOCAL search_path TO public, pg_catalog, pg_temp;
SET LOCAL lock_timeout = '2s';
SELECT pg_advisory_xact_lock(hashtext('labeler:study-schema'));
LOCK TABLE study, pr_cards, study_card, github_enrichment_run,
  github_run_page, github_enrichment_run_card IN EXCLUSIVE MODE NOWAIT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM labeler_migration WHERE migration_id = '014_copilot_369_cardinality') THEN
    RAISE EXCEPTION 'Migration 014_copilot_369_cardinality is required before history preservation';
  END IF;
  IF EXISTS (SELECT 1 FROM github_enrichment_run WHERE state = 'RUNNING') THEN
    RAISE EXCEPTION 'RUNNING enrichment blocks history maintenance';
  END IF;
  IF EXISTS (
    SELECT 1 FROM study_card member JOIN pr_cards card ON card.id = member.pr_card_id
    WHERE member.source_card_id IS DISTINCT FROM card.source_card_id
      OR member.source_checksum IS DISTINCT FROM card.content_checksum
      OR card.content_checksum IS NULL
  ) OR EXISTS (
    SELECT 1 FROM github_enrichment_run run JOIN study ON study.id = run.study_id
    WHERE run.source_checksum IS DISTINCT FROM study.source_checksum
  ) THEN
    RAISE EXCEPTION 'Unknown source membership or enrichment source blocks history maintenance';
  END IF;
END
$$;

CREATE TABLE study_card_reference (
  study_id UUID NOT NULL REFERENCES study(id),
  pr_card_id UUID NOT NULL REFERENCES pr_cards(id),
  PRIMARY KEY (study_id, pr_card_id)
);

CREATE TABLE study_source_membership (
  study_id UUID NOT NULL,
  source_checksum TEXT NOT NULL,
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  pr_card_id UUID NOT NULL,
  source_card_id TEXT NOT NULL,
  content_checksum TEXT NOT NULL,
  PRIMARY KEY (study_id, source_checksum, ordinal),
  UNIQUE (study_id, source_checksum, pr_card_id),
  UNIQUE (study_id, source_checksum, source_card_id),
  FOREIGN KEY (study_id, pr_card_id) REFERENCES study_card_reference(study_id, pr_card_id)
);

INSERT INTO study_card_reference(study_id, pr_card_id)
SELECT study_id, pr_card_id FROM study_card;
INSERT INTO study_source_membership(study_id, source_checksum, ordinal, pr_card_id, source_card_id, content_checksum)
SELECT member.study_id, study.source_checksum, member.ordinal, member.pr_card_id,
  member.source_card_id, member.source_checksum
FROM study_card member JOIN study ON study.id = member.study_id;

ALTER TABLE github_run_page ADD CONSTRAINT github_run_page_history_reference_fk
  FOREIGN KEY (study_id, pr_card_id) REFERENCES study_card_reference(study_id, pr_card_id);
ALTER TABLE github_enrichment_run_card ADD CONSTRAINT github_run_card_history_reference_fk
  FOREIGN KEY (study_id, pr_card_id) REFERENCES study_card_reference(study_id, pr_card_id);
ALTER TABLE github_run_page DROP CONSTRAINT github_run_page_study_id_pr_card_id_fkey;
ALTER TABLE github_enrichment_run_card DROP CONSTRAINT github_enrichment_run_card_study_id_pr_card_id_fkey;

CREATE FUNCTION reject_study_history_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Study source history is append-only';
END
$$;

CREATE TRIGGER study_card_reference_immutable BEFORE UPDATE OR DELETE ON study_card_reference
  FOR EACH ROW EXECUTE FUNCTION reject_study_history_mutation();
CREATE TRIGGER study_source_membership_immutable BEFORE UPDATE OR DELETE ON study_source_membership
  FOR EACH ROW EXECUTE FUNCTION reject_study_history_mutation();
CREATE TRIGGER study_card_reference_no_truncate BEFORE TRUNCATE ON study_card_reference
  FOR EACH STATEMENT EXECUTE FUNCTION reject_study_history_mutation();
CREATE TRIGGER study_source_membership_no_truncate BEFORE TRUNCATE ON study_source_membership
  FOR EACH STATEMENT EXECUTE FUNCTION reject_study_history_mutation();

CREATE FUNCTION validate_enrichment_source_membership()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND EXISTS (
    SELECT 1 FROM github_enrichment_run WHERE id = OLD.run_id AND state IN ('COMPLETED', 'FAILED')
  ) THEN
    RAISE EXCEPTION 'Terminal enrichment history is immutable';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM github_enrichment_run run JOIN study_source_membership member
      ON member.study_id = run.study_id AND member.source_checksum = run.source_checksum
    WHERE run.id = NEW.run_id AND run.study_id = NEW.study_id AND member.pr_card_id = NEW.pr_card_id
      AND (TG_TABLE_NAME <> 'github_enrichment_run_card' OR member.ordinal = (to_jsonb(NEW)->>'ordinal')::integer)
  ) THEN
    RAISE EXCEPTION 'Enrichment card does not belong to the run source membership';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER github_run_page_source_membership BEFORE INSERT OR UPDATE ON github_run_page
  FOR EACH ROW EXECUTE FUNCTION validate_enrichment_source_membership();
CREATE TRIGGER github_run_card_source_membership BEFORE INSERT OR UPDATE ON github_enrichment_run_card
  FOR EACH ROW EXECUTE FUNCTION validate_enrichment_source_membership();

INSERT INTO labeler_migration(migration_id) VALUES ('016_preserve_study_card_history');
COMMIT;
