BEGIN;

SELECT pg_advisory_xact_lock(hashtext('labeler:retire-legacy-labeler'));

DO $$
DECLARE
  missing_protected TEXT;
  applied_count INTEGER;
BEGIN
  SELECT STRING_AGG(protected_table.name, ', ' ORDER BY protected_table.name)
  INTO missing_protected
  FROM (VALUES
    ('reviewer'),
    ('pr_cards'),
    ('study'),
    ('study_participant'),
    ('study_card'),
    ('participant_category'),
    ('pr_classification')
  ) AS protected_table(name)
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_class relation
    INNER JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relname = protected_table.name
      AND relation.relkind IN ('r', 'p')
  );

  IF missing_protected IS NOT NULL THEN
    RAISE EXCEPTION 'Retirement protected objects missing: %', missing_protected;
  END IF;

  IF to_regclass('public.labeler_migration') IS NULL THEN
    RAISE EXCEPTION 'Required migration ledger table is missing: labeler_migration';
  END IF;

  SELECT COUNT(*)
  INTO applied_count
  FROM public."labeler_migration"
  WHERE "migration_id" = '002_retire_legacy_labeler';

  IF applied_count > 0 THEN
    RAISE EXCEPTION 'Migration ledger already marks retirement applied';
  END IF;
END
$$;

DROP PROCEDURE public."conflict_resolution_review"(
  INTEGER,
  public."conflict"[],
  INTEGER[],
  BOOLEAN,
  TEXT
);
DROP PROCEDURE public."conflict_resolution_discard"(INTEGER, public."conflict"[], TEXT);
DROP PROCEDURE public."label_merge"(TEXT, TEXT);
DROP PROCEDURE public."label_rename"(TEXT, TEXT);
DROP PROCEDURE public."label_remove"(INTEGER);

DROP FUNCTION public."label_distribution_reviewer"(INTEGER);
DROP FUNCTION public."label_distribution_category"(INTEGER);
DROP FUNCTION public."instance_discard_details"(INTEGER);
DROP FUNCTION public."instance_review_details"(INTEGER);
DROP FUNCTION public."next_instance"(INTEGER);
DROP FUNCTION public."instance_review_bucket_threshold"();

DROP VIEW public."instance_review_conflict_resolution_export";
DROP VIEW public."instance_review_finished_export";
DROP VIEW public."instance_discard_export";
DROP VIEW public."instance_review_conflict";
DROP VIEW public."instance_review_conflict_label";
DROP VIEW public."instance_review_conflict_outcome";
DROP VIEW public."reviewer_progress";
DROP VIEW public."reviewer_discard_progress";
DROP VIEW public."reviewer_review_progress";
DROP VIEW public."instance_review_bucket_filled";
DROP VIEW public."instance_review_bucket";
DROP VIEW public."instance_review_finished";
DROP VIEW public."instance_review_candidate";
DROP VIEW public."categories";

DROP TABLE public."instance_review_label";
DROP TABLE public."instance_review_conflict_resolution";
DROP TABLE public."instance_discard";
DROP TABLE public."instance_review";
DROP TABLE public."label";
DROP TABLE public."instance";

DROP TYPE public."conflict";

INSERT INTO public."labeler_migration" ("migration_id")
VALUES ('002_retire_legacy_labeler');

COMMIT;
