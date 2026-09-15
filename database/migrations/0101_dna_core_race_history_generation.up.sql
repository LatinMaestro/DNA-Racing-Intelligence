BEGIN;

CREATE TABLE dna.dna_core_race_history_generation (
  owner_id uuid NOT NULL REFERENCES dna.app_owner(id) ON DELETE CASCADE,
  generation_id character(64) NOT NULL CHECK (generation_id ~ '^[a-f0-9]{64}$'),
  version smallint NOT NULL CHECK (version = 1),
  worker_id text NOT NULL CHECK (
    worker_id = btrim(worker_id)
    AND worker_id ~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$'
  ),
  materialized_at timestamptz NOT NULL,
  cycle_set_sha256 character(64) NOT NULL CHECK (cycle_set_sha256 ~ '^[a-f0-9]{64}$'),
  observation_set_sha256 character(64) NOT NULL CHECK (observation_set_sha256 ~ '^[a-f0-9]{64}$'),
  payload_sha256 character(64) NOT NULL CHECK (payload_sha256 ~ '^[a-f0-9]{64}$'),
  input_cycle_count integer NOT NULL CHECK (input_cycle_count BETWEEN 1 AND 500000),
  input_page_count integer NOT NULL CHECK (input_page_count BETWEEN 1 AND 500000),
  input_result_count integer NOT NULL CHECK (input_result_count BETWEEN 0 AND 500000),
  replay_duplicate_count integer NOT NULL CHECK (replay_duplicate_count BETWEEN 0 AND input_result_count),
  race_document_count integer NOT NULL CHECK (race_document_count BETWEEN 0 AND 500000),
  exact_distance_confirmed_count integer NOT NULL CHECK (exact_distance_confirmed_count BETWEEN 0 AND 500000),
  accepted_published_cell_count integer NOT NULL CHECK (accepted_published_cell_count BETWEEN 0 AND 500000),
  missing_format_count integer NOT NULL CHECK (missing_format_count BETWEEN 0 AND 500000),
  unsupported_format_count integer NOT NULL CHECK (unsupported_format_count BETWEEN 0 AND 500000),
  unpublished_cell_count integer NOT NULL CHECK (unpublished_cell_count BETWEEN 0 AND 500000),
  observation_count integer NOT NULL CHECK (observation_count BETWEEN 0 AND 500000),
  state text NOT NULL DEFAULT 'staging' CHECK (state IN ('staging', 'published')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  published_at timestamptz,
  PRIMARY KEY (owner_id, generation_id),
  CHECK (input_result_count = observation_count + replay_duplicate_count),
  CHECK (exact_distance_confirmed_count = observation_count),
  CHECK (
    accepted_published_cell_count + missing_format_count
      + unsupported_format_count + unpublished_cell_count = observation_count
  ),
  CHECK (
    (state = 'staging' AND published_at IS NULL)
    OR (state = 'published' AND published_at IS NOT NULL)
  )
);

CREATE TABLE dna.dna_core_race_history_generation_row (
  owner_id uuid NOT NULL,
  generation_id character(64) NOT NULL,
  ordinal integer NOT NULL CHECK (ordinal BETWEEN 0 AND 499999),
  natural_key text NOT NULL CHECK (
    length(natural_key) BETWEEN 1 AND 1024 AND natural_key !~ '[[:cntrl:]]'
  ),
  row_sha256 character(64) NOT NULL CHECK (row_sha256 ~ '^[a-f0-9]{64}$'),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  PRIMARY KEY (owner_id, generation_id, ordinal),
  UNIQUE (owner_id, generation_id, natural_key),
  FOREIGN KEY (owner_id, generation_id)
    REFERENCES dna.dna_core_race_history_generation(owner_id, generation_id)
    ON DELETE RESTRICT
);

CREATE TABLE dna.dna_core_race_history_generation_active (
  owner_id uuid PRIMARY KEY REFERENCES dna.app_owner(id) ON DELETE CASCADE,
  generation_id character(64) NOT NULL,
  activated_at timestamptz NOT NULL,
  FOREIGN KEY (owner_id, generation_id)
    REFERENCES dna.dna_core_race_history_generation(owner_id, generation_id)
    ON DELETE RESTRICT
);

DO $rls$
DECLARE v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'dna_core_race_history_generation',
    'dna_core_race_history_generation_row',
    'dna_core_race_history_generation_active'
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

CREATE FUNCTION dna.begin_dna_core_race_history_generation(
  p_owner_id uuid,
  p_worker_id text,
  p_generation jsonb
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_existing dna.dna_core_race_history_generation%ROWTYPE;
  v_generation_id character(64);
  v_key_count integer;
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped Core history generation begin denied';
  END IF;
  IF p_worker_id IS NULL OR p_worker_id <> btrim(p_worker_id)
     OR p_worker_id !~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$'
     OR p_generation IS NULL OR jsonb_typeof(p_generation) <> 'object' THEN
    RAISE EXCEPTION 'Core history generation begin authority is invalid';
  END IF;
  SELECT count(*)::integer INTO v_key_count FROM jsonb_object_keys(p_generation);
  IF v_key_count <> 17 OR NOT (p_generation ?& ARRAY[
    'version', 'generationId', 'materializedAt', 'cycleSetSha256',
    'observationSetSha256', 'payloadSha256', 'inputCycleCount',
    'inputPageCount', 'inputResultCount', 'replayDuplicateCount',
    'raceDocumentCount', 'exactDistanceConfirmedCount',
    'acceptedPublishedCellCount', 'missingFormatCount',
    'unsupportedFormatCount', 'unpublishedCellCount', 'observationCount'
  ]) THEN
    RAISE EXCEPTION 'Core history generation fields are invalid';
  END IF;
  IF jsonb_typeof(p_generation -> 'version') <> 'number'
     OR p_generation ->> 'version' <> '1'
     OR jsonb_typeof(p_generation -> 'generationId') <> 'string'
     OR p_generation ->> 'generationId' !~ '^[a-f0-9]{64}$'
     OR jsonb_typeof(p_generation -> 'materializedAt') <> 'string'
     OR jsonb_typeof(p_generation -> 'cycleSetSha256') <> 'string'
     OR p_generation ->> 'cycleSetSha256' !~ '^[a-f0-9]{64}$'
     OR jsonb_typeof(p_generation -> 'observationSetSha256') <> 'string'
     OR p_generation ->> 'observationSetSha256' !~ '^[a-f0-9]{64}$'
     OR jsonb_typeof(p_generation -> 'payloadSha256') <> 'string'
     OR p_generation ->> 'payloadSha256' !~ '^[a-f0-9]{64}$'
     OR EXISTS (
       SELECT 1 FROM unnest(ARRAY[
         'inputCycleCount', 'inputPageCount', 'inputResultCount',
         'replayDuplicateCount', 'raceDocumentCount',
         'exactDistanceConfirmedCount', 'acceptedPublishedCellCount',
         'missingFormatCount', 'unsupportedFormatCount',
         'unpublishedCellCount', 'observationCount'
       ]) field
       WHERE jsonb_typeof(p_generation -> field) <> 'number'
         OR p_generation ->> field !~ '^[0-9]+$'
         OR (p_generation ->> field)::numeric > 500000
     ) THEN
    RAISE EXCEPTION 'Core history generation metadata is invalid';
  END IF;
  IF (p_generation ->> 'inputCycleCount')::integer < 1
     OR (p_generation ->> 'inputPageCount')::integer < 1 THEN
    RAISE EXCEPTION 'Core history generation source coverage is invalid';
  END IF;
  BEGIN
    PERFORM (p_generation ->> 'materializedAt')::timestamptz;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'Core history generation materialization time is invalid';
  END;
  IF (p_generation ->> 'inputResultCount')::integer <
       (p_generation ->> 'replayDuplicateCount')::integer
     OR (p_generation ->> 'inputResultCount')::integer <>
       (p_generation ->> 'observationCount')::integer
         + (p_generation ->> 'replayDuplicateCount')::integer
     OR (p_generation ->> 'exactDistanceConfirmedCount')::integer <>
       (p_generation ->> 'observationCount')::integer
     OR (p_generation ->> 'acceptedPublishedCellCount')::integer
         + (p_generation ->> 'missingFormatCount')::integer
         + (p_generation ->> 'unsupportedFormatCount')::integer
         + (p_generation ->> 'unpublishedCellCount')::integer <>
       (p_generation ->> 'observationCount')::integer THEN
    RAISE EXCEPTION 'Core history generation counts disagree';
  END IF;
  v_generation_id := (p_generation ->> 'generationId')::character(64);
  PERFORM pg_advisory_xact_lock(hashtextextended(
    p_owner_id::text || ':core-history-generation:' || v_generation_id::text, 0
  ));
  SELECT stored.* INTO v_existing
  FROM dna.dna_core_race_history_generation stored
  WHERE stored.owner_id = p_owner_id AND stored.generation_id = v_generation_id
  FOR UPDATE;
  IF FOUND THEN
    IF v_existing.worker_id <> p_worker_id
       OR v_existing.version <> (p_generation ->> 'version')::smallint
       OR v_existing.materialized_at <> (p_generation ->> 'materializedAt')::timestamptz
       OR v_existing.cycle_set_sha256::text <> p_generation ->> 'cycleSetSha256'
       OR v_existing.observation_set_sha256::text <> p_generation ->> 'observationSetSha256'
       OR v_existing.payload_sha256::text <> p_generation ->> 'payloadSha256'
       OR v_existing.input_cycle_count <> (p_generation ->> 'inputCycleCount')::integer
       OR v_existing.input_page_count <> (p_generation ->> 'inputPageCount')::integer
       OR v_existing.input_result_count <> (p_generation ->> 'inputResultCount')::integer
       OR v_existing.replay_duplicate_count <> (p_generation ->> 'replayDuplicateCount')::integer
       OR v_existing.race_document_count <> (p_generation ->> 'raceDocumentCount')::integer
       OR v_existing.exact_distance_confirmed_count <> (p_generation ->> 'exactDistanceConfirmedCount')::integer
       OR v_existing.accepted_published_cell_count <> (p_generation ->> 'acceptedPublishedCellCount')::integer
       OR v_existing.missing_format_count <> (p_generation ->> 'missingFormatCount')::integer
       OR v_existing.unsupported_format_count <> (p_generation ->> 'unsupportedFormatCount')::integer
       OR v_existing.unpublished_cell_count <> (p_generation ->> 'unpublishedCellCount')::integer
       OR v_existing.observation_count <> (p_generation ->> 'observationCount')::integer THEN
      RAISE EXCEPTION 'Core history generation replay conflicts';
    END IF;
    RETURN v_existing.state;
  END IF;
  INSERT INTO dna.dna_core_race_history_generation (
    owner_id, generation_id, version, worker_id, materialized_at,
    cycle_set_sha256, observation_set_sha256, payload_sha256,
    input_cycle_count, input_page_count, input_result_count,
    replay_duplicate_count, race_document_count,
    exact_distance_confirmed_count, accepted_published_cell_count,
    missing_format_count, unsupported_format_count, unpublished_cell_count,
    observation_count
  ) VALUES (
    p_owner_id, v_generation_id, 1, p_worker_id,
    (p_generation ->> 'materializedAt')::timestamptz,
    (p_generation ->> 'cycleSetSha256')::character(64),
    (p_generation ->> 'observationSetSha256')::character(64),
    (p_generation ->> 'payloadSha256')::character(64),
    (p_generation ->> 'inputCycleCount')::integer,
    (p_generation ->> 'inputPageCount')::integer,
    (p_generation ->> 'inputResultCount')::integer,
    (p_generation ->> 'replayDuplicateCount')::integer,
    (p_generation ->> 'raceDocumentCount')::integer,
    (p_generation ->> 'exactDistanceConfirmedCount')::integer,
    (p_generation ->> 'acceptedPublishedCellCount')::integer,
    (p_generation ->> 'missingFormatCount')::integer,
    (p_generation ->> 'unsupportedFormatCount')::integer,
    (p_generation ->> 'unpublishedCellCount')::integer,
    (p_generation ->> 'observationCount')::integer
  );
  RETURN 'staging';
END
$function$;

CREATE FUNCTION dna.stage_dna_core_race_history_generation_rows(
  p_owner_id uuid,
  p_worker_id text,
  p_generation_id text,
  p_start_ordinal integer,
  p_rows jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_generation dna.dna_core_race_history_generation%ROWTYPE;
  v_entry jsonb;
  v_ordinal integer;
  v_canonical_payload text;
  v_payload jsonb;
  v_batch_bytes integer := 0;
  v_existing dna.dna_core_race_history_generation_row%ROWTYPE;
  v_result jsonb := '[]'::jsonb;
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped Core history generation stage denied';
  END IF;
  IF p_generation_id IS NULL OR p_generation_id !~ '^[a-f0-9]{64}$'
     OR p_worker_id IS NULL OR p_worker_id <> btrim(p_worker_id)
     OR p_worker_id !~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$'
     OR p_start_ordinal IS NULL OR p_start_ordinal < 0
     OR p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array'
     OR jsonb_array_length(p_rows) NOT BETWEEN 1 AND 250
     OR p_start_ordinal + jsonb_array_length(p_rows) > 500000 THEN
    RAISE EXCEPTION 'Core history generation stage batch is invalid';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    p_owner_id::text || ':core-history-generation:' || p_generation_id, 0
  ));
  SELECT stored.* INTO v_generation
  FROM dna.dna_core_race_history_generation stored
  WHERE stored.owner_id = p_owner_id
    AND stored.generation_id = p_generation_id::character(64)
  FOR UPDATE;
  IF NOT FOUND OR v_generation.state <> 'staging'
     OR v_generation.worker_id <> p_worker_id THEN
    RAISE EXCEPTION 'Core history generation staging claim is unavailable';
  END IF;
  FOR v_entry, v_ordinal IN
    SELECT value, p_start_ordinal + ordinality::integer - 1
    FROM jsonb_array_elements(p_rows) WITH ORDINALITY
  LOOP
    IF jsonb_typeof(v_entry) <> 'object'
       OR (SELECT count(*) FROM jsonb_object_keys(v_entry)) <> 5
       OR NOT (v_entry ?& ARRAY[
         'ordinal', 'naturalKey', 'rowSha256', 'canonicalPayload', 'payload'
       ])
       OR jsonb_typeof(v_entry -> 'ordinal') <> 'number'
       OR v_entry ->> 'ordinal' !~ '^[0-9]+$'
       OR (v_entry ->> 'ordinal')::integer <> v_ordinal
       OR jsonb_typeof(v_entry -> 'naturalKey') <> 'string'
       OR length(v_entry ->> 'naturalKey') NOT BETWEEN 1 AND 1024
       OR v_entry ->> 'naturalKey' ~ '[[:cntrl:]]'
       OR jsonb_typeof(v_entry -> 'rowSha256') <> 'string'
       OR v_entry ->> 'rowSha256' !~ '^[a-f0-9]{64}$'
       OR jsonb_typeof(v_entry -> 'canonicalPayload') <> 'string'
       OR jsonb_typeof(v_entry -> 'payload') <> 'object'
       OR v_entry -> 'payload' ->> 'naturalKey' IS DISTINCT FROM v_entry ->> 'naturalKey' THEN
      RAISE EXCEPTION 'Core history generation stage row is invalid';
    END IF;
    v_canonical_payload := v_entry ->> 'canonicalPayload';
    IF octet_length(v_canonical_payload) NOT BETWEEN 2 AND 16384
       OR encode(sha256(convert_to(v_canonical_payload, 'UTF8')), 'hex') <>
         v_entry ->> 'rowSha256' THEN
      RAISE EXCEPTION 'Core history generation stage row integrity is invalid';
    END IF;
    BEGIN
      v_payload := v_canonical_payload::jsonb;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'Core history generation canonical payload is invalid JSON';
    END;
    IF jsonb_typeof(v_payload) <> 'object'
       OR v_payload <> v_entry -> 'payload' THEN
      RAISE EXCEPTION 'Core history generation canonical payload conflicts';
    END IF;
    v_batch_bytes := v_batch_bytes + octet_length(v_canonical_payload);
    IF v_batch_bytes > 2097152 THEN
      RAISE EXCEPTION 'Core history generation stage batch is too large';
    END IF;
    SELECT stored.* INTO v_existing
    FROM dna.dna_core_race_history_generation_row stored
    WHERE stored.owner_id = p_owner_id
      AND stored.generation_id = p_generation_id::character(64)
      AND stored.ordinal = v_ordinal;
    IF FOUND THEN
      IF v_existing.natural_key <> v_entry ->> 'naturalKey'
         OR v_existing.row_sha256::text <> v_entry ->> 'rowSha256'
         OR v_existing.payload <> v_payload THEN
        RAISE EXCEPTION 'Core history generation stage replay conflicts';
      END IF;
    ELSE
      INSERT INTO dna.dna_core_race_history_generation_row (
        owner_id, generation_id, ordinal, natural_key, row_sha256, payload
      ) VALUES (
        p_owner_id, p_generation_id::character(64), v_ordinal,
        v_entry ->> 'naturalKey', (v_entry ->> 'rowSha256')::character(64),
        v_payload
      );
    END IF;
    v_result := v_result || jsonb_build_array(jsonb_build_object(
      'ordinal', v_ordinal, 'rowSha256', v_entry ->> 'rowSha256'
    ));
  END LOOP;
  RETURN v_result;
END
$function$;

CREATE FUNCTION dna.publish_dna_core_race_history_generation(
  p_owner_id uuid,
  p_worker_id text,
  p_generation_id text,
  p_expected_observation_count integer,
  p_payload_sha256 text,
  p_published_at timestamptz
)
RETURNS SETOF dna.dna_core_race_history_generation
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_generation dna.dna_core_race_history_generation%ROWTYPE;
  v_active dna.dna_core_race_history_generation%ROWTYPE;
  v_count integer;
  v_digest character(64);
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped Core history generation publication denied';
  END IF;
  IF p_generation_id IS NULL OR p_generation_id !~ '^[a-f0-9]{64}$'
     OR p_worker_id IS NULL OR p_worker_id <> btrim(p_worker_id)
     OR p_worker_id !~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$'
     OR p_expected_observation_count IS NULL
     OR p_expected_observation_count NOT BETWEEN 0 AND 500000
     OR p_payload_sha256 IS NULL OR p_payload_sha256 !~ '^[a-f0-9]{64}$'
     OR p_published_at IS NULL
     OR p_published_at > clock_timestamp() + interval '5 minutes' THEN
    RAISE EXCEPTION 'Core history generation publication request is invalid';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    p_owner_id::text || ':core-history-generation-active', 0
  ));
  SELECT stored.* INTO v_generation
  FROM dna.dna_core_race_history_generation stored
  WHERE stored.owner_id = p_owner_id
    AND stored.generation_id = p_generation_id::character(64)
  FOR UPDATE;
  IF NOT FOUND OR v_generation.worker_id <> p_worker_id THEN
    RAISE EXCEPTION 'Core history generation publication claim is unavailable';
  END IF;
  IF v_generation.observation_count <> p_expected_observation_count
     OR v_generation.payload_sha256::text <> p_payload_sha256 THEN
    RAISE EXCEPTION 'Core history generation publication authority conflicts';
  END IF;
  IF v_generation.state = 'published' THEN
    RETURN NEXT v_generation;
    RETURN;
  END IF;
  IF p_published_at < v_generation.materialized_at THEN
    RAISE EXCEPTION 'Core history generation publication predates materialization';
  END IF;
  SELECT count(*)::integer,
    encode(sha256(convert_to(COALESCE(string_agg(
      row.ordinal::text || ':' || row.natural_key || ':'
        || row.row_sha256::text || E'\n', '' ORDER BY row.ordinal
    ), ''), 'UTF8')), 'hex')::character(64)
  INTO v_count, v_digest
  FROM dna.dna_core_race_history_generation_row row
  WHERE row.owner_id = p_owner_id
    AND row.generation_id = p_generation_id::character(64);
  IF v_count <> p_expected_observation_count OR v_digest::text <> p_payload_sha256
     OR (p_expected_observation_count > 0 AND NOT EXISTS (
       SELECT 1 FROM dna.dna_core_race_history_generation_row row
       WHERE row.owner_id = p_owner_id
         AND row.generation_id = p_generation_id::character(64)
       HAVING min(row.ordinal) = 0
         AND max(row.ordinal) = p_expected_observation_count - 1
         AND count(*) = p_expected_observation_count
     )) THEN
    RAISE EXCEPTION 'Core history generation count or digest verification failed';
  END IF;
  SELECT generation.* INTO v_active
  FROM dna.dna_core_race_history_generation_active active
  JOIN dna.dna_core_race_history_generation generation
    ON generation.owner_id = active.owner_id
   AND generation.generation_id = active.generation_id
  WHERE active.owner_id = p_owner_id
  FOR UPDATE OF generation;
  IF FOUND AND (
    v_active.materialized_at > v_generation.materialized_at
    OR (v_active.materialized_at = v_generation.materialized_at
      AND v_active.generation_id <> v_generation.generation_id)
    OR p_published_at < v_active.published_at
  ) THEN
    RAISE EXCEPTION 'Core history generation is older than last-good';
  END IF;
  UPDATE dna.dna_core_race_history_generation stored
  SET state = 'published', published_at = p_published_at
  WHERE stored.owner_id = p_owner_id
    AND stored.generation_id = p_generation_id::character(64)
  RETURNING stored.* INTO v_generation;
  INSERT INTO dna.dna_core_race_history_generation_active (
    owner_id, generation_id, activated_at
  ) VALUES (p_owner_id, p_generation_id::character(64), p_published_at)
  ON CONFLICT (owner_id) DO UPDATE SET
    generation_id = EXCLUDED.generation_id,
    activated_at = EXCLUDED.activated_at;
  RETURN NEXT v_generation;
END
$function$;

CREATE FUNCTION dna.read_dna_core_race_history_generation(
  p_owner_id uuid,
  p_generation_id text
)
RETURNS SETOF dna.dna_core_race_history_generation
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped Core history generation read denied';
  END IF;
  IF p_generation_id IS NULL OR p_generation_id !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'Core history generation read key is invalid';
  END IF;
  RETURN QUERY
  SELECT stored.* FROM dna.dna_core_race_history_generation stored
  WHERE stored.owner_id = p_owner_id
    AND stored.generation_id = p_generation_id::character(64)
    AND stored.state = 'published';
END
$function$;

DO $privileges$
DECLARE v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'dna_core_race_history_generation',
    'dna_core_race_history_generation_row',
    'dna_core_race_history_generation_active'
  ] LOOP
    EXECUTE format('REVOKE ALL ON TABLE dna.%I FROM PUBLIC', v_table);
    EXECUTE format('REVOKE ALL ON TABLE dna.%I FROM dna_app_runtime', v_table);
  END LOOP;
END
$privileges$;
REVOKE ALL ON FUNCTION dna.begin_dna_core_race_history_generation(uuid,text,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.stage_dna_core_race_history_generation_rows(uuid,text,text,integer,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.publish_dna_core_race_history_generation(uuid,text,text,integer,text,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.read_dna_core_race_history_generation(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION dna.begin_dna_core_race_history_generation(uuid,text,jsonb) TO dna_app_runtime;
GRANT EXECUTE ON FUNCTION dna.stage_dna_core_race_history_generation_rows(uuid,text,text,integer,jsonb) TO dna_app_runtime;
GRANT EXECUTE ON FUNCTION dna.publish_dna_core_race_history_generation(uuid,text,text,integer,text,timestamptz) TO dna_app_runtime;
GRANT EXECUTE ON FUNCTION dna.read_dna_core_race_history_generation(uuid,text) TO dna_app_runtime;

COMMIT;
