BEGIN;

CREATE OR REPLACE FUNCTION dna.begin_pro_league_evidence_generation_from_core_history(
  p_owner_id uuid,
  p_generation_id uuid,
  p_core_history_generation_id character(64),
  p_worker_id text,
  p_source_version_set_sha256 character(64),
  p_evidence_cutoff_at timestamptz,
  p_input_observation_count bigint,
  p_accepted_entry_count bigint,
  p_non_bike_entry_count bigint,
  p_missing_format_entry_count bigint,
  p_unsupported_format_entry_count bigint,
  p_unpublished_cell_entry_count bigint
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_existing dna.pro_league_evidence_generation%ROWTYPE;
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped Pro League Core history evidence begin denied';
  END IF;
  IF p_generation_id IS NULL
     OR p_core_history_generation_id IS NULL
     OR p_core_history_generation_id !~ '^[a-f0-9]{64}$'
     OR p_worker_id IS NULL OR p_worker_id <> btrim(p_worker_id)
     OR p_worker_id !~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$'
     OR p_source_version_set_sha256 !~ '^[a-f0-9]{64}$'
     OR p_evidence_cutoff_at IS NULL
     OR p_input_observation_count NOT BETWEEN 0 AND 5000000
     OR p_accepted_entry_count NOT BETWEEN 0 AND p_input_observation_count
     OR p_non_bike_entry_count <> 0
     OR p_missing_format_entry_count < 0
     OR p_unsupported_format_entry_count < 0
     OR p_unpublished_cell_entry_count < 0
     OR p_accepted_entry_count + p_non_bike_entry_count
       + p_missing_format_entry_count + p_unsupported_format_entry_count
       + p_unpublished_cell_entry_count <> p_input_observation_count THEN
    RAISE EXCEPTION 'Pro League Core history evidence metadata is invalid';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    p_owner_id::text || ':pro-league-evidence:' || p_generation_id::text, 0
  ));
  SELECT generation.* INTO v_existing
  FROM dna.pro_league_evidence_generation generation
  WHERE generation.owner_id = p_owner_id
    AND generation.generation_id = p_generation_id;
  IF FOUND THEN
    IF v_existing.source_kind <> 'core_history_generation'
       OR v_existing.race_dataset_version_id IS NOT NULL
       OR v_existing.core_history_generation_id <> p_core_history_generation_id
       OR v_existing.worker_id <> p_worker_id
       OR v_existing.source_version_set_sha256 <> p_source_version_set_sha256
       OR v_existing.evidence_cutoff_at <> p_evidence_cutoff_at
       OR v_existing.input_observation_count <> p_input_observation_count
       OR v_existing.accepted_entry_count <> p_accepted_entry_count
       OR v_existing.non_bike_entry_count <> p_non_bike_entry_count
       OR v_existing.missing_format_entry_count <> p_missing_format_entry_count
       OR v_existing.unsupported_format_entry_count <> p_unsupported_format_entry_count
       OR v_existing.unpublished_cell_entry_count <> p_unpublished_cell_entry_count THEN
      RAISE EXCEPTION 'Pro League Core history evidence replay conflicts';
    END IF;
    RETURN v_existing.state;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM dna.dna_core_race_history_generation_active active
    JOIN dna.dna_core_race_history_generation source
      ON source.owner_id = active.owner_id
     AND source.generation_id = active.generation_id
    WHERE active.owner_id = p_owner_id
      AND active.generation_id = p_core_history_generation_id
      AND source.state = 'published'
      AND source.observation_set_sha256 = p_source_version_set_sha256
      AND source.materialized_at = p_evidence_cutoff_at
      AND source.observation_count = p_input_observation_count
      AND source.accepted_published_cell_count = p_accepted_entry_count
      AND source.missing_format_count = p_missing_format_entry_count
      AND source.unsupported_format_count = p_unsupported_format_entry_count
      AND source.unpublished_cell_count = p_unpublished_cell_entry_count
  ) THEN
    RAISE EXCEPTION 'active complete Core history evidence source is unavailable';
  END IF;

  INSERT INTO dna.pro_league_evidence_generation (
    owner_id, generation_id, source_kind, race_dataset_version_id,
    core_history_generation_id, worker_id, source_version_set_sha256,
    evidence_cutoff_at, input_observation_count, accepted_entry_count,
    non_bike_entry_count, missing_format_entry_count,
    unsupported_format_entry_count, unpublished_cell_entry_count
  ) VALUES (
    p_owner_id, p_generation_id, 'core_history_generation', NULL,
    p_core_history_generation_id, p_worker_id, p_source_version_set_sha256,
    p_evidence_cutoff_at, p_input_observation_count, p_accepted_entry_count,
    p_non_bike_entry_count, p_missing_format_entry_count,
    p_unsupported_format_entry_count, p_unpublished_cell_entry_count
  );
  RETURN 'staging';
END
$function$;

CREATE OR REPLACE FUNCTION dna.publish_pro_league_evidence_generation_from_core_history(
  p_owner_id uuid,
  p_generation_id uuid,
  p_worker_id text,
  p_expected_benchmark_count integer,
  p_expected_profile_count integer,
  p_unbenchmarked_entry_count bigint,
  p_payload_sha256 character(64),
  p_published_at timestamptz
)
RETURNS TABLE (disposition text, benchmark_count integer, profile_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_generation dna.pro_league_evidence_generation%ROWTYPE;
  v_benchmark_count integer;
  v_profile_count integer;
  v_digest character(64);
  v_active_cutoff timestamptz;
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped Pro League Core history evidence publication denied';
  END IF;
  IF p_expected_benchmark_count NOT BETWEEN 0 AND 100000
     OR p_expected_profile_count NOT BETWEEN 0 AND 500000
     OR p_unbenchmarked_entry_count < 0
     OR p_payload_sha256 !~ '^[a-f0-9]{64}$'
     OR p_published_at IS NULL THEN
    RAISE EXCEPTION 'Pro League Core history evidence publication metadata is invalid';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    p_owner_id::text || ':pro-league-evidence-active', 0
  ));
  SELECT generation.* INTO v_generation
  FROM dna.pro_league_evidence_generation generation
  WHERE generation.owner_id = p_owner_id
    AND generation.generation_id = p_generation_id
  FOR UPDATE;
  IF NOT FOUND OR v_generation.worker_id <> p_worker_id
     OR v_generation.source_kind <> 'core_history_generation'
     OR v_generation.core_history_generation_id IS NULL
     OR v_generation.race_dataset_version_id IS NOT NULL THEN
    RAISE EXCEPTION 'Pro League Core history evidence publication claim is unavailable';
  END IF;
  IF v_generation.state = 'published' THEN
    IF v_generation.benchmark_count <> p_expected_benchmark_count
       OR v_generation.profile_count <> p_expected_profile_count
       OR v_generation.unbenchmarked_entry_count <> p_unbenchmarked_entry_count
       OR v_generation.payload_sha256 <> p_payload_sha256 THEN
      RAISE EXCEPTION 'Pro League Core history evidence publication replay conflicts';
    END IF;
    RETURN QUERY SELECT 'existing'::text,
      v_generation.benchmark_count, v_generation.profile_count;
    RETURN;
  END IF;
  IF p_unbenchmarked_entry_count > v_generation.accepted_entry_count
     OR p_published_at < v_generation.evidence_cutoff_at
     OR NOT EXISTS (
       SELECT 1
       FROM dna.dna_core_race_history_generation_active active
       JOIN dna.dna_core_race_history_generation source
         ON source.owner_id = active.owner_id
        AND source.generation_id = active.generation_id
       WHERE active.owner_id = p_owner_id
         AND active.generation_id = v_generation.core_history_generation_id
         AND source.state = 'published'
         AND source.observation_set_sha256 = v_generation.source_version_set_sha256
         AND source.materialized_at = v_generation.evidence_cutoff_at
         AND source.observation_count = v_generation.input_observation_count
         AND source.accepted_published_cell_count = v_generation.accepted_entry_count
         AND source.missing_format_count = v_generation.missing_format_entry_count
         AND source.unsupported_format_count = v_generation.unsupported_format_entry_count
         AND source.unpublished_cell_count = v_generation.unpublished_cell_entry_count
     ) THEN
    RAISE EXCEPTION 'Pro League Core history evidence source was superseded before publication';
  END IF;

  WITH family AS (
    SELECT expected.family, expected.position,
      count(row.ordinal)::integer AS row_count,
      encode(sha256(convert_to(COALESCE(string_agg(
        row.ordinal::text || ':' || row.row_sha256::text || E'\n',
        '' ORDER BY row.ordinal
      ), ''), 'UTF8')), 'hex') AS family_sha256
    FROM (VALUES ('benchmark'::text, 1), ('profile'::text, 2))
      expected(family, position)
    LEFT JOIN dna.pro_league_evidence_stage_row row
      ON row.owner_id = p_owner_id AND row.generation_id = p_generation_id
      AND row.family = expected.family
    GROUP BY expected.family, expected.position
  )
  SELECT max(row_count) FILTER (WHERE family = 'benchmark'),
    max(row_count) FILTER (WHERE family = 'profile'),
    encode(sha256(convert_to(string_agg(
      family || ':' || row_count::text || ':' || family_sha256 || E'\n',
      '' ORDER BY position
    ), 'UTF8')), 'hex')::character(64)
  INTO v_benchmark_count, v_profile_count, v_digest
  FROM family;
  IF v_benchmark_count <> p_expected_benchmark_count
     OR v_profile_count <> p_expected_profile_count
     OR v_digest <> p_payload_sha256 THEN
    RAISE EXCEPTION 'Pro League Core history evidence count or digest verification failed';
  END IF;
  IF EXISTS (
    SELECT 1 FROM (VALUES
      ('benchmark'::text, p_expected_benchmark_count),
      ('profile'::text, p_expected_profile_count)
    ) expected(family, count)
    WHERE expected.count > 0 AND NOT EXISTS (
      SELECT 1 FROM dna.pro_league_evidence_stage_row row
      WHERE row.owner_id = p_owner_id AND row.generation_id = p_generation_id
        AND row.family = expected.family
      GROUP BY row.family
      HAVING min(row.ordinal) = 0 AND max(row.ordinal) = expected.count - 1
        AND count(*) = expected.count
    )
  ) THEN
    RAISE EXCEPTION 'Pro League Core history evidence ordinals are incomplete';
  END IF;

  SELECT generation.evidence_cutoff_at INTO v_active_cutoff
  FROM dna.pro_league_evidence_active active
  JOIN dna.pro_league_evidence_generation generation
    ON generation.owner_id = active.owner_id
   AND generation.generation_id = active.generation_id
  WHERE active.owner_id = p_owner_id;
  IF FOUND AND v_active_cutoff > v_generation.evidence_cutoff_at THEN
    RAISE EXCEPTION 'Pro League Core history evidence is older than last-good';
  END IF;

  INSERT INTO dna.pro_league_evidence_row (
    owner_id, generation_id, family, ordinal, natural_key, row_sha256, payload
  ) SELECT owner_id, generation_id, family, ordinal, natural_key, row_sha256, payload
  FROM dna.pro_league_evidence_stage_row row
  WHERE row.owner_id = p_owner_id AND row.generation_id = p_generation_id;

  UPDATE dna.pro_league_evidence_generation SET
    state = 'published', benchmark_count = p_expected_benchmark_count,
    profile_count = p_expected_profile_count,
    unbenchmarked_entry_count = p_unbenchmarked_entry_count,
    payload_sha256 = p_payload_sha256, published_at = p_published_at
  WHERE owner_id = p_owner_id AND generation_id = p_generation_id;
  INSERT INTO dna.pro_league_evidence_active (owner_id, generation_id, activated_at)
  VALUES (p_owner_id, p_generation_id, p_published_at)
  ON CONFLICT (owner_id) DO UPDATE SET
    generation_id = EXCLUDED.generation_id,
    activated_at = EXCLUDED.activated_at;
  DELETE FROM dna.pro_league_evidence_stage_row
  WHERE owner_id = p_owner_id AND generation_id = p_generation_id;

  RETURN QUERY SELECT 'published'::text,
    p_expected_benchmark_count, p_expected_profile_count;
END
$function$;

REVOKE ALL ON FUNCTION dna.begin_pro_league_evidence_generation_from_core_history(uuid,uuid,character,text,character,timestamptz,bigint,bigint,bigint,bigint,bigint,bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.publish_pro_league_evidence_generation_from_core_history(uuid,uuid,text,integer,integer,bigint,character,timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION dna.begin_pro_league_evidence_generation_from_core_history(uuid,uuid,character,text,character,timestamptz,bigint,bigint,bigint,bigint,bigint,bigint) TO dna_app_runtime;
GRANT EXECUTE ON FUNCTION dna.publish_pro_league_evidence_generation_from_core_history(uuid,uuid,text,integer,integer,bigint,character,timestamptz) TO dna_app_runtime;

COMMIT;
