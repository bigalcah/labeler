DO $normalization$
DECLARE
  ids TEXT[];
  expected TEXT[] := ARRAY[
    '001_study_foundation', '003_private_pr_discard', '004_github_pr_api_enrichment',
    '005_github_enrichment_checkpoints', '006_github_api_telemetry', '007_local_accounts_sessions',
    '008_login_rate_limits', '009_csrf_contexts', '010_study_scoped_participant_categories',
    '011_multi_study_cardinality', '012_global_normalized_username', '013_category_definition_color',
    '014_copilot_369_cardinality'
  ];
  item RECORD;
  replacement OID;
  removable OID;
  extra_count INTEGER;
  has_fk BOOLEAN;
BEGIN
  IF current_setting('transaction_read_only') <> 'off'
     OR current_setting('session_replication_role') <> 'origin'
     OR EXISTS (SELECT 1 FROM pg_class WHERE relpersistence = 't')
     OR NOT EXISTS (
       SELECT 1 FROM pg_locks WHERE pid = pg_backend_pid() AND locktype = 'advisory'
         AND classid = 0 AND objid = hashtext('labeler:study-schema')::BIGINT::OID
         AND objsubid = 1 AND mode = 'ExclusiveLock' AND granted
     ) THEN
    RAISE EXCEPTION 'Normalization requires the locked, non-bypassed maintenance transaction';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_class relation JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public' AND relation.relkind IN ('r', 'p') AND NOT EXISTS (
      SELECT 1 FROM pg_locks WHERE pid = pg_backend_pid() AND locktype = 'relation'
        AND pg_locks.relation = relation.oid AND mode = 'AccessExclusiveLock' AND granted
    )
  ) THEN
    RAISE EXCEPTION 'Normalization requires all public tables locked before DDL';
  END IF;

  SELECT array_agg(migration_id ORDER BY applied_at, migration_id) INTO ids FROM public.labeler_migration;
  IF ids <> expected AND ids <> expected[1:1] || ARRAY['002_retire_legacy_labeler'] || expected[2:13] THEN
    RAISE EXCEPTION 'Normalization requires the exact ordered ledger through 014 without 015';
  END IF;
  IF ids IS NULL THEN
    RAISE EXCEPTION 'Normalization requires a complete ledger';
  END IF;

  SELECT count(*) INTO extra_count FROM pg_class relation JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
  WHERE namespace.nspname = 'public' AND relation.relname IN (
    'pr_classification_participant_id_updated_at_idx', 'study_card_pr_card_id_idx', 'study_participant_reviewer_id_idx'
  );
  SELECT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.participant_category'::regclass
    AND conname = 'participant_category_participant_id_fkey') INTO has_fk;
  IF NOT ((extra_count = 0 AND has_fk) OR (extra_count = 3 AND NOT has_fk
      AND '002_retire_legacy_labeler' = ANY(ids))) THEN
    RAISE EXCEPTION 'Unknown partial normalization source';
  END IF;

  IF EXISTS (SELECT 1 FROM public.participant_category category WHERE NOT EXISTS
      (SELECT 1 FROM public.reviewer reviewer WHERE reviewer.id = category.participant_id)) THEN
    RAISE EXCEPTION 'Orphan participant category; normalization never repairs data';
  END IF;

  FOR item IN SELECT * FROM (VALUES
    ('pr_classification', 'pr_classification_participant_id_updated_at_idx',
      'pr_classification_participant_updated_idx', 'participant_id, updated_at', 2),
    ('study_card', 'study_card_pr_card_id_idx', 'study_card_pr_card_idx', 'pr_card_id', 1),
    ('study_participant', 'study_participant_reviewer_id_idx', 'study_participant_reviewer_idx', 'reviewer_id', 1)
  ) indexes(table_name, removable_name, replacement_name, columns, dependency_count)
  LOOP
    replacement := to_regclass('public.' || quote_ident(item.replacement_name));
    IF replacement IS NULL OR NOT EXISTS (SELECT 1 FROM pg_index index WHERE index.indexrelid = replacement
        AND index.indrelid = to_regclass('public.' || item.table_name)
        AND index.indisvalid AND index.indisready AND index.indislive AND NOT index.indisreplident
        AND pg_get_indexdef(index.indexrelid) = format('CREATE INDEX %I ON public.%I USING btree (%s)',
          item.replacement_name, item.table_name, item.columns)) THEN
      RAISE EXCEPTION 'Canonical replacement index is not equivalent: %', item.replacement_name;
    END IF;
    IF extra_count = 3 THEN
      removable := to_regclass('public.' || quote_ident(item.removable_name));
      IF NOT EXISTS (SELECT 1 FROM pg_index index WHERE index.indexrelid = removable
          AND index.indrelid = to_regclass('public.' || item.table_name)
          AND index.indisvalid AND index.indisready AND index.indislive AND NOT index.indisreplident
          AND pg_get_indexdef(index.indexrelid) = format('CREATE INDEX %I ON public.%I USING btree (%s)',
            item.removable_name, item.table_name, item.columns))
          OR EXISTS (SELECT 1 FROM pg_depend WHERE refclassid = 'pg_class'::regclass AND refobjid = removable)
          OR (SELECT count(*) FROM pg_depend WHERE classid = 'pg_class'::regclass AND objid = removable) <> item.dependency_count
          OR EXISTS (SELECT 1 FROM pg_depend dependency WHERE dependency.classid = 'pg_class'::regclass
            AND dependency.objid = removable AND (dependency.deptype <> 'a'
              OR dependency.refclassid <> 'pg_class'::regclass
              OR dependency.refobjid <> to_regclass('public.' || item.table_name)
              OR NOT EXISTS (SELECT 1 FROM pg_attribute attribute WHERE attribute.attrelid = dependency.refobjid
                AND attribute.attnum = dependency.refobjsubid AND attribute.attname = ANY(string_to_array(item.columns, ', '))))) THEN
        RAISE EXCEPTION 'Unexpected removable index definition or dependency: %', item.removable_name;
      END IF;
    END IF;
  END LOOP;

  IF extra_count = 3 THEN
    ALTER TABLE public.participant_category ADD CONSTRAINT participant_category_participant_id_fkey
      FOREIGN KEY (participant_id) REFERENCES public.reviewer(id) NOT DEFERRABLE;
    ALTER TABLE public.participant_category VALIDATE CONSTRAINT participant_category_participant_id_fkey;
    DROP INDEX public.pr_classification_participant_id_updated_at_idx;
    DROP INDEX public.study_card_pr_card_id_idx;
    DROP INDEX public.study_participant_reviewer_id_idx;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.participant_category'::regclass
      AND conname = 'participant_category_participant_id_fkey' AND contype = 'f' AND convalidated
      AND NOT condeferrable AND NOT condeferred
      AND pg_get_constraintdef(oid, true) = 'FOREIGN KEY (participant_id) REFERENCES reviewer(id)') THEN
    RAISE EXCEPTION 'Normalized FK is not the validated canonical nondeferrable FK';
  END IF;
END
$normalization$;
