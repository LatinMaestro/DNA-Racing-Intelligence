DO $block$
DECLARE
  v_definition text;
BEGIN
  IF to_regprocedure(
    'dna.record_import_preview_processing_failure(uuid,uuid,uuid,text,character,timestamp with time zone,text)'
  ) IS NOT NULL THEN
    RAISE EXCEPTION 'sanitized preview failure recorder still exists';
  END IF;

  SELECT pg_catalog.pg_get_constraintdef(constraint_row.oid)
  INTO v_definition
  FROM pg_catalog.pg_constraint constraint_row
  JOIN pg_catalog.pg_class relation_row
    ON relation_row.oid = constraint_row.conrelid
  JOIN pg_catalog.pg_namespace namespace_row
    ON namespace_row.oid = relation_row.relnamespace
  WHERE namespace_row.nspname = 'dna'
    AND relation_row.relname = 'import_preview_processing'
    AND constraint_row.conname =
      'import_preview_processing_failure_reason_check';

  IF v_definition IS NULL
     OR v_definition NOT LIKE '%preview_processor_failed%'
     OR v_definition LIKE '%preview_staging_commit_failed%' THEN
    RAISE EXCEPTION 'preview failure-reason constraint was not restored';
  END IF;
END
$block$;
