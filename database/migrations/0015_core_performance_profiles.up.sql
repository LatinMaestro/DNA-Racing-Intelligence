BEGIN;

CREATE FUNCTION dna.elapsed_seconds_to_milliseconds(p_elapsed_seconds text)
RETURNS bigint
LANGUAGE plpgsql
IMMUTABLE
STRICT
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_seconds numeric;
  v_milliseconds numeric;
BEGIN
  IF p_elapsed_seconds !~ '^[0-9]+(\.[0-9]+)?$' THEN
    RAISE EXCEPTION 'elapsed seconds must be a positive decimal';
  END IF;
  v_seconds := p_elapsed_seconds::numeric;
  v_milliseconds := v_seconds * 1000;
  IF v_seconds <= 0
    OR v_milliseconds <> trunc(v_milliseconds)
    OR v_milliseconds > 9223372036854775807
  THEN
    RAISE EXCEPTION 'elapsed seconds cannot be represented as positive integer milliseconds';
  END IF;
  RETURN v_milliseconds::bigint;
END
$function$;

CREATE TABLE dna.core_performance_profile (
  owner_id uuid NOT NULL REFERENCES dna.app_owner(id) ON DELETE CASCADE,
  source_core_id text NOT NULL CHECK (NULLIF(btrim(source_core_id), '') IS NOT NULL),
  mode text NOT NULL CHECK (mode IN ('bike', 'car', 'horse')),
  distance integer NOT NULL CHECK (distance > 0),
  data_current_through timestamptz NOT NULL,
  race_count bigint NOT NULL CHECK (race_count > 0),
  best_milliseconds numeric NOT NULL CHECK (best_milliseconds > 0),
  median_milliseconds numeric NOT NULL CHECK (median_milliseconds > 0),
  mean_milliseconds numeric NOT NULL CHECK (mean_milliseconds > 0),
  trimmed_mean_milliseconds numeric NOT NULL CHECK (trimmed_mean_milliseconds > 0),
  standard_deviation_milliseconds numeric NOT NULL CHECK (standard_deviation_milliseconds >= 0),
  interquartile_range_milliseconds numeric NOT NULL CHECK (interquartile_range_milliseconds >= 0),
  best_metres_per_second numeric NOT NULL CHECK (best_metres_per_second > 0),
  median_metres_per_second numeric NOT NULL CHECK (median_metres_per_second > 0),
  refreshed_at timestamptz NOT NULL,
  PRIMARY KEY (owner_id, source_core_id, mode, distance)
);

CREATE INDEX core_performance_profile_owner_core
  ON dna.core_performance_profile(owner_id, source_core_id, mode, distance);

ALTER TABLE dna.core_performance_profile ENABLE ROW LEVEL SECURITY;
ALTER TABLE dna.core_performance_profile FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_isolation ON dna.core_performance_profile
  USING (owner_id = dna.current_owner_id())
  WITH CHECK (owner_id = dna.current_owner_id());

CREATE FUNCTION dna.refresh_core_performance_profiles(p_refreshed_at timestamptz)
RETURNS TABLE (
  normalized_entry_count bigint,
  performance_profile_count bigint
)
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_owner_id uuid := dna.current_owner_id();
  v_normalized_count bigint := 0;
  v_profile_count bigint := 0;
BEGIN
  IF v_owner_id IS NULL THEN
    RAISE EXCEPTION 'app.owner_id must be set for performance refresh';
  END IF;
  IF p_refreshed_at IS NULL THEN
    RAISE EXCEPTION 'performance refresh timestamp is required';
  END IF;

  WITH selected_source AS (
    SELECT DISTINCT ON (source.race_entry_id)
      source.race_entry_id,
      dna.elapsed_seconds_to_milliseconds(source.raw_elapsed_time) AS elapsed_milliseconds
    FROM dna.race_entry_source source
    JOIN dna.dataset_version version
      ON version.owner_id = source.owner_id
      AND version.import_batch_id = source.import_batch_id
      AND version.source_type = 'race_merge'
      AND version.rolled_back_at IS NULL
    WHERE
      source.owner_id = v_owner_id
      AND source.is_selected_fact
      AND source.raw_elapsed_time IS NOT NULL
    ORDER BY
      source.race_entry_id,
      version.version_number DESC,
      source.source_row_number DESC NULLS LAST,
      source.id DESC
  )
  UPDATE dna.race_entry entry
  SET
    elapsed_time_milliseconds = selected.elapsed_milliseconds,
    speed_microunits = round(
      event.distance::numeric
      / (selected.elapsed_milliseconds::numeric / 1000)
      * 1000000
    )::bigint,
    updated_at = p_refreshed_at
  FROM selected_source selected
  JOIN dna.race_event event
    ON event.owner_id = v_owner_id
    AND event.id = (
      SELECT candidate.race_event_id
      FROM dna.race_entry candidate
      WHERE candidate.owner_id = v_owner_id
        AND candidate.id = selected.race_entry_id
    )
  WHERE
    entry.owner_id = v_owner_id
    AND entry.id = selected.race_entry_id
    AND entry.active_in_dataset;

  GET DIAGNOSTICS v_normalized_count = ROW_COUNT;

  DELETE FROM dna.core_performance_profile WHERE owner_id = v_owner_id;

  WITH observations AS (
    SELECT
      entry.source_core_id,
      event.mode,
      event.distance,
      event.event_at,
      entry.elapsed_time_milliseconds::numeric AS elapsed_milliseconds,
      row_number() OVER (
        PARTITION BY entry.source_core_id, event.mode, event.distance
        ORDER BY entry.elapsed_time_milliseconds, event.event_at, entry.id
      ) AS elapsed_rank,
      count(*) OVER (
        PARTITION BY entry.source_core_id, event.mode, event.distance
      ) AS sample_count
    FROM dna.race_entry entry
    JOIN dna.race_event event
      ON event.owner_id = entry.owner_id
      AND event.id = entry.race_event_id
      AND event.active_in_dataset
    WHERE
      entry.owner_id = v_owner_id
      AND entry.active_in_dataset
      AND entry.elapsed_time_milliseconds IS NOT NULL
  ),
  aggregates AS (
    SELECT
      source_core_id,
      mode,
      distance,
      max(event_at) AS data_current_through,
      count(*)::bigint AS race_count,
      min(elapsed_milliseconds) AS best_milliseconds,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY elapsed_milliseconds) AS median_milliseconds,
      avg(elapsed_milliseconds) AS mean_milliseconds,
      COALESCE(
        avg(elapsed_milliseconds) FILTER (
          WHERE
            sample_count < 10
            OR (
              elapsed_rank > floor(sample_count * 0.1)
              AND elapsed_rank <= sample_count - floor(sample_count * 0.1)
            )
        ),
        avg(elapsed_milliseconds)
      ) AS trimmed_mean_milliseconds,
      stddev_pop(elapsed_milliseconds) AS standard_deviation_milliseconds,
      percentile_cont(0.75) WITHIN GROUP (ORDER BY elapsed_milliseconds)
        - percentile_cont(0.25) WITHIN GROUP (ORDER BY elapsed_milliseconds)
        AS interquartile_range_milliseconds
    FROM observations
    GROUP BY source_core_id, mode, distance
  )
  INSERT INTO dna.core_performance_profile (
    owner_id,
    source_core_id,
    mode,
    distance,
    data_current_through,
    race_count,
    best_milliseconds,
    median_milliseconds,
    mean_milliseconds,
    trimmed_mean_milliseconds,
    standard_deviation_milliseconds,
    interquartile_range_milliseconds,
    best_metres_per_second,
    median_metres_per_second,
    refreshed_at
  )
  SELECT
    v_owner_id,
    source_core_id,
    mode,
    distance,
    data_current_through,
    race_count,
    best_milliseconds,
    median_milliseconds,
    mean_milliseconds,
    trimmed_mean_milliseconds,
    standard_deviation_milliseconds,
    interquartile_range_milliseconds,
    distance::numeric / (best_milliseconds / 1000),
    distance::numeric / (median_milliseconds / 1000),
    p_refreshed_at
  FROM aggregates;

  GET DIAGNOSTICS v_profile_count = ROW_COUNT;
  RETURN QUERY SELECT v_normalized_count, v_profile_count;
END
$function$;

CREATE FUNCTION dna.list_core_performance_profiles(
  p_owner_id uuid,
  p_source_core_id text,
  p_limit integer
)
RETURNS TABLE (
  core_id text,
  mode text,
  distance integer,
  data_current_through timestamptz,
  race_count bigint,
  best_milliseconds numeric,
  median_milliseconds numeric,
  mean_milliseconds numeric,
  trimmed_mean_milliseconds numeric,
  standard_deviation_milliseconds numeric,
  interquartile_range_milliseconds numeric,
  best_metres_per_second numeric,
  median_metres_per_second numeric,
  star_profile jsonb,
  last_imported_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_owner_id uuid := dna.current_owner_id();
BEGIN
  IF v_owner_id IS NULL OR p_owner_id <> v_owner_id THEN
    RAISE EXCEPTION 'owner-scoped Core Intelligence read denied';
  END IF;
  IF p_source_core_id IS NOT NULL AND (
    p_source_core_id = ''
    OR p_source_core_id <> btrim(p_source_core_id)
    OR length(p_source_core_id) > 256
  ) THEN
    RAISE EXCEPTION 'Core Intelligence Core ID is invalid';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 5000 THEN
    RAISE EXCEPTION 'Core Intelligence result limit is invalid';
  END IF;

  RETURN QUERY
  SELECT
    profile.source_core_id,
    profile.mode,
    profile.distance,
    profile.data_current_through,
    profile.race_count,
    profile.best_milliseconds,
    profile.median_milliseconds,
    profile.mean_milliseconds,
    profile.trimmed_mean_milliseconds,
    profile.standard_deviation_milliseconds,
    profile.interquartile_range_milliseconds,
    profile.best_metres_per_second,
    profile.median_metres_per_second,
    CASE WHEN star.source_core_id IS NULL THEN NULL ELSE jsonb_build_object(
      'coreId', star.source_core_id,
      'mode', star.mode,
      'distance', star.distance,
      'dataCurrentThrough', to_char(star.data_current_through AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'raceCount', star.race_count,
      'completeStarDataRaceCount', star.complete_star_data_race_count,
      'partialStarDataRaceCount', star.partial_star_data_race_count,
      'missingStarDataRaceCount', star.missing_star_data_race_count,
      'invalidStarDataRaceCount', star.invalid_star_data_race_count,
      'goldEligibleRaceCount', star.gold_eligible_race_count,
      'goldAssignmentOpportunityCount', star.gold_assignment_opportunity_count,
      'goldReceivedCount', star.gold_received_count,
      'goldNegativeOpportunityCount', star.gold_negative_opportunity_count,
      'goldEligibleNoAssignmentCount', star.gold_eligible_no_assignment_count,
      'goldIneligibleAssignmentCount', star.gold_ineligible_assignment_count,
      'goldExcludedAnomalyCount', star.gold_excluded_anomaly_count,
      'goldReceivedRate', jsonb_build_object(
        'numerator', star.gold_received_count,
        'denominator', star.gold_assignment_opportunity_count
      ),
      'blueAssignmentOpportunityCount', star.blue_assignment_opportunity_count,
      'blueReceivedCount', star.blue_received_count,
      'blueNegativeOpportunityCount', star.blue_negative_opportunity_count,
      'blueNoAssignmentCount', star.blue_no_assignment_count,
      'blueExcludedAnomalyCount', star.blue_excluded_anomaly_count,
      'blueReceivedRate', jsonb_build_object(
        'numerator', star.blue_received_count,
        'denominator', star.blue_assignment_opportunity_count
      ),
      'sameCoreReceivedBothCount', star.same_core_received_both_count
    ) END,
    (
      SELECT max(batch.import_completed_at)
      FROM dna.import_batch batch
      WHERE
        batch.owner_id = p_owner_id
        AND batch.source_type = 'race_merge'
        AND batch.status = 'accepted'
    )
  FROM dna.core_performance_profile profile
  LEFT JOIN dna.core_star_profile star
    ON star.owner_id = profile.owner_id
    AND star.source_core_id = profile.source_core_id
    AND star.mode = profile.mode
    AND star.distance = profile.distance
  WHERE
    profile.owner_id = p_owner_id
    AND (
      p_source_core_id IS NOT NULL
      AND profile.source_core_id = p_source_core_id
      OR p_source_core_id IS NULL
      AND EXISTS (
        SELECT 1
        FROM dna.owner_vault_core vault
        JOIN dna.core core
          ON core.owner_id = vault.owner_id
          AND core.id = vault.core_id
        WHERE
          vault.owner_id = profile.owner_id
          AND vault.in_my_vault
          AND core.source_core_id = profile.source_core_id
      )
    )
  ORDER BY profile.source_core_id, profile.mode, profile.distance
  LIMIT p_limit;
END
$function$;

REVOKE ALL ON FUNCTION dna.elapsed_seconds_to_milliseconds(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.refresh_core_performance_profiles(timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.list_core_performance_profiles(uuid, text, integer) FROM PUBLIC;
REVOKE ALL ON TABLE dna.core_performance_profile FROM PUBLIC;

GRANT EXECUTE ON FUNCTION dna.list_core_performance_profiles(
  uuid,
  text,
  integer
) TO dna_app_runtime;

COMMIT;
