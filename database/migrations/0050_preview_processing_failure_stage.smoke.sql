BEGIN;

DO $block$
DECLARE
  v_owner_id uuid := '11111111-1111-4111-8111-111111111111';
  v_definition text;
BEGIN
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
     OR v_definition NOT LIKE '%preview_staging_commit_failed%'
     OR v_definition NOT LIKE '%preview_finalization_failed%' THEN
    RAISE EXCEPTION 'sanitized preview failure reasons are not constrained';
  END IF;

  IF to_regprocedure(
    'dna.record_import_preview_processing_failure(uuid,uuid,uuid,text,character,timestamp with time zone,text)'
  ) IS NULL THEN
    RAISE EXCEPTION 'sanitized preview failure recorder is unavailable';
  END IF;

  IF NOT pg_catalog.has_function_privilege(
    'dna_app_runtime',
    'dna.record_import_preview_processing_failure(uuid,uuid,uuid,text,character,timestamp with time zone,text)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'runtime cannot record sanitized preview failure reasons';
  END IF;

  PERFORM pg_catalog.set_config('app.owner_id', v_owner_id::text, true);
  PERFORM dna.record_import_preview_processing_failure(
    v_owner_id,
    '22222222-2222-4222-8222-222222222222'::uuid,
    '33333333-3333-4333-8333-333333333333'::uuid,
    'preview-worker',
    repeat('a', 64)::character(64),
    '2026-08-24T00:00:00Z'::timestamptz,
    'preview_staging_commit_failed'
  );

  BEGIN
    PERFORM dna.record_import_preview_processing_failure(
      v_owner_id,
      '22222222-2222-4222-8222-222222222222'::uuid,
      '33333333-3333-4333-8333-333333333333'::uuid,
      'preview-worker',
      repeat('a', 64)::character(64),
      '2026-08-24T00:00:00Z'::timestamptz,
      'provider-private-detail'
    );
    RAISE EXCEPTION 'unsafe preview failure reason was accepted';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM <> 'preview processing failure reason is unsupported' THEN
        RAISE;
      END IF;
  END;
END
$block$;

ROLLBACK;
