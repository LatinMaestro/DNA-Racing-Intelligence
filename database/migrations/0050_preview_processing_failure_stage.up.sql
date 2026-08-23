BEGIN;

DO $block$
DECLARE
  v_constraint_name text;
BEGIN
  SELECT constraint_row.conname INTO v_constraint_name
  FROM pg_catalog.pg_constraint constraint_row
  JOIN pg_catalog.pg_class relation_row
    ON relation_row.oid = constraint_row.conrelid
  JOIN pg_catalog.pg_namespace namespace_row
    ON namespace_row.oid = relation_row.relnamespace
  WHERE namespace_row.nspname = 'dna'
    AND relation_row.relname = 'import_preview_processing'
    AND constraint_row.contype = 'c'
    AND pg_catalog.pg_get_constraintdef(constraint_row.oid)
      LIKE '%failure_reason%'
  ORDER BY constraint_row.oid
  LIMIT 1;

  IF v_constraint_name IS NULL THEN
    RAISE EXCEPTION 'preview processing failure-reason constraint is unavailable';
  END IF;

  EXECUTE pg_catalog.format(
    'ALTER TABLE dna.import_preview_processing DROP CONSTRAINT %I',
    v_constraint_name
  );
END
$block$;

ALTER TABLE dna.import_preview_processing
  ADD CONSTRAINT import_preview_processing_failure_reason_check
  CHECK (
    failure_reason IS NULL OR failure_reason IN (
      'preview_processor_failed',
      'preview_object_store_failed',
      'preview_object_integrity_failed',
      'preview_staging_begin_failed',
      'preview_staging_write_failed',
      'preview_staging_commit_failed',
      'preview_finalization_failed'
    )
  );

CREATE FUNCTION dna.record_import_preview_processing_failure(
  p_owner_id uuid,
  p_upload_batch_id uuid,
  p_preview_dispatch_id uuid,
  p_worker_id text,
  p_upload_request_fingerprint_sha256 character(64),
  p_failed_at timestamptz,
  p_failure_reason text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped preview processing denied';
  END IF;
  IF p_failure_reason NOT IN (
    'preview_processor_failed',
    'preview_object_store_failed',
    'preview_object_integrity_failed',
    'preview_staging_begin_failed',
    'preview_staging_write_failed',
    'preview_staging_commit_failed',
    'preview_finalization_failed'
  ) THEN
    RAISE EXCEPTION 'preview processing failure reason is unsupported';
  END IF;

  UPDATE dna.import_preview_processing processing
  SET state = 'failed', failure_reason = p_failure_reason,
      failed_at = p_failed_at, completed_at = NULL, updated_at = now()
  WHERE processing.owner_id = p_owner_id
    AND processing.upload_batch_id = p_upload_batch_id
    AND processing.preview_dispatch_id = p_preview_dispatch_id
    AND processing.worker_id = p_worker_id
    AND processing.upload_request_fingerprint_sha256 =
      p_upload_request_fingerprint_sha256
    AND processing.state = 'processing';
END
$function$;

REVOKE ALL ON FUNCTION dna.record_import_preview_processing_failure(
  uuid, uuid, uuid, text, character, timestamptz, text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION dna.record_import_preview_processing_failure(
  uuid, uuid, uuid, text, character, timestamptz, text
) TO dna_app_runtime;

COMMIT;
