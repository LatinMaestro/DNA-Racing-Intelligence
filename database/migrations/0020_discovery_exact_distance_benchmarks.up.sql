BEGIN;

CREATE TABLE dna.discovery_exact_distance_benchmark (
  owner_id uuid NOT NULL REFERENCES dna.app_owner(id) ON DELETE CASCADE,
  mode text NOT NULL CHECK (mode IN ('bike', 'car', 'horse')),
  distance integer NOT NULL CHECK (distance > 0),
  data_current_through timestamptz NOT NULL,
  race_entry_count bigint NOT NULL CHECK (race_entry_count > 0),
  winning_entry_count bigint NOT NULL CHECK (winning_entry_count > 0),
  top_three_entry_count bigint NOT NULL CHECK (top_three_entry_count > 0),
  winning_p25_milliseconds numeric NOT NULL CHECK (winning_p25_milliseconds > 0),
  winning_median_milliseconds numeric NOT NULL CHECK (winning_median_milliseconds > 0),
  winning_p75_milliseconds numeric NOT NULL CHECK (winning_p75_milliseconds > 0),
  top_three_p25_milliseconds numeric NOT NULL CHECK (top_three_p25_milliseconds > 0),
  top_three_median_milliseconds numeric NOT NULL CHECK (top_three_median_milliseconds > 0),
  top_three_p75_milliseconds numeric NOT NULL CHECK (top_three_p75_milliseconds > 0),
  refreshed_at timestamptz NOT NULL,
  PRIMARY KEY (owner_id, mode, distance),
  CHECK (winning_entry_count <= top_three_entry_count),
  CHECK (top_three_entry_count <= race_entry_count),
  CHECK (winning_p25_milliseconds <= winning_median_milliseconds),
  CHECK (winning_median_milliseconds <= winning_p75_milliseconds),
  CHECK (top_three_p25_milliseconds <= top_three_median_milliseconds),
  CHECK (top_three_median_milliseconds <= top_three_p75_milliseconds)
);

ALTER TABLE dna.discovery_exact_distance_benchmark ENABLE ROW LEVEL SECURITY;
ALTER TABLE dna.discovery_exact_distance_benchmark FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_isolation ON dna.discovery_exact_distance_benchmark
  USING (owner_id = dna.current_owner_id())
  WITH CHECK (owner_id = dna.current_owner_id());

CREATE FUNCTION dna.refresh_discovery_exact_distance_benchmarks(
  p_refreshed_at timestamptz
)
RETURNS bigint
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_owner_id uuid := dna.current_owner_id();
  v_count bigint := 0;
BEGIN
  IF v_owner_id IS NULL THEN
    RAISE EXCEPTION 'app.owner_id must be set for Discovery benchmark refresh';
  END IF;
  IF p_refreshed_at IS NULL THEN
    RAISE EXCEPTION 'Discovery benchmark refresh timestamp is required';
  END IF;

  DELETE FROM dna.discovery_exact_distance_benchmark
  WHERE owner_id = v_owner_id;

  INSERT INTO dna.discovery_exact_distance_benchmark (
    owner_id,
    mode,
    distance,
    data_current_through,
    race_entry_count,
    winning_entry_count,
    top_three_entry_count,
    winning_p25_milliseconds,
    winning_median_milliseconds,
    winning_p75_milliseconds,
    top_three_p25_milliseconds,
    top_three_median_milliseconds,
    top_three_p75_milliseconds,
    refreshed_at
  )
  SELECT
    v_owner_id,
    event.mode,
    event.distance,
    max(event.event_at),
    count(*)::bigint,
    count(*) FILTER (WHERE entry.finish_position = 1)::bigint,
    count(*) FILTER (WHERE entry.finish_position <= 3)::bigint,
    percentile_cont(0.25) WITHIN GROUP (ORDER BY entry.elapsed_time_milliseconds)
      FILTER (WHERE entry.finish_position = 1),
    percentile_cont(0.50) WITHIN GROUP (ORDER BY entry.elapsed_time_milliseconds)
      FILTER (WHERE entry.finish_position = 1),
    percentile_cont(0.75) WITHIN GROUP (ORDER BY entry.elapsed_time_milliseconds)
      FILTER (WHERE entry.finish_position = 1),
    percentile_cont(0.25) WITHIN GROUP (ORDER BY entry.elapsed_time_milliseconds)
      FILTER (WHERE entry.finish_position <= 3),
    percentile_cont(0.50) WITHIN GROUP (ORDER BY entry.elapsed_time_milliseconds)
      FILTER (WHERE entry.finish_position <= 3),
    percentile_cont(0.75) WITHIN GROUP (ORDER BY entry.elapsed_time_milliseconds)
      FILTER (WHERE entry.finish_position <= 3),
    p_refreshed_at
  FROM dna.race_entry entry
  JOIN dna.race_event event
    ON event.owner_id = entry.owner_id
    AND event.id = entry.race_event_id
  WHERE
    entry.owner_id = v_owner_id
    AND entry.active_in_dataset
    AND event.active_in_dataset
    AND entry.elapsed_time_milliseconds IS NOT NULL
    AND entry.finish_position > 0
  GROUP BY event.mode, event.distance
  HAVING
    count(*) FILTER (WHERE entry.finish_position = 1) > 0
    AND count(*) FILTER (WHERE entry.finish_position <= 3) > 0;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END
$function$;

CREATE FUNCTION dna.list_discovery_exact_distance_benchmarks(
  p_owner_id uuid,
  p_limit integer
)
RETURNS TABLE (
  mode text,
  distance integer,
  data_current_through timestamptz,
  race_entry_count bigint,
  winning_entry_count bigint,
  top_three_entry_count bigint,
  winning_p25_milliseconds numeric,
  winning_median_milliseconds numeric,
  winning_p75_milliseconds numeric,
  top_three_p25_milliseconds numeric,
  top_three_median_milliseconds numeric,
  top_three_p75_milliseconds numeric,
  refreshed_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_owner_id uuid := dna.current_owner_id();
BEGIN
  IF v_owner_id IS NULL OR p_owner_id <> v_owner_id THEN
    RAISE EXCEPTION 'owner-scoped Discovery benchmark read denied';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 5000 THEN
    RAISE EXCEPTION 'Discovery benchmark result limit is invalid';
  END IF;

  RETURN QUERY
  SELECT
    benchmark.mode,
    benchmark.distance,
    benchmark.data_current_through,
    benchmark.race_entry_count,
    benchmark.winning_entry_count,
    benchmark.top_three_entry_count,
    benchmark.winning_p25_milliseconds,
    benchmark.winning_median_milliseconds,
    benchmark.winning_p75_milliseconds,
    benchmark.top_three_p25_milliseconds,
    benchmark.top_three_median_milliseconds,
    benchmark.top_three_p75_milliseconds,
    benchmark.refreshed_at
  FROM dna.discovery_exact_distance_benchmark benchmark
  WHERE benchmark.owner_id = p_owner_id
  ORDER BY benchmark.mode, benchmark.distance
  LIMIT p_limit;
END
$function$;

REVOKE ALL ON TABLE dna.discovery_exact_distance_benchmark FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.refresh_discovery_exact_distance_benchmarks(timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.list_discovery_exact_distance_benchmarks(uuid, integer) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION dna.list_discovery_exact_distance_benchmarks(uuid, integer)
  TO dna_app_runtime;

COMMIT;
