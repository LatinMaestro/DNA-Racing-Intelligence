BEGIN;

ALTER FUNCTION dna.prepare_pro_league_aggregate_refresh(
  uuid, uuid, uuid, character
) RENAME TO prepare_pro_league_aggregate_refresh_pre_archive_reuse;

REVOKE ALL ON FUNCTION dna.prepare_pro_league_aggregate_refresh_pre_archive_reuse(
  uuid, uuid, uuid, character
) FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.prepare_pro_league_aggregate_refresh_pre_archive_reuse(
  uuid, uuid, uuid, character
) FROM dna_app_runtime;

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
  v_target_version dna.dataset_version%ROWTYPE;
  v_active_race_version_id uuid;
  v_receipt dna.race_archive_aggregate_publication_receipt%ROWTYPE;
  v_performance_count bigint;
  v_discovery_count bigint;
  v_payout_count bigint;
  v_star_count bigint;
  v_completed_at timestamptz := statement_timestamp();
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped aggregate refresh denied';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM dna.aggregate_refresh_processing processing
    WHERE processing.owner_id = p_owner_id
      AND processing.refresh_id = p_refresh_id
      AND processing.dataset_version_id = p_dataset_version_id
      AND processing.state = 'processing'
      AND processing.source_version_set_sha256 = p_source_version_set_sha256
  ) THEN
    RAISE EXCEPTION 'aggregate refresh claim is unavailable';
  END IF;
  IF dna.active_pro_league_source_version_set_sha256(p_owner_id)
       <> p_source_version_set_sha256 THEN
    RAISE EXCEPTION 'aggregate refresh source versions were superseded';
  END IF;

  SELECT version.* INTO v_target_version
  FROM dna.dataset_version version
  WHERE version.owner_id = p_owner_id
    AND version.id = p_dataset_version_id
    AND version.is_active
    AND version.rolled_back_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'active aggregate target version is unavailable';
  END IF;

  IF v_target_version.source_type = 'race_merge' THEN
    RETURN QUERY
    SELECT legacy.prepared_aggregate_set_id,
      legacy.source_version_set_sha256,
      legacy.aggregate_family_count,
      legacy.materialized_row_count
    FROM dna.prepare_pro_league_aggregate_refresh_pre_archive_reuse(
      p_owner_id,
      p_refresh_id,
      p_dataset_version_id,
      p_source_version_set_sha256
    ) legacy;
    RETURN;
  END IF;

  IF v_target_version.source_type NOT IN ('core_details', 'current_arena') THEN
    RAISE EXCEPTION 'aggregate target source type is not supported';
  END IF;

  SELECT version.id INTO v_active_race_version_id
  FROM dna.dataset_version version
  WHERE version.owner_id = p_owner_id
    AND version.source_type = 'race_merge'
    AND version.is_active
    AND version.rolled_back_at IS NULL
  FOR SHARE;

  IF v_active_race_version_id IS NULL THEN
    RAISE EXCEPTION 'active owner-scoped Race Merge version does not exist';
  END IF;

  SELECT receipt.* INTO v_receipt
  FROM dna.race_archive_aggregate_publication_receipt receipt
  WHERE receipt.owner_id = p_owner_id
    AND receipt.race_dataset_version_id = v_active_race_version_id
  ORDER BY receipt.published_at DESC, receipt.refresh_id DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'current Race archive aggregate publication is unavailable';
  END IF;

  SELECT count(*)::bigint INTO v_performance_count
  FROM dna.core_performance_profile profile
  WHERE profile.owner_id = p_owner_id;
  SELECT count(*)::bigint INTO v_discovery_count
  FROM dna.discovery_exact_distance_benchmark benchmark
  WHERE benchmark.owner_id = p_owner_id;
  SELECT count(*)::bigint INTO v_payout_count
  FROM dna.core_payout_format_profile profile
  WHERE profile.owner_id = p_owner_id;
  SELECT count(*)::bigint INTO v_star_count
  FROM dna.core_star_profile profile
  WHERE profile.owner_id = p_owner_id;

  IF v_performance_count <> v_receipt.core_performance_profile_count
     OR v_discovery_count <> v_receipt.discovery_benchmark_count
     OR v_payout_count <> v_receipt.payout_format_profile_count
     OR v_star_count <> v_receipt.core_star_profile_count
     OR EXISTS (
       SELECT 1 FROM dna.core_performance_profile profile
       WHERE profile.owner_id = p_owner_id
         AND profile.refreshed_at <> v_receipt.refreshed_at
     )
     OR EXISTS (
       SELECT 1 FROM dna.discovery_exact_distance_benchmark benchmark
       WHERE benchmark.owner_id = p_owner_id
         AND benchmark.refreshed_at <> v_receipt.refreshed_at
     )
     OR EXISTS (
       SELECT 1 FROM dna.core_payout_format_profile profile
       WHERE profile.owner_id = p_owner_id
         AND profile.refreshed_at <> v_receipt.refreshed_at
     )
     OR EXISTS (
       SELECT 1 FROM dna.core_star_profile profile
       WHERE profile.owner_id = p_owner_id
         AND profile.refreshed_at <> v_receipt.refreshed_at
     ) THEN
    RAISE EXCEPTION 'current Race archive aggregate read models do not match their publication receipt';
  END IF;

  UPDATE dna.dataset_version
  SET aggregate_refreshed_at = v_completed_at
  WHERE owner_id = p_owner_id
    AND id = p_dataset_version_id
    AND is_active
    AND rolled_back_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'aggregate target version changed during archive reuse';
  END IF;

  UPDATE dna.aggregate_refresh_job
  SET status = 'completed',
      started_at = COALESCE(started_at, v_completed_at),
      completed_at = v_completed_at,
      affected_record_count = v_receipt.materialized_row_count,
      failure_code = NULL
  WHERE owner_id = p_owner_id
    AND id = p_refresh_id
    AND dataset_version_id = p_dataset_version_id
    AND status <> 'rolled_back';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'aggregate target job changed during archive reuse';
  END IF;

  RETURN QUERY SELECT
    p_refresh_id,
    p_source_version_set_sha256,
    4,
    v_receipt.materialized_row_count;
END
$function$;

REVOKE ALL ON FUNCTION dna.prepare_pro_league_aggregate_refresh(
  uuid, uuid, uuid, character
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION dna.prepare_pro_league_aggregate_refresh(
  uuid, uuid, uuid, character
) TO dna_app_runtime;

COMMENT ON FUNCTION dna.prepare_pro_league_aggregate_refresh(
  uuid, uuid, uuid, character
) IS
  'Prepares Pro League aggregates. Race Merge currently delegates to the legacy detailed-row refresher until archive reconstruction is wired. Rolling Core Details and Current Arena refreshes reuse the exact current Race archive publication and never erase race-derived analytics.';

COMMIT;