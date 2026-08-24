BEGIN;

DO $post_aggregate_compaction_guard$
BEGIN
  IF EXISTS (
    SELECT 1 FROM dna.race_row_evidence_compaction_receipt
  ) THEN
    RAISE EXCEPTION
      'cannot reverse post-aggregate evidence compaction after durable Race Merge compaction receipts exist';
  END IF;
END
$post_aggregate_compaction_guard$;

CREATE OR REPLACE FUNCTION dna.publish_pro_league_aggregate_refresh(
  p_owner_id uuid,
  p_refresh_id uuid,
  p_dataset_version_id uuid,
  p_worker_id text,
  p_prepared_aggregate_set_id uuid,
  p_source_version_set_sha256 character(64),
  p_aggregate_family_count integer,
  p_materialized_row_count bigint,
  p_completed_at timestamptz
)
RETURNS TABLE (status text, aggregate_set_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_current_hash character(64);
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped aggregate publication denied';
  END IF;
  IF p_prepared_aggregate_set_id <> p_refresh_id OR p_aggregate_family_count <> 4 THEN
    RAISE EXCEPTION 'prepared aggregate evidence is invalid';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM dna.aggregate_refresh_processing processing
    WHERE processing.owner_id = p_owner_id
      AND processing.refresh_id = p_refresh_id
      AND processing.dataset_version_id = p_dataset_version_id
      AND processing.worker_id = p_worker_id
      AND processing.state = 'processing'
      AND processing.source_version_set_sha256 = p_source_version_set_sha256
  ) OR NOT EXISTS (
    SELECT 1 FROM dna.aggregate_refresh_job job
    WHERE job.owner_id = p_owner_id AND job.id = p_refresh_id
      AND job.dataset_version_id = p_dataset_version_id
      AND job.status = 'completed'
      AND job.affected_record_count = p_materialized_row_count
  ) THEN
    RAISE EXCEPTION 'prepared aggregate publication claim is unavailable';
  END IF;

  v_current_hash := dna.active_pro_league_source_version_set_sha256(p_owner_id);
  IF v_current_hash <> p_source_version_set_sha256 THEN
    UPDATE dna.aggregate_refresh_processing
    SET state = 'failed', failure_reason = 'source_versions_superseded',
        failed_at = p_completed_at, published_at = NULL, updated_at = now()
    WHERE owner_id = p_owner_id AND refresh_id = p_refresh_id;
    UPDATE dna.aggregate_refresh_job
    SET status = 'failed', completed_at = NULL, affected_record_count = NULL,
        failure_code = 'source_version_set_superseded'
    WHERE owner_id = p_owner_id AND id = p_refresh_id;
    UPDATE dna.dataset_version
    SET aggregate_refreshed_at = NULL
    WHERE owner_id = p_owner_id AND id = p_dataset_version_id;
    RETURN QUERY SELECT 'superseded'::text, NULL::uuid;
    RETURN;
  END IF;

  UPDATE dna.aggregate_refresh_processing
  SET state = 'published', published_at = p_completed_at,
      failure_reason = NULL, failed_at = NULL, updated_at = now()
  WHERE owner_id = p_owner_id AND refresh_id = p_refresh_id;
  RETURN QUERY SELECT 'published'::text, p_refresh_id;
END
$function$;

REVOKE ALL ON FUNCTION dna.publish_pro_league_aggregate_refresh(
  uuid, uuid, uuid, text, uuid, character, integer, bigint, timestamptz
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION dna.publish_pro_league_aggregate_refresh(
  uuid, uuid, uuid, text, uuid, character, integer, bigint, timestamptz
) TO dna_app_runtime;

COMMIT;
