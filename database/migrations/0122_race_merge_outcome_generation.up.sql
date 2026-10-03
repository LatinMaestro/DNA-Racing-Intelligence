BEGIN;

CREATE TABLE dna.race_merge_outcome_generation (
  generation_key bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  owner_id uuid NOT NULL REFERENCES dna.app_owner(id) ON DELETE RESTRICT,
  generation_id text NOT NULL CHECK (
    generation_id ~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$'
  ),
  manifest_digest_sha256 character(64) NOT NULL
    CHECK (manifest_digest_sha256 ~ '^[a-f0-9]{64}$'),
  state text NOT NULL DEFAULT 'staging'
    CHECK (state IN ('staging', 'complete', 'aborted')),
  source_row_count bigint NOT NULL DEFAULT 0 CHECK (source_row_count >= 0),
  unique_outcome_count bigint CHECK (unique_outcome_count >= 0),
  exact_replay_count bigint NOT NULL DEFAULT 0 CHECK (exact_replay_count >= 0),
  object_count integer CHECK (object_count >= 0),
  outcome_set_digest_sha256 character(64)
    CHECK (outcome_set_digest_sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  completed_at timestamptz,
  aborted_at timestamptz,
  abort_reason text CHECK (
    abort_reason IS NULL OR abort_reason IN ('object_failed', 'finalization_failed')
  ),
  PRIMARY KEY (owner_id, generation_id),
  CHECK (
    (state = 'staging' AND completed_at IS NULL)
    OR (state = 'complete' AND completed_at IS NOT NULL)
    OR (state = 'aborted' AND completed_at IS NULL AND aborted_at IS NOT NULL)
  ),
  CHECK (
    (state = 'complete' AND unique_outcome_count IS NOT NULL
      AND object_count IS NOT NULL AND outcome_set_digest_sha256 IS NOT NULL)
    OR state <> 'complete'
  )
);

CREATE TABLE dna.race_merge_outcome_object (
  object_key bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  generation_key bigint NOT NULL
    REFERENCES dna.race_merge_outcome_generation(generation_key)
    ON DELETE RESTRICT,
  object_id text NOT NULL CHECK (
    object_id ~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$'
  ),
  expected_byte_length bigint NOT NULL CHECK (expected_byte_length > 0),
  expected_sha256 bytea NOT NULL CHECK (octet_length(expected_sha256) = 32),
  state text NOT NULL DEFAULT 'staging' CHECK (state IN ('staging', 'complete')),
  appended_row_count bigint NOT NULL DEFAULT 0 CHECK (appended_row_count >= 0),
  ordered_outcome_digest_sha256 character(64),
  verified_chunk_count integer CHECK (verified_chunk_count > 0),
  completed_at timestamptz,
  PRIMARY KEY (generation_key, object_id),
  CHECK (
    (state = 'staging' AND completed_at IS NULL)
    OR (state = 'complete' AND completed_at IS NOT NULL
      AND ordered_outcome_digest_sha256 ~ '^[a-f0-9]{64}$'
      AND verified_chunk_count IS NOT NULL)
  )
);

CREATE TABLE dna.race_merge_outcome (
  generation_key bigint NOT NULL
    REFERENCES dna.race_merge_outcome_generation(generation_key)
    ON DELETE RESTRICT,
  source_core_id bigint NOT NULL CHECK (source_core_id > 0),
  source_race_id text NOT NULL CHECK (
    length(source_race_id) BETWEEN 1 AND 512
    AND source_race_id !~ '[[:cntrl:]]'
  ),
  finish_position integer NOT NULL CHECK (finish_position > 0),
  elapsed_milliseconds bigint NOT NULL CHECK (elapsed_milliseconds > 0),
  source_object_key bigint NOT NULL
    REFERENCES dna.race_merge_outcome_object(object_key)
    ON DELETE RESTRICT,
  source_row_number integer NOT NULL CHECK (source_row_number > 0),
  PRIMARY KEY (generation_key, source_core_id, source_race_id)
);

CREATE FUNCTION dna.race_merge_outcome_generation_owned(p_generation_key bigint)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = pg_catalog, pg_temp
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM dna.race_merge_outcome_generation generation
    WHERE generation.generation_key = p_generation_key
      AND generation.owner_id = dna.current_owner_id()
  )
$function$;

DO $rls$
DECLARE v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'race_merge_outcome_generation',
    'race_merge_outcome_object',
    'race_merge_outcome'
  ] LOOP
    EXECUTE format('ALTER TABLE dna.%I ENABLE ROW LEVEL SECURITY', v_table);
    EXECUTE format('ALTER TABLE dna.%I FORCE ROW LEVEL SECURITY', v_table);
  END LOOP;
END
$rls$;

CREATE POLICY owner_isolation ON dna.race_merge_outcome_generation
  USING (owner_id = dna.current_owner_id())
  WITH CHECK (owner_id = dna.current_owner_id());
CREATE POLICY owner_isolation ON dna.race_merge_outcome_object
  USING (dna.race_merge_outcome_generation_owned(generation_key))
  WITH CHECK (dna.race_merge_outcome_generation_owned(generation_key));
CREATE POLICY owner_isolation ON dna.race_merge_outcome
  USING (dna.race_merge_outcome_generation_owned(generation_key))
  WITH CHECK (dna.race_merge_outcome_generation_owned(generation_key));

CREATE FUNCTION dna.begin_race_merge_outcome_object(
  p_owner_id uuid,
  p_generation_id text,
  p_manifest_digest_sha256 text,
  p_object_id text,
  p_expected_byte_length bigint,
  p_expected_sha256 text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_generation dna.race_merge_outcome_generation%ROWTYPE;
  v_object dna.race_merge_outcome_object%ROWTYPE;
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id()
     OR p_generation_id !~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$'
     OR p_object_id !~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$'
     OR p_manifest_digest_sha256 !~ '^[a-f0-9]{64}$'
     OR p_expected_sha256 !~ '^[a-f0-9]{64}$'
     OR p_expected_byte_length NOT BETWEEN 1 AND 9500000000 THEN
    RAISE EXCEPTION 'Race Merge outcome object authority is invalid';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    p_owner_id::text || ':race-merge-outcomes:' || p_generation_id, 0
  ));
  SELECT stored.* INTO v_generation
  FROM dna.race_merge_outcome_generation stored
  WHERE stored.owner_id = p_owner_id AND stored.generation_id = p_generation_id
  FOR UPDATE;
  IF FOUND THEN
    IF v_generation.manifest_digest_sha256::text <> p_manifest_digest_sha256
       OR v_generation.state = 'complete' THEN
      RAISE EXCEPTION 'Race Merge outcome generation replay conflicts';
    END IF;
    IF v_generation.state = 'aborted' THEN
      UPDATE dna.race_merge_outcome_generation stored
      SET state = 'staging', aborted_at = NULL, abort_reason = NULL
      WHERE stored.generation_key = v_generation.generation_key;
    END IF;
  ELSE
    INSERT INTO dna.race_merge_outcome_generation (
      owner_id, generation_id, manifest_digest_sha256
    ) VALUES (p_owner_id, p_generation_id, p_manifest_digest_sha256)
    RETURNING * INTO v_generation;
  END IF;
  SELECT stored.* INTO v_object
  FROM dna.race_merge_outcome_object stored
  WHERE stored.generation_key = v_generation.generation_key
    AND stored.object_id = p_object_id
  FOR UPDATE;
  IF FOUND THEN
    IF v_object.expected_byte_length <> p_expected_byte_length
       OR encode(v_object.expected_sha256, 'hex') <> p_expected_sha256 THEN
      RAISE EXCEPTION 'Race Merge outcome object replay conflicts';
    END IF;
    RETURN v_object.state;
  END IF;
  INSERT INTO dna.race_merge_outcome_object (
    generation_key, object_id, expected_byte_length, expected_sha256
  ) VALUES (
    v_generation.generation_key, p_object_id, p_expected_byte_length,
    decode(p_expected_sha256, 'hex')
  );
  RETURN 'staging';
END
$function$;

CREATE FUNCTION dna.append_race_merge_outcomes(
  p_owner_id uuid,
  p_generation_id text,
  p_object_id text,
  p_rows jsonb
)
RETURNS TABLE (accepted_count integer, exact_replay_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_generation dna.race_merge_outcome_generation%ROWTYPE;
  v_object dna.race_merge_outcome_object%ROWTYPE;
  v_row_count integer;
  v_inserted integer;
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id()
     OR p_generation_id !~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$'
     OR p_object_id !~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$'
     OR jsonb_typeof(p_rows) <> 'array'
     OR jsonb_array_length(p_rows) NOT BETWEEN 1 AND 10000 THEN
    RAISE EXCEPTION 'Race Merge outcome batch is invalid';
  END IF;
  SELECT generation.* INTO v_generation
  FROM dna.race_merge_outcome_generation generation
  WHERE generation.owner_id = p_owner_id
    AND generation.generation_id = p_generation_id
  FOR UPDATE;
  IF NOT FOUND OR v_generation.state <> 'staging' THEN
    RAISE EXCEPTION 'Race Merge outcome staging claim is unavailable';
  END IF;
  SELECT object.* INTO v_object
  FROM dna.race_merge_outcome_object object
  WHERE object.generation_key = v_generation.generation_key
    AND object.object_id = p_object_id
  FOR UPDATE;
  IF NOT FOUND OR v_object.state <> 'staging' THEN
    RAISE EXCEPTION 'Race Merge outcome staging claim is unavailable';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_rows) entry
    WHERE jsonb_typeof(entry) <> 'object'
      OR (SELECT count(*) FROM jsonb_object_keys(entry)) <> 7
      OR NOT (entry ?& ARRAY[
        'sourceCoreId', 'sourceRaceId', 'finishPosition',
        'elapsedMilliseconds', 'source', 'sourceObjectSha256',
        'sourceRowNumber'
      ])
      OR entry ->> 'source' <> 'race_merge'
      OR entry ->> 'sourceObjectSha256' <>
        encode(v_object.expected_sha256, 'hex')
      OR jsonb_typeof(entry -> 'sourceRaceId') <> 'string'
      OR length(entry ->> 'sourceRaceId') NOT BETWEEN 1 AND 512
      OR entry ->> 'sourceRaceId' ~ '[[:cntrl:]]'
      OR entry ->> 'sourceCoreId' !~ '^[1-9][0-9]*$'
      OR (entry ->> 'sourceCoreId')::numeric > 9223372036854775807
      OR entry ->> 'finishPosition' !~ '^[1-9][0-9]*$'
      OR (entry ->> 'finishPosition')::numeric > 2147483647
      OR entry ->> 'elapsedMilliseconds' !~ '^[1-9][0-9]*$'
      OR (entry ->> 'elapsedMilliseconds')::numeric > 9223372036854775807
      OR entry ->> 'sourceRowNumber' !~ '^[1-9][0-9]*$'
      OR (entry ->> 'sourceRowNumber')::numeric > 100000000
  ) THEN
    RAISE EXCEPTION 'Race Merge outcome row is invalid';
  END IF;
  IF EXISTS (
    WITH parsed AS (
      SELECT (entry ->> 'sourceCoreId')::bigint AS source_core_id,
        entry ->> 'sourceRaceId' AS source_race_id,
        (entry ->> 'finishPosition')::integer AS finish_position,
        (entry ->> 'elapsedMilliseconds')::bigint AS elapsed_milliseconds
      FROM jsonb_array_elements(p_rows) entry
    )
    SELECT 1 FROM parsed
    GROUP BY source_core_id, source_race_id
    HAVING count(DISTINCT (finish_position, elapsed_milliseconds)) > 1
  ) THEN
    RAISE EXCEPTION 'Race Merge outcome batch conflicts internally';
  END IF;
  IF EXISTS (
    WITH parsed AS (
      SELECT (entry ->> 'sourceCoreId')::bigint AS source_core_id,
        entry ->> 'sourceRaceId' AS source_race_id,
        (entry ->> 'finishPosition')::integer AS finish_position,
        (entry ->> 'elapsedMilliseconds')::bigint AS elapsed_milliseconds
      FROM jsonb_array_elements(p_rows) entry
    )
    SELECT 1 FROM parsed
    JOIN dna.race_merge_outcome existing
      ON existing.generation_key = v_generation.generation_key
     AND existing.source_core_id = parsed.source_core_id
     AND existing.source_race_id = parsed.source_race_id
    WHERE existing.finish_position <> parsed.finish_position
       OR existing.elapsed_milliseconds <> parsed.elapsed_milliseconds
  ) THEN
    RAISE EXCEPTION 'Race/Core outcome conflict';
  END IF;
  v_row_count := jsonb_array_length(p_rows);
  WITH parsed AS (
    SELECT DISTINCT ON (
      (entry ->> 'sourceCoreId')::bigint, entry ->> 'sourceRaceId'
    )
      (entry ->> 'sourceCoreId')::bigint AS source_core_id,
      entry ->> 'sourceRaceId' AS source_race_id,
      (entry ->> 'finishPosition')::integer AS finish_position,
      (entry ->> 'elapsedMilliseconds')::bigint AS elapsed_milliseconds,
      (entry ->> 'sourceRowNumber')::integer AS source_row_number
    FROM jsonb_array_elements(p_rows) entry
    ORDER BY (entry ->> 'sourceCoreId')::bigint,
      entry ->> 'sourceRaceId', (entry ->> 'sourceRowNumber')::integer
  )
  INSERT INTO dna.race_merge_outcome (
    generation_key, source_core_id, source_race_id, finish_position,
    elapsed_milliseconds, source_object_key, source_row_number
  )
  SELECT v_generation.generation_key, parsed.source_core_id,
    parsed.source_race_id, parsed.finish_position,
    parsed.elapsed_milliseconds, v_object.object_key,
    parsed.source_row_number
  FROM parsed
  ON CONFLICT (generation_key, source_core_id, source_race_id) DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  UPDATE dna.race_merge_outcome_object stored
  SET appended_row_count = appended_row_count + v_row_count
  WHERE stored.object_key = v_object.object_key;
  UPDATE dna.race_merge_outcome_generation stored
  SET source_row_count = source_row_count + v_row_count,
    exact_replay_count = exact_replay_count + (v_row_count - v_inserted)
  WHERE stored.generation_key = v_generation.generation_key;
  RETURN QUERY SELECT v_inserted, v_row_count - v_inserted;
END
$function$;

CREATE FUNCTION dna.commit_race_merge_outcome_object(
  p_owner_id uuid,
  p_generation_id text,
  p_object_id text,
  p_verified jsonb
)
RETURNS TABLE (
  object_id text, byte_length bigint, sha256 text, row_count bigint,
  ordered_outcome_digest_sha256 text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_object dna.race_merge_outcome_object%ROWTYPE;
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id()
     OR jsonb_typeof(p_verified) <> 'object'
     OR (SELECT count(*) FROM jsonb_object_keys(p_verified)) <> 5
     OR NOT (p_verified ?& ARRAY[
       'byteLength', 'sha256', 'chunkCount', 'rowCount',
       'orderedOutcomeDigestSha256'
     ])
     OR p_verified ->> 'sha256' !~ '^[a-f0-9]{64}$'
     OR p_verified ->> 'orderedOutcomeDigestSha256' !~ '^[a-f0-9]{64}$'
     OR p_verified ->> 'byteLength' !~ '^[1-9][0-9]*$'
     OR p_verified ->> 'chunkCount' !~ '^[1-9][0-9]*$'
     OR p_verified ->> 'rowCount' !~ '^[1-9][0-9]*$' THEN
    RAISE EXCEPTION 'Race Merge outcome object verification is invalid';
  END IF;
  SELECT object.* INTO v_object
  FROM dna.race_merge_outcome_generation generation
  JOIN dna.race_merge_outcome_object object
    ON object.generation_key = generation.generation_key
  WHERE generation.owner_id = p_owner_id
    AND generation.generation_id = p_generation_id
    AND generation.state = 'staging'
    AND object.object_id = p_object_id
  FOR UPDATE OF object;
  IF NOT FOUND
     OR v_object.expected_byte_length <> (p_verified ->> 'byteLength')::bigint
     OR encode(v_object.expected_sha256, 'hex') <> p_verified ->> 'sha256'
     OR v_object.appended_row_count <> (p_verified ->> 'rowCount')::bigint THEN
    RAISE EXCEPTION 'Race Merge outcome object verification conflicts';
  END IF;
  IF v_object.state = 'complete' THEN
    IF v_object.verified_chunk_count <> (p_verified ->> 'chunkCount')::integer
       OR v_object.ordered_outcome_digest_sha256::text <>
         p_verified ->> 'orderedOutcomeDigestSha256' THEN
      RAISE EXCEPTION 'Race Merge outcome object receipt replay conflicts';
    END IF;
  ELSE
    UPDATE dna.race_merge_outcome_object stored
    SET state = 'complete',
      verified_chunk_count = (p_verified ->> 'chunkCount')::integer,
      ordered_outcome_digest_sha256 =
        (p_verified ->> 'orderedOutcomeDigestSha256')::character(64),
      completed_at = clock_timestamp()
    WHERE stored.object_key = v_object.object_key;
  END IF;
  RETURN QUERY SELECT v_object.object_id, v_object.expected_byte_length,
    encode(v_object.expected_sha256, 'hex'), v_object.appended_row_count,
    p_verified ->> 'orderedOutcomeDigestSha256';
END
$function$;

CREATE FUNCTION dna.read_race_merge_outcome_object_receipt(
  p_owner_id uuid, p_generation_id text, p_object_id text
)
RETURNS TABLE (
  object_id text, byte_length bigint, sha256 text, row_count bigint,
  ordered_outcome_digest_sha256 text
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped Race Merge outcome receipt read denied';
  END IF;
  RETURN QUERY
  SELECT object.object_id, object.expected_byte_length,
    encode(object.expected_sha256, 'hex'), object.appended_row_count,
    object.ordered_outcome_digest_sha256::text
  FROM dna.race_merge_outcome_generation generation
  JOIN dna.race_merge_outcome_object object
    ON object.generation_key = generation.generation_key
  WHERE generation.owner_id = p_owner_id
    AND generation.generation_id = p_generation_id
    AND object.object_id = p_object_id AND object.state = 'complete';
END
$function$;

CREATE FUNCTION dna.inspect_race_merge_outcome_generation(
  p_owner_id uuid, p_generation_id text, p_manifest_digest_sha256 text,
  p_objects jsonb
)
RETURNS TABLE (
  state text, source_row_count bigint, unique_outcome_count bigint,
  exact_replay_count bigint, object_count integer,
  outcome_set_digest_sha256 text
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_generation dna.race_merge_outcome_generation%ROWTYPE;
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id()
     OR p_manifest_digest_sha256 !~ '^[a-f0-9]{64}$'
     OR jsonb_typeof(p_objects) <> 'array'
     OR jsonb_array_length(p_objects) NOT BETWEEN 1 AND 24 THEN
    RAISE EXCEPTION 'Race Merge outcome generation inspection is invalid';
  END IF;
  SELECT stored.* INTO v_generation
  FROM dna.race_merge_outcome_generation stored
  WHERE stored.owner_id = p_owner_id AND stored.generation_id = p_generation_id;
  IF NOT FOUND OR v_generation.manifest_digest_sha256::text <>
       p_manifest_digest_sha256 THEN
    RAISE EXCEPTION 'Race Merge outcome generation is unavailable';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_objects) receipt
    WHERE jsonb_typeof(receipt) <> 'object'
      OR receipt ->> 'sha256' !~ '^[a-f0-9]{64}$'
      OR receipt ->> 'orderedOutcomeDigestSha256' !~ '^[a-f0-9]{64}$'
      OR NOT EXISTS (
        SELECT 1 FROM dna.race_merge_outcome_object object
        WHERE object.generation_key = v_generation.generation_key
          AND object.state = 'complete'
          AND object.object_id = receipt ->> 'objectId'
          AND object.expected_byte_length = (receipt ->> 'byteLength')::bigint
          AND encode(object.expected_sha256, 'hex') = receipt ->> 'sha256'
          AND object.appended_row_count = (receipt ->> 'rowCount')::bigint
          AND object.ordered_outcome_digest_sha256::text =
            receipt ->> 'orderedOutcomeDigestSha256'
      )
  ) OR (SELECT count(*) FROM dna.race_merge_outcome_object object
        WHERE object.generation_key = v_generation.generation_key) <>
       jsonb_array_length(p_objects)
     OR (SELECT count(*) FROM dna.race_merge_outcome_object object
        WHERE object.generation_key = v_generation.generation_key
          AND object.state = 'complete') <> jsonb_array_length(p_objects) THEN
    RAISE EXCEPTION 'Race Merge outcome object coverage is incomplete';
  END IF;
  RETURN QUERY SELECT v_generation.state, v_generation.source_row_count,
    COALESCE(v_generation.unique_outcome_count, (
      SELECT count(*) FROM dna.race_merge_outcome outcome
      WHERE outcome.generation_key = v_generation.generation_key
    )), v_generation.exact_replay_count,
    jsonb_array_length(p_objects), v_generation.outcome_set_digest_sha256::text;
END
$function$;

CREATE FUNCTION dna.read_race_merge_outcome_digest_page(
  p_owner_id uuid, p_generation_id text, p_after_core_id bigint,
  p_after_race_id text, p_limit integer
)
RETURNS TABLE (
  source_core_id bigint, source_race_id text, finish_position integer,
  elapsed_milliseconds bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE v_generation_key bigint;
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id()
     OR p_after_core_id < 0 OR p_limit NOT BETWEEN 1 AND 10000
     OR (p_after_core_id > 0 AND p_after_race_id IS NULL) THEN
    RAISE EXCEPTION 'Race Merge outcome digest page request is invalid';
  END IF;
  SELECT generation.generation_key INTO v_generation_key
  FROM dna.race_merge_outcome_generation generation
  WHERE generation.owner_id = p_owner_id
    AND generation.generation_id = p_generation_id
    AND generation.state IN ('staging', 'complete')
    AND NOT EXISTS (
      SELECT 1 FROM dna.race_merge_outcome_object object
      WHERE object.generation_key = generation.generation_key
        AND object.state <> 'complete'
    );
  IF NOT FOUND THEN RAISE EXCEPTION 'Race Merge outcome generation is not sealed'; END IF;
  RETURN QUERY
  SELECT outcome.source_core_id, outcome.source_race_id,
    outcome.finish_position, outcome.elapsed_milliseconds
  FROM dna.race_merge_outcome outcome
  WHERE outcome.generation_key = v_generation_key
    AND (outcome.source_core_id, outcome.source_race_id COLLATE "C") >
      (p_after_core_id, COALESCE(p_after_race_id, '') COLLATE "C")
  ORDER BY outcome.source_core_id, outcome.source_race_id COLLATE "C"
  LIMIT p_limit;
END
$function$;

CREATE FUNCTION dna.complete_race_merge_outcome_generation(
  p_owner_id uuid, p_generation_id text, p_manifest_digest_sha256 text,
  p_object_count integer, p_unique_outcome_count bigint,
  p_outcome_set_digest_sha256 text
)
RETURNS SETOF dna.race_merge_outcome_generation
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE v_generation dna.race_merge_outcome_generation%ROWTYPE;
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id()
     OR p_manifest_digest_sha256 !~ '^[a-f0-9]{64}$'
     OR p_outcome_set_digest_sha256 !~ '^[a-f0-9]{64}$'
     OR p_object_count NOT BETWEEN 1 AND 24 OR p_unique_outcome_count < 1 THEN
    RAISE EXCEPTION 'Race Merge outcome completion is invalid';
  END IF;
  SELECT stored.* INTO v_generation
  FROM dna.race_merge_outcome_generation stored
  WHERE stored.owner_id = p_owner_id AND stored.generation_id = p_generation_id
  FOR UPDATE;
  IF NOT FOUND OR v_generation.manifest_digest_sha256::text <>
       p_manifest_digest_sha256 THEN
    RAISE EXCEPTION 'Race Merge outcome completion authority conflicts';
  END IF;
  IF v_generation.state = 'complete' THEN
    IF v_generation.object_count <> p_object_count
       OR v_generation.unique_outcome_count <> p_unique_outcome_count
       OR v_generation.outcome_set_digest_sha256::text <>
         p_outcome_set_digest_sha256 THEN
      RAISE EXCEPTION 'Race Merge outcome completion replay conflicts';
    END IF;
    RETURN NEXT v_generation; RETURN;
  END IF;
  IF v_generation.state <> 'staging'
     OR (SELECT count(*) FROM dna.race_merge_outcome_object object
         WHERE object.generation_key = v_generation.generation_key) <>
        p_object_count
     OR (SELECT count(*) FROM dna.race_merge_outcome_object object
         WHERE object.generation_key = v_generation.generation_key
           AND object.state = 'complete') <> p_object_count
     OR (SELECT count(*) FROM dna.race_merge_outcome outcome
         WHERE outcome.generation_key = v_generation.generation_key) <>
        p_unique_outcome_count
     OR v_generation.source_row_count < p_unique_outcome_count
     OR v_generation.source_row_count <>
        p_unique_outcome_count + v_generation.exact_replay_count THEN
    RAISE EXCEPTION 'Race Merge outcome completion coverage is incomplete';
  END IF;
  UPDATE dna.race_merge_outcome_generation stored
  SET state = 'complete', object_count = p_object_count,
    unique_outcome_count = p_unique_outcome_count,
    outcome_set_digest_sha256 = p_outcome_set_digest_sha256::character(64),
    completed_at = clock_timestamp()
  WHERE stored.generation_key = v_generation.generation_key
  RETURNING stored.* INTO v_generation;
  RETURN NEXT v_generation;
END
$function$;

CREATE FUNCTION dna.abort_race_merge_outcome_generation(
  p_owner_id uuid, p_generation_id text, p_reason text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id()
     OR p_reason NOT IN ('object_failed', 'finalization_failed') THEN
    RAISE EXCEPTION 'Race Merge outcome abort is invalid';
  END IF;
  UPDATE dna.race_merge_outcome_generation stored
  SET state = CASE WHEN p_reason = 'object_failed' THEN 'aborted' ELSE 'staging' END,
    aborted_at = clock_timestamp(), abort_reason = p_reason
  WHERE stored.owner_id = p_owner_id AND stored.generation_id = p_generation_id
    AND stored.state <> 'complete';
END
$function$;

CREATE FUNCTION dna.read_race_merge_core_outcomes(
  p_owner_id uuid, p_generation_id text, p_source_core_id bigint
)
RETURNS TABLE (
  source_race_id text, source_core_id bigint, finish_position integer,
  elapsed_milliseconds bigint, source_object_sha256 text,
  source_row_number integer
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id()
     OR p_source_core_id < 1 THEN
    RAISE EXCEPTION 'Race Merge Core outcome read is invalid';
  END IF;
  RETURN QUERY
  SELECT outcome.source_race_id, outcome.source_core_id,
    outcome.finish_position, outcome.elapsed_milliseconds,
    encode(object.expected_sha256, 'hex'), outcome.source_row_number
  FROM dna.race_merge_outcome_generation generation
  JOIN dna.race_merge_outcome outcome
    ON outcome.generation_key = generation.generation_key
  JOIN dna.race_merge_outcome_object object
    ON object.object_key = outcome.source_object_key
  WHERE generation.owner_id = p_owner_id
    AND generation.generation_id = p_generation_id
    AND generation.state = 'complete'
    AND outcome.source_core_id = p_source_core_id
  ORDER BY outcome.source_race_id COLLATE "C";
END
$function$;

DO $privileges$
DECLARE v_table text; v_function text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'race_merge_outcome_generation', 'race_merge_outcome_object',
    'race_merge_outcome'
  ] LOOP
    EXECUTE format('REVOKE ALL ON TABLE dna.%I FROM PUBLIC', v_table);
    EXECUTE format('REVOKE ALL ON TABLE dna.%I FROM dna_app_runtime', v_table);
  END LOOP;
  FOREACH v_function IN ARRAY ARRAY[
    'dna.race_merge_outcome_generation_owned(bigint)',
    'dna.begin_race_merge_outcome_object(uuid,text,text,text,bigint,text)',
    'dna.append_race_merge_outcomes(uuid,text,text,jsonb)',
    'dna.commit_race_merge_outcome_object(uuid,text,text,jsonb)',
    'dna.read_race_merge_outcome_object_receipt(uuid,text,text)',
    'dna.inspect_race_merge_outcome_generation(uuid,text,text,jsonb)',
    'dna.read_race_merge_outcome_digest_page(uuid,text,bigint,text,integer)',
    'dna.complete_race_merge_outcome_generation(uuid,text,text,integer,bigint,text)',
    'dna.abort_race_merge_outcome_generation(uuid,text,text)',
    'dna.read_race_merge_core_outcomes(uuid,text,bigint)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', v_function);
  END LOOP;
END
$privileges$;

GRANT EXECUTE ON FUNCTION dna.begin_race_merge_outcome_object(uuid,text,text,text,bigint,text) TO dna_app_runtime;
GRANT EXECUTE ON FUNCTION dna.race_merge_outcome_generation_owned(bigint) TO dna_app_runtime;
GRANT EXECUTE ON FUNCTION dna.append_race_merge_outcomes(uuid,text,text,jsonb) TO dna_app_runtime;
GRANT EXECUTE ON FUNCTION dna.commit_race_merge_outcome_object(uuid,text,text,jsonb) TO dna_app_runtime;
GRANT EXECUTE ON FUNCTION dna.read_race_merge_outcome_object_receipt(uuid,text,text) TO dna_app_runtime;
GRANT EXECUTE ON FUNCTION dna.inspect_race_merge_outcome_generation(uuid,text,text,jsonb) TO dna_app_runtime;
GRANT EXECUTE ON FUNCTION dna.read_race_merge_outcome_digest_page(uuid,text,bigint,text,integer) TO dna_app_runtime;
GRANT EXECUTE ON FUNCTION dna.complete_race_merge_outcome_generation(uuid,text,text,integer,bigint,text) TO dna_app_runtime;
GRANT EXECUTE ON FUNCTION dna.abort_race_merge_outcome_generation(uuid,text,text) TO dna_app_runtime;
GRANT EXECUTE ON FUNCTION dna.read_race_merge_core_outcomes(uuid,text,bigint) TO dna_app_runtime;

COMMIT;
