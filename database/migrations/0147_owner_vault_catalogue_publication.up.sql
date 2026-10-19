BEGIN;

CREATE FUNCTION dna.read_owner_vault_catalogue_publication(p_owner_id uuid)
RETURNS TABLE (
  core_dataset_version_id uuid,
  import_batch_id uuid,
  source_sha256 character(64),
  source_row_count bigint,
  accepted_row_count bigint,
  core_count bigint,
  evidence_row_count bigint,
  activated_at timestamptz,
  data_current_through timestamptz,
  aggregate_refreshed_at timestamptz,
  evidence_sealed_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_owner_id uuid := dna.current_owner_id();
  v_version dna.dataset_version%ROWTYPE;
  v_batch dna.import_batch%ROWTYPE;
  -- Evidence receipts are installed by a separately managed migration in some
  -- isolated CI paths, so defer relation binding until function execution.
  v_receipt record;
  v_core_count bigint;
  v_source_batch_count bigint;
  v_mismatched_source_batch_count bigint;
BEGIN
  IF v_owner_id IS NULL OR p_owner_id <> v_owner_id THEN
    RAISE EXCEPTION 'owner-scoped Vault catalogue publication read denied';
  END IF;

  SELECT version.* INTO v_version
  FROM dna.dataset_version version
  WHERE version.owner_id = p_owner_id
    AND version.source_type = 'core_details'
    AND version.is_active
    AND version.rolled_back_at IS NULL;

  IF NOT FOUND OR v_version.aggregate_refreshed_at IS NULL THEN
    RAISE EXCEPTION 'active accepted Core Details version is unavailable';
  END IF;

  SELECT batch.* INTO v_batch
  FROM dna.import_batch batch
  WHERE batch.owner_id = p_owner_id
    AND batch.id = v_version.import_batch_id
    AND batch.source_type = 'core_details'
    AND batch.status = 'accepted';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'accepted Core Details source batch is unavailable';
  END IF;

  SELECT receipt.* INTO v_receipt
  FROM dna.dataset_version_evidence_receipt receipt
  WHERE receipt.owner_id = p_owner_id
    AND receipt.dataset_version_id = v_version.id
    AND receipt.import_batch_id = v_batch.id
    AND receipt.source_type = 'core_details';

  IF NOT FOUND OR v_receipt.evidence_row_count <> v_batch.source_rows THEN
    RAISE EXCEPTION 'sealed Core Details source evidence is unavailable';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM dna.aggregate_refresh_job job
    WHERE job.owner_id = p_owner_id
      AND job.dataset_version_id = v_version.id
      AND job.status = 'completed'
      AND job.completed_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Core Details aggregate refresh is incomplete';
  END IF;

  SELECT count(*)::bigint,
    count(DISTINCT core.source_import_batch_id)::bigint,
    count(*) FILTER (
      WHERE core.source_import_batch_id IS DISTINCT FROM v_batch.id
    )::bigint
  INTO v_core_count, v_source_batch_count,
    v_mismatched_source_batch_count
  FROM dna.active_core_details core
  WHERE core.owner_id = p_owner_id;

  IF v_core_count <> v_batch.accepted_rows
     OR (v_core_count > 0 AND (
       v_source_batch_count <> 1
       OR v_mismatched_source_batch_count <> 0
     )) THEN
    RAISE EXCEPTION 'active Core Details catalogue does not match accepted source';
  END IF;

  RETURN QUERY SELECT
    v_version.id, v_batch.id, v_batch.checksum_sha256,
    v_batch.source_rows, v_batch.accepted_rows, v_core_count,
    v_receipt.evidence_row_count, v_version.activated_at,
    v_version.data_current_through, v_version.aggregate_refreshed_at,
    v_receipt.sealed_at;
END
$function$;

REVOKE ALL ON FUNCTION dna.read_owner_vault_catalogue_publication(uuid)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION dna.read_owner_vault_catalogue_publication(uuid)
  TO dna_app_runtime;

COMMIT;
