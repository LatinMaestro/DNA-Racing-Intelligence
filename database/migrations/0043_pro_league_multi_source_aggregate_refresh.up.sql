BEGIN;

CREATE OR REPLACE FUNCTION dna.refresh_pro_league_aggregates(
  p_dataset_version_id uuid,
  p_refreshed_at timestamptz
)
RETURNS TABLE (
  normalized_entry_count bigint,
  performance_profile_count bigint,
  validated_event_count bigint,
  star_profile_count bigint,
  discovery_benchmark_count bigint,
  accepted_format_entry_count bigint,
  payout_format_profile_count bigint,
  materialized_row_count bigint
)
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_owner_id uuid := dna.current_owner_id();
  v_target_version dna.dataset_version%ROWTYPE;
  v_active_race_version_id uuid;
  v_normalized_entry_count bigint;
  v_performance_profile_count bigint;
  v_validated_event_count bigint;
  v_star_profile_count bigint;
  v_discovery_benchmark_count bigint;
  v_accepted_format_entry_count bigint;
  v_payout_format_profile_count bigint;
  v_materialized_row_count bigint;
BEGIN
  IF v_owner_id IS NULL THEN
    RAISE EXCEPTION 'app.owner_id must be set for Pro League aggregate refresh';
  END IF;
  IF p_refreshed_at IS NULL THEN
    RAISE EXCEPTION 'Pro League aggregate refresh timestamp is required';
  END IF;

  SELECT version.*
  INTO v_target_version
  FROM dna.dataset_version version
  WHERE version.owner_id = v_owner_id
    AND version.id = p_dataset_version_id
    AND version.rolled_back_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'owner-scoped aggregate target version does not exist';
  END IF;
  IF p_refreshed_at < v_target_version.activated_at THEN
    RAISE EXCEPTION 'aggregate refresh cannot predate dataset activation';
  END IF;

  SELECT version.id
  INTO v_active_race_version_id
  FROM dna.dataset_version version
  WHERE version.owner_id = v_owner_id
    AND version.source_type = 'race_merge'
    AND version.is_active
    AND version.rolled_back_at IS NULL
  FOR UPDATE;

  IF v_active_race_version_id IS NULL THEN
    RAISE EXCEPTION 'active owner-scoped Race Merge version does not exist';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(v_owner_id::text || ':pro-league-aggregate-refresh', 0)
  );

  UPDATE dna.aggregate_refresh_job
  SET status = 'running',
      started_at = COALESCE(started_at, p_refreshed_at),
      completed_at = NULL,
      affected_record_count = NULL,
      failure_code = NULL
  WHERE owner_id = v_owner_id
    AND dataset_version_id = p_dataset_version_id
    AND status IN ('queued', 'running', 'failed');

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pro League aggregate refresh target job is unavailable';
  END IF;

  SELECT
    result.normalized_entry_count,
    result.performance_profile_count
  INTO
    v_normalized_entry_count,
    v_performance_profile_count
  FROM dna.refresh_core_performance_profiles(p_refreshed_at) result;

  SELECT
    result.validated_event_count,
    result.refreshed_profile_count
  INTO
    v_validated_event_count,
    v_star_profile_count
  FROM dna.refresh_star_profiles(v_active_race_version_id, p_refreshed_at) result;

  SELECT dna.refresh_discovery_exact_distance_benchmarks(p_refreshed_at)
  INTO v_discovery_benchmark_count;

  SELECT
    result.accepted_format_entry_count,
    result.payout_format_profile_count
  INTO
    v_accepted_format_entry_count,
    v_payout_format_profile_count
  FROM dna.refresh_core_payout_format_profiles(p_refreshed_at) result;

  v_materialized_row_count :=
    v_performance_profile_count
    + v_validated_event_count
    + v_star_profile_count
    + v_discovery_benchmark_count
    + v_payout_format_profile_count;

  UPDATE dna.dataset_version
  SET aggregate_refreshed_at = p_refreshed_at
  WHERE owner_id = v_owner_id
    AND id IN (p_dataset_version_id, v_active_race_version_id)
    AND rolled_back_at IS NULL;

  UPDATE dna.aggregate_refresh_job
  SET status = 'completed',
      started_at = COALESCE(started_at, p_refreshed_at),
      completed_at = p_refreshed_at,
      affected_record_count = v_materialized_row_count,
      failure_code = NULL
  WHERE owner_id = v_owner_id
    AND dataset_version_id IN (
      p_dataset_version_id,
      v_active_race_version_id
    )
    AND status <> 'rolled_back';

  IF NOT EXISTS (
    SELECT 1
    FROM dna.aggregate_refresh_job job
    WHERE job.owner_id = v_owner_id
      AND job.dataset_version_id = p_dataset_version_id
      AND job.status = 'completed'
      AND job.affected_record_count = v_materialized_row_count
  ) THEN
    RAISE EXCEPTION 'Pro League aggregate refresh did not complete its owner-scoped job';
  END IF;

  RETURN QUERY SELECT
    v_normalized_entry_count,
    v_performance_profile_count,
    v_validated_event_count,
    v_star_profile_count,
    v_discovery_benchmark_count,
    v_accepted_format_entry_count,
    v_payout_format_profile_count,
    v_materialized_row_count;
END
$function$;

REVOKE ALL ON FUNCTION dna.refresh_pro_league_aggregates(uuid, timestamptz)
  FROM PUBLIC;

COMMIT;
