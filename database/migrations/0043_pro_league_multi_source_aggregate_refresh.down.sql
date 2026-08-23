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

  PERFORM pg_advisory_xact_lock(
    hashtextextended(v_owner_id::text || ':pro-league-aggregate-refresh', 0)
  );

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
  FROM dna.refresh_star_profiles(p_dataset_version_id, p_refreshed_at) result;

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

  UPDATE dna.aggregate_refresh_job
  SET affected_record_count = v_materialized_row_count
  WHERE
    owner_id = v_owner_id
    AND dataset_version_id = p_dataset_version_id
    AND status = 'completed';

  IF NOT FOUND THEN
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
