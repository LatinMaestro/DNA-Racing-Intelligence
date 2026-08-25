BEGIN;

ALTER FUNCTION dna.prepare_pro_league_aggregate_refresh(
  uuid, uuid, uuid, character
) RENAME TO prepare_pro_league_aggregate_refresh_pre_archive_collapse;

CREATE FUNCTION dna.prepare_pro_league_aggregate_refresh(
  p_owner_id uuid,
  p_refresh_id uuid,
  p_dataset_version_id uuid,
  p_source_version_set_sha256 character(64)
)
RETURNS TABLE (
  prepared_aggregate_set_id uuid,
  source_version_set_sha256 character(64),
  aggregate_family_count integer,
  materialized_row_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_source_type text;
  v_target_version_number bigint;
  v_result record;
  v_receipt dna.race_archive_aggregate_publication_receipt%ROWTYPE;
BEGIN
  SELECT version.source_type, version.version_number
  INTO v_source_type, v_target_version_number
  FROM dna.dataset_version version
  WHERE version.owner_id = p_owner_id
    AND version.id = p_dataset_version_id
    AND version.is_active
    AND version.rolled_back_at IS NULL;

  SELECT * INTO STRICT v_result
  FROM dna.prepare_pro_league_aggregate_refresh_pre_archive_collapse(
    p_owner_id,
    p_refresh_id,
    p_dataset_version_id,
    p_source_version_set_sha256
  );

  IF v_source_type = 'race_merge' THEN
    SELECT receipt.* INTO STRICT v_receipt
    FROM dna.race_archive_aggregate_publication_receipt receipt
    WHERE receipt.owner_id = p_owner_id
      AND receipt.refresh_id = p_refresh_id
      AND receipt.race_dataset_version_id = p_dataset_version_id
      AND receipt.source_version_set_sha256 = p_source_version_set_sha256;

    UPDATE dna.dataset_version version
    SET aggregate_refreshed_at = v_receipt.refreshed_at
    WHERE version.owner_id = p_owner_id
      AND version.source_type = 'race_merge'
      AND version.rolled_back_at IS NULL
      AND version.version_number <= v_target_version_number;

    UPDATE dna.aggregate_refresh_job job
    SET status = 'completed',
        started_at = COALESCE(job.started_at, v_receipt.refreshed_at),
        completed_at = COALESCE(job.completed_at, v_receipt.published_at),
        affected_record_count = v_receipt.materialized_row_count,
        failure_code = NULL
    FROM dna.dataset_version version
    WHERE version.owner_id = p_owner_id
      AND version.source_type = 'race_merge'
      AND version.rolled_back_at IS NULL
      AND version.version_number <= v_target_version_number
      AND job.owner_id = version.owner_id
      AND job.dataset_version_id = version.id
      AND job.status <> 'rolled_back';
  END IF;

  RETURN QUERY SELECT
    v_result.prepared_aggregate_set_id,
    v_result.source_version_set_sha256,
    v_result.aggregate_family_count,
    v_result.materialized_row_count;
END
$function$;

REVOKE ALL ON FUNCTION dna.prepare_pro_league_aggregate_refresh(
  uuid, uuid, uuid, character
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION dna.prepare_pro_league_aggregate_refresh(
  uuid, uuid, uuid, character
) TO dna_app_runtime;

COMMIT;
