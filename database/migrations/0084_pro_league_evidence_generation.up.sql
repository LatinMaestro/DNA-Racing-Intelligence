BEGIN;

CREATE TABLE dna.pro_league_evidence_generation (
  owner_id uuid NOT NULL REFERENCES dna.app_owner(id) ON DELETE CASCADE,
  generation_id uuid NOT NULL,
  race_dataset_version_id uuid NOT NULL,
  worker_id text NOT NULL CHECK (
    worker_id = btrim(worker_id)
    AND worker_id ~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$'
  ),
  source_version_set_sha256 character(64) NOT NULL CHECK (
    source_version_set_sha256 ~ '^[a-f0-9]{64}$'
  ),
  evidence_cutoff_at timestamptz NOT NULL,
  input_observation_count bigint NOT NULL CHECK (
    input_observation_count BETWEEN 0 AND 5000000
  ),
  accepted_entry_count bigint NOT NULL CHECK (
    accepted_entry_count BETWEEN 0 AND input_observation_count
  ),
  non_bike_entry_count bigint NOT NULL CHECK (non_bike_entry_count >= 0),
  missing_format_entry_count bigint NOT NULL CHECK (missing_format_entry_count >= 0),
  unsupported_format_entry_count bigint NOT NULL CHECK (unsupported_format_entry_count >= 0),
  unpublished_cell_entry_count bigint NOT NULL CHECK (unpublished_cell_entry_count >= 0),
  unbenchmarked_entry_count bigint CHECK (
    unbenchmarked_entry_count BETWEEN 0 AND accepted_entry_count
  ),
  benchmark_count integer CHECK (benchmark_count BETWEEN 0 AND 100000),
  profile_count integer CHECK (profile_count BETWEEN 0 AND 500000),
  payload_sha256 character(64) CHECK (
    payload_sha256 IS NULL OR payload_sha256 ~ '^[a-f0-9]{64}$'
  ),
  state text NOT NULL DEFAULT 'staging' CHECK (state IN ('staging', 'published')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  published_at timestamptz,
  PRIMARY KEY (owner_id, generation_id),
  FOREIGN KEY (owner_id, race_dataset_version_id)
    REFERENCES dna.dataset_version(owner_id, id) ON DELETE RESTRICT,
  CHECK (
    (state = 'staging' AND benchmark_count IS NULL AND profile_count IS NULL
      AND unbenchmarked_entry_count IS NULL AND payload_sha256 IS NULL
      AND published_at IS NULL)
    OR
    (state = 'published' AND benchmark_count IS NOT NULL AND profile_count IS NOT NULL
      AND unbenchmarked_entry_count IS NOT NULL AND payload_sha256 IS NOT NULL
      AND published_at IS NOT NULL)
  ),
  CHECK (
    non_bike_entry_count + missing_format_entry_count
      + unsupported_format_entry_count + unpublished_cell_entry_count
      + accepted_entry_count = input_observation_count
  )
);

CREATE TABLE dna.pro_league_evidence_stage_row (
  owner_id uuid NOT NULL,
  generation_id uuid NOT NULL,
  family text NOT NULL CHECK (family IN ('benchmark', 'profile')),
  ordinal integer NOT NULL CHECK (ordinal BETWEEN 0 AND 499999),
  natural_key text NOT NULL CHECK (
    length(natural_key) BETWEEN 1 AND 1024 AND natural_key !~ '[[:cntrl:]]'
  ),
  row_sha256 character(64) NOT NULL CHECK (row_sha256 ~ '^[a-f0-9]{64}$'),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  PRIMARY KEY (owner_id, generation_id, family, ordinal),
  UNIQUE (owner_id, generation_id, family, natural_key),
  FOREIGN KEY (owner_id, generation_id)
    REFERENCES dna.pro_league_evidence_generation(owner_id, generation_id)
    ON DELETE CASCADE
);

CREATE TABLE dna.pro_league_evidence_row (
  owner_id uuid NOT NULL,
  generation_id uuid NOT NULL,
  family text NOT NULL CHECK (family IN ('benchmark', 'profile')),
  ordinal integer NOT NULL CHECK (ordinal BETWEEN 0 AND 499999),
  natural_key text NOT NULL CHECK (
    length(natural_key) BETWEEN 1 AND 1024 AND natural_key !~ '[[:cntrl:]]'
  ),
  row_sha256 character(64) NOT NULL CHECK (row_sha256 ~ '^[a-f0-9]{64}$'),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  PRIMARY KEY (owner_id, generation_id, family, ordinal),
  UNIQUE (owner_id, generation_id, family, natural_key),
  FOREIGN KEY (owner_id, generation_id)
    REFERENCES dna.pro_league_evidence_generation(owner_id, generation_id)
    ON DELETE RESTRICT
);

CREATE TABLE dna.pro_league_evidence_active (
  owner_id uuid PRIMARY KEY REFERENCES dna.app_owner(id) ON DELETE CASCADE,
  generation_id uuid NOT NULL,
  activated_at timestamptz NOT NULL,
  FOREIGN KEY (owner_id, generation_id)
    REFERENCES dna.pro_league_evidence_generation(owner_id, generation_id)
    ON DELETE RESTRICT
);

DO $rls$
DECLARE v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'pro_league_evidence_generation',
    'pro_league_evidence_stage_row',
    'pro_league_evidence_row',
    'pro_league_evidence_active'
  ] LOOP
    EXECUTE format('ALTER TABLE dna.%I ENABLE ROW LEVEL SECURITY', v_table);
    EXECUTE format('ALTER TABLE dna.%I FORCE ROW LEVEL SECURITY', v_table);
    EXECUTE format(
      'CREATE POLICY owner_isolation ON dna.%I USING (owner_id = dna.current_owner_id()) WITH CHECK (owner_id = dna.current_owner_id())',
      v_table
    );
  END LOOP;
END
$rls$;

CREATE FUNCTION dna.begin_pro_league_evidence_generation(
  p_owner_id uuid,
  p_generation_id uuid,
  p_race_dataset_version_id uuid,
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
    RAISE EXCEPTION 'owner-scoped Pro League evidence generation denied';
  END IF;
  IF p_generation_id IS NULL OR p_race_dataset_version_id IS NULL
     OR p_worker_id IS NULL OR p_worker_id <> btrim(p_worker_id)
     OR p_worker_id !~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$'
     OR p_source_version_set_sha256 !~ '^[a-f0-9]{64}$'
     OR p_evidence_cutoff_at IS NULL
     OR p_input_observation_count NOT BETWEEN 0 AND 5000000
     OR p_accepted_entry_count NOT BETWEEN 0 AND p_input_observation_count
     OR p_non_bike_entry_count < 0 OR p_missing_format_entry_count < 0
     OR p_unsupported_format_entry_count < 0 OR p_unpublished_cell_entry_count < 0
     OR p_non_bike_entry_count + p_missing_format_entry_count
       + p_unsupported_format_entry_count + p_unpublished_cell_entry_count
       + p_accepted_entry_count <> p_input_observation_count THEN
    RAISE EXCEPTION 'Pro League evidence generation metadata is invalid';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    p_owner_id::text || ':pro-league-evidence:' || p_generation_id::text, 0
  ));

  SELECT generation.* INTO v_existing
  FROM dna.pro_league_evidence_generation generation
  WHERE generation.owner_id = p_owner_id
    AND generation.generation_id = p_generation_id;
  IF FOUND THEN
    IF v_existing.race_dataset_version_id <> p_race_dataset_version_id
       OR v_existing.worker_id <> p_worker_id
       OR v_existing.source_version_set_sha256 <> p_source_version_set_sha256
       OR v_existing.evidence_cutoff_at <> p_evidence_cutoff_at
       OR v_existing.input_observation_count <> p_input_observation_count
       OR v_existing.accepted_entry_count <> p_accepted_entry_count
       OR v_existing.non_bike_entry_count <> p_non_bike_entry_count
       OR v_existing.missing_format_entry_count <> p_missing_format_entry_count
       OR v_existing.unsupported_format_entry_count <> p_unsupported_format_entry_count
       OR v_existing.unpublished_cell_entry_count <> p_unpublished_cell_entry_count THEN
      RAISE EXCEPTION 'Pro League evidence generation replay conflicts';
    END IF;
    RETURN v_existing.state;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM dna.dataset_version version
    WHERE version.owner_id = p_owner_id
      AND version.id = p_race_dataset_version_id
      AND version.source_type = 'race_merge'
      AND version.is_active AND version.rolled_back_at IS NULL
      AND p_evidence_cutoff_at >= version.activated_at
  ) OR dna.active_pro_league_source_version_set_sha256(p_owner_id)
       <> p_source_version_set_sha256 THEN
    RAISE EXCEPTION 'active point-in-time Pro League evidence source is unavailable';
  END IF;

  INSERT INTO dna.pro_league_evidence_generation (
    owner_id, generation_id, race_dataset_version_id, worker_id,
    source_version_set_sha256, evidence_cutoff_at, input_observation_count,
    accepted_entry_count, non_bike_entry_count, missing_format_entry_count,
    unsupported_format_entry_count, unpublished_cell_entry_count
  ) VALUES (
    p_owner_id, p_generation_id, p_race_dataset_version_id, p_worker_id,
    p_source_version_set_sha256, p_evidence_cutoff_at, p_input_observation_count,
    p_accepted_entry_count, p_non_bike_entry_count, p_missing_format_entry_count,
    p_unsupported_format_entry_count, p_unpublished_cell_entry_count
  );
  RETURN 'staging';
END
$function$;

CREATE FUNCTION dna.stage_pro_league_evidence_rows(
  p_owner_id uuid,
  p_generation_id uuid,
  p_worker_id text,
  p_family text,
  p_start_ordinal integer,
  p_rows jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_generation dna.pro_league_evidence_generation%ROWTYPE;
  v_entry jsonb;
  v_ordinal integer;
  v_natural_key text;
  v_payload jsonb;
  v_row_sha character(64);
  v_existing dna.pro_league_evidence_stage_row%ROWTYPE;
  v_hashes jsonb := '[]'::jsonb;
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped Pro League evidence staging denied';
  END IF;
  IF p_family NOT IN ('benchmark', 'profile') OR p_start_ordinal < 0
     OR p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array'
     OR jsonb_array_length(p_rows) NOT BETWEEN 1 AND 500
     OR p_start_ordinal + jsonb_array_length(p_rows) > 500000 THEN
    RAISE EXCEPTION 'Pro League evidence stage batch is invalid';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    p_owner_id::text || ':pro-league-evidence:' || p_generation_id::text, 0
  ));

  SELECT generation.* INTO v_generation
  FROM dna.pro_league_evidence_generation generation
  WHERE generation.owner_id = p_owner_id
    AND generation.generation_id = p_generation_id
  FOR UPDATE;
  IF NOT FOUND OR v_generation.state <> 'staging'
     OR v_generation.worker_id <> p_worker_id THEN
    RAISE EXCEPTION 'Pro League evidence staging claim is unavailable';
  END IF;

  FOR v_entry, v_ordinal IN
    SELECT value, p_start_ordinal + ordinality::integer - 1
    FROM jsonb_array_elements(p_rows) WITH ORDINALITY
  LOOP
    IF jsonb_typeof(v_entry) <> 'object'
       OR jsonb_typeof(v_entry -> 'naturalKey') <> 'string'
       OR jsonb_typeof(v_entry -> 'payload') <> 'object' THEN
      RAISE EXCEPTION 'Pro League evidence stage row shape is invalid';
    END IF;
    v_natural_key := v_entry ->> 'naturalKey';
    v_payload := v_entry -> 'payload';
    IF length(v_natural_key) NOT BETWEEN 1 AND 1024
       OR v_natural_key ~ '[[:cntrl:]]' THEN
      RAISE EXCEPTION 'Pro League evidence natural key is invalid';
    END IF;
    v_row_sha := encode(sha256(convert_to(v_payload::text, 'UTF8')), 'hex');

    SELECT staged.* INTO v_existing
    FROM dna.pro_league_evidence_stage_row staged
    WHERE staged.owner_id = p_owner_id
      AND staged.generation_id = p_generation_id
      AND staged.family = p_family AND staged.ordinal = v_ordinal;
    IF FOUND THEN
      IF v_existing.natural_key <> v_natural_key
         OR v_existing.row_sha256 <> v_row_sha
         OR v_existing.payload <> v_payload THEN
        RAISE EXCEPTION 'Pro League evidence stage replay conflicts';
      END IF;
    ELSE
      INSERT INTO dna.pro_league_evidence_stage_row (
        owner_id, generation_id, family, ordinal, natural_key, row_sha256, payload
      ) VALUES (
        p_owner_id, p_generation_id, p_family, v_ordinal,
        v_natural_key, v_row_sha, v_payload
      );
    END IF;
    v_hashes := v_hashes || jsonb_build_array(jsonb_build_object(
      'ordinal', v_ordinal, 'sha256', v_row_sha::text
    ));
  END LOOP;
  RETURN v_hashes;
END
$function$;

CREATE FUNCTION dna.publish_pro_league_evidence_generation(
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
    RAISE EXCEPTION 'owner-scoped Pro League evidence publication denied';
  END IF;
  IF p_expected_benchmark_count NOT BETWEEN 0 AND 100000
     OR p_expected_profile_count NOT BETWEEN 0 AND 500000
     OR p_unbenchmarked_entry_count < 0
     OR p_payload_sha256 !~ '^[a-f0-9]{64}$'
     OR p_published_at IS NULL THEN
    RAISE EXCEPTION 'Pro League evidence publication metadata is invalid';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    p_owner_id::text || ':pro-league-evidence-active', 0
  ));
  SELECT generation.* INTO v_generation
  FROM dna.pro_league_evidence_generation generation
  WHERE generation.owner_id = p_owner_id
    AND generation.generation_id = p_generation_id
  FOR UPDATE;
  IF NOT FOUND OR v_generation.worker_id <> p_worker_id THEN
    RAISE EXCEPTION 'Pro League evidence publication claim is unavailable';
  END IF;
  IF v_generation.state = 'published' THEN
    IF v_generation.benchmark_count <> p_expected_benchmark_count
       OR v_generation.profile_count <> p_expected_profile_count
       OR v_generation.unbenchmarked_entry_count <> p_unbenchmarked_entry_count
       OR v_generation.payload_sha256 <> p_payload_sha256 THEN
      RAISE EXCEPTION 'Pro League evidence publication replay conflicts';
    END IF;
    RETURN QUERY SELECT 'existing'::text,
      v_generation.benchmark_count, v_generation.profile_count;
    RETURN;
  END IF;
  IF p_unbenchmarked_entry_count > v_generation.accepted_entry_count
     OR p_published_at < v_generation.evidence_cutoff_at
     OR NOT EXISTS (
       SELECT 1 FROM dna.dataset_version version
       WHERE version.owner_id = p_owner_id
         AND version.id = v_generation.race_dataset_version_id
         AND version.source_type = 'race_merge'
         AND version.is_active AND version.rolled_back_at IS NULL
     ) OR dna.active_pro_league_source_version_set_sha256(p_owner_id)
          <> v_generation.source_version_set_sha256 THEN
    RAISE EXCEPTION 'Pro League evidence source was superseded before publication';
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
    RAISE EXCEPTION 'Pro League evidence count or digest verification failed';
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
    RAISE EXCEPTION 'Pro League evidence ordinals are incomplete';
  END IF;

  SELECT generation.evidence_cutoff_at INTO v_active_cutoff
  FROM dna.pro_league_evidence_active active
  JOIN dna.pro_league_evidence_generation generation
    ON generation.owner_id = active.owner_id
    AND generation.generation_id = active.generation_id
  WHERE active.owner_id = p_owner_id;
  IF FOUND AND v_active_cutoff > v_generation.evidence_cutoff_at THEN
    RAISE EXCEPTION 'Pro League evidence generation is older than last-good';
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

CREATE FUNCTION dna.read_active_pro_league_evidence_generation(p_owner_id uuid)
RETURNS SETOF dna.pro_league_evidence_generation
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped active Pro League evidence read denied';
  END IF;
  RETURN QUERY
  SELECT generation.* FROM dna.pro_league_evidence_active active
  JOIN dna.pro_league_evidence_generation generation
    ON generation.owner_id = active.owner_id
    AND generation.generation_id = active.generation_id
  WHERE active.owner_id = p_owner_id AND generation.state = 'published';
END
$function$;

CREATE FUNCTION dna.list_active_pro_league_evidence_rows(
  p_owner_id uuid,
  p_family text,
  p_after_ordinal integer,
  p_limit integer
)
RETURNS TABLE (
  generation_id uuid,
  family text,
  ordinal integer,
  natural_key text,
  row_sha256 character(64),
  payload jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped active Pro League evidence rows read denied';
  END IF;
  IF p_family NOT IN ('benchmark', 'profile') OR p_after_ordinal < -1
     OR p_limit NOT BETWEEN 1 AND 5000 THEN
    RAISE EXCEPTION 'active Pro League evidence row page is invalid';
  END IF;
  RETURN QUERY
  SELECT row.generation_id, row.family, row.ordinal,
    row.natural_key, row.row_sha256, row.payload
  FROM dna.pro_league_evidence_active active
  JOIN dna.pro_league_evidence_row row
    ON row.owner_id = active.owner_id AND row.generation_id = active.generation_id
  WHERE active.owner_id = p_owner_id AND row.family = p_family
    AND row.ordinal > p_after_ordinal
  ORDER BY row.ordinal
  LIMIT p_limit;
END
$function$;

DO $privileges$
DECLARE v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'pro_league_evidence_generation', 'pro_league_evidence_stage_row',
    'pro_league_evidence_row', 'pro_league_evidence_active'
  ] LOOP
    EXECUTE format('REVOKE ALL ON TABLE dna.%I FROM PUBLIC', v_table);
    EXECUTE format('REVOKE ALL ON TABLE dna.%I FROM dna_app_runtime', v_table);
  END LOOP;
END
$privileges$;
REVOKE ALL ON FUNCTION dna.begin_pro_league_evidence_generation(uuid,uuid,uuid,text,character,timestamptz,bigint,bigint,bigint,bigint,bigint,bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.stage_pro_league_evidence_rows(uuid,uuid,text,text,integer,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.publish_pro_league_evidence_generation(uuid,uuid,text,integer,integer,bigint,character,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.read_active_pro_league_evidence_generation(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.list_active_pro_league_evidence_rows(uuid,text,integer,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION dna.begin_pro_league_evidence_generation(uuid,uuid,uuid,text,character,timestamptz,bigint,bigint,bigint,bigint,bigint,bigint) TO dna_app_runtime;
GRANT EXECUTE ON FUNCTION dna.stage_pro_league_evidence_rows(uuid,uuid,text,text,integer,jsonb) TO dna_app_runtime;
GRANT EXECUTE ON FUNCTION dna.publish_pro_league_evidence_generation(uuid,uuid,text,integer,integer,bigint,character,timestamptz) TO dna_app_runtime;
GRANT EXECUTE ON FUNCTION dna.read_active_pro_league_evidence_generation(uuid) TO dna_app_runtime;
GRANT EXECUTE ON FUNCTION dna.list_active_pro_league_evidence_rows(uuid,text,integer,integer) TO dna_app_runtime;

COMMIT;
