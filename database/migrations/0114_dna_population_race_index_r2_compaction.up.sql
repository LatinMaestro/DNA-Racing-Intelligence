BEGIN;

DROP INDEX IF EXISTS dna.dna_population_race_index_race_mode_idx;

ALTER TABLE dna.dna_population_race_index_generation
  ADD COLUMN generation_key bigint GENERATED ALWAYS AS IDENTITY,
  ADD COLUMN storage_layout text,
  ADD COLUMN r2_chunk_count integer NOT NULL DEFAULT 0 CHECK (r2_chunk_count >= 0),
  ADD COLUMN r2_compacted_race_count integer NOT NULL DEFAULT 0
    CHECK (r2_compacted_race_count >= 0),
  ADD COLUMN r2_last_source_race_id text CHECK (
    r2_last_source_race_id IS NULL
    OR (
      length(r2_last_source_race_id) BETWEEN 1 AND 512
      AND r2_last_source_race_id !~ '[[:cntrl:]]'
    )
  ),
  ADD COLUMN compacted_at timestamptz,
  ADD COLUMN legacy_storage_retired_at timestamptz;

UPDATE dna.dna_population_race_index_generation
SET storage_layout = 'legacy_neon_v1'
WHERE storage_layout IS NULL;

ALTER TABLE dna.dna_population_race_index_generation
  ALTER COLUMN storage_layout SET NOT NULL,
  ALTER COLUMN storage_layout SET DEFAULT 'r2_chunked_v1',
  ADD CONSTRAINT dna_population_race_index_generation_storage_layout_check
    CHECK (storage_layout IN ('legacy_neon_v1', 'r2_chunked_v1')),
  ADD CONSTRAINT dna_population_race_index_generation_generation_key_key
    UNIQUE (generation_key),
  ADD CONSTRAINT dna_population_race_index_generation_compaction_state_check
    CHECK (
      (storage_layout = 'legacy_neon_v1' AND compacted_at IS NULL)
      OR (storage_layout = 'r2_chunked_v1')
    );

CREATE FUNCTION dna.dna_population_race_index_generation_owned(p_generation_key bigint)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = pg_catalog, pg_temp
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM dna.dna_population_race_index_generation generation
    WHERE generation.generation_key = p_generation_key
      AND generation.owner_id = dna.current_owner_id()
  )
$function$;

CREATE TABLE dna.dna_population_race_index_compact_identity (
  generation_key bigint NOT NULL
    REFERENCES dna.dna_population_race_index_generation(generation_key)
    ON DELETE RESTRICT,
  source_race_id text NOT NULL CHECK (
    length(source_race_id) BETWEEN 1 AND 512
    AND source_race_id !~ '[[:cntrl:]]'
  ),
  raw_evidence_sha256 bytea NOT NULL CHECK (octet_length(raw_evidence_sha256) = 32)
);

CREATE TABLE dna.dna_population_race_index_r2_chunk (
  generation_key bigint NOT NULL
    REFERENCES dna.dna_population_race_index_generation(generation_key)
    ON DELETE RESTRICT,
  chunk_ordinal integer NOT NULL CHECK (chunk_ordinal > 0),
  object_key text NOT NULL CHECK (
    length(object_key) BETWEEN 1 AND 2048
    AND object_key !~ '[[:cntrl:]]'
  ),
  body_sha256 character(64) NOT NULL CHECK (body_sha256 ~ '^[a-f0-9]{64}$'),
  byte_length integer NOT NULL CHECK (byte_length BETWEEN 1 AND 8388608),
  row_count integer NOT NULL CHECK (row_count BETWEEN 1 AND 5000),
  first_source_race_id text NOT NULL CHECK (
    length(first_source_race_id) BETWEEN 1 AND 512
    AND first_source_race_id !~ '[[:cntrl:]]'
  ),
  last_source_race_id text NOT NULL CHECK (
    length(last_source_race_id) BETWEEN 1 AND 512
    AND last_source_race_id !~ '[[:cntrl:]]'
  ),
  registered_at timestamptz NOT NULL,
  identity_registered_at timestamptz,
  PRIMARY KEY (generation_key, chunk_ordinal),
  UNIQUE (object_key),
  CHECK ((first_source_race_id COLLATE "C") <= (last_source_race_id COLLATE "C"))
);

ALTER TABLE dna.dna_population_race_index_compact_identity ENABLE ROW LEVEL SECURITY;
ALTER TABLE dna.dna_population_race_index_compact_identity FORCE ROW LEVEL SECURITY;
ALTER TABLE dna.dna_population_race_index_r2_chunk ENABLE ROW LEVEL SECURITY;
ALTER TABLE dna.dna_population_race_index_r2_chunk FORCE ROW LEVEL SECURITY;

CREATE POLICY owner_isolation
  ON dna.dna_population_race_index_compact_identity
  USING (dna.dna_population_race_index_generation_owned(generation_key))
  WITH CHECK (dna.dna_population_race_index_generation_owned(generation_key));
CREATE POLICY owner_isolation
  ON dna.dna_population_race_index_r2_chunk
  USING (dna.dna_population_race_index_generation_owned(generation_key))
  WITH CHECK (dna.dna_population_race_index_generation_owned(generation_key));

CREATE FUNCTION dna.read_dna_population_race_index_legacy_chunk(
  p_owner_id uuid,
  p_generation_id text,
  p_after_source_race_id text,
  p_limit integer
)
RETURNS TABLE (
  request_ordinal integer,
  endpoint text,
  observed_at timestamptz,
  source_race_id text,
  raw_evidence_sha256 text,
  canonical jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_generation dna.dna_population_race_index_generation%ROWTYPE;
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id()
     OR p_generation_id IS NULL OR p_generation_id !~ '^[a-f0-9]{64}$'
     OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 5000
     OR (
       p_after_source_race_id IS NOT NULL
       AND (
         length(p_after_source_race_id) NOT BETWEEN 1 AND 512
         OR p_after_source_race_id ~ '[[:cntrl:]]'
       )
     ) THEN
    RAISE EXCEPTION 'owner-scoped legacy population race chunk read denied';
  END IF;

  SELECT stored.* INTO v_generation
  FROM dna.dna_population_race_index_generation stored
  WHERE stored.owner_id = p_owner_id
    AND stored.generation_id = p_generation_id::character(64);

  IF NOT FOUND OR v_generation.storage_layout <> 'legacy_neon_v1'
     OR v_generation.legacy_storage_retired_at IS NOT NULL THEN
    RAISE EXCEPTION 'legacy population race storage is unavailable';
  END IF;

  RETURN QUERY
  SELECT
    race.request_ordinal,
    race.endpoint,
    race.observed_at,
    race.source_race_id,
    race.raw_evidence_sha256::text,
    race.canonical
  FROM dna.dna_population_race_index_race race
  WHERE race.owner_id = p_owner_id
    AND race.generation_id = p_generation_id::character(64)
    AND (
      p_after_source_race_id IS NULL
      OR (race.source_race_id COLLATE "C") >
         (p_after_source_race_id COLLATE "C")
    )
  ORDER BY race.source_race_id COLLATE "C"
  LIMIT p_limit;
END
$function$;

CREATE FUNCTION dna.register_dna_population_race_index_r2_compaction_chunk(
  p_owner_id uuid,
  p_worker_id text,
  p_generation_id text,
  p_receipt jsonb,
  p_identities jsonb,
  p_registered_at timestamptz
)
RETURNS SETOF dna.dna_population_race_index_generation
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_generation dna.dna_population_race_index_generation%ROWTYPE;
  v_existing dna.dna_population_race_index_r2_chunk%ROWTYPE;
  v_generation_key bigint;
  v_chunk_ordinal integer;
  v_object_key text;
  v_body_sha text;
  v_byte_length integer;
  v_row_count integer;
  v_first text;
  v_last text;
  v_previous_last text;
  v_min text;
  v_max text;
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id()
     OR p_worker_id IS NULL OR p_worker_id <> btrim(p_worker_id)
     OR p_worker_id !~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$'
     OR p_generation_id IS NULL OR p_generation_id !~ '^[a-f0-9]{64}$'
     OR p_receipt IS NULL OR jsonb_typeof(p_receipt) <> 'object'
     OR p_identities IS NULL OR jsonb_typeof(p_identities) <> 'array'
     OR p_registered_at IS NULL
     OR p_registered_at > clock_timestamp() + interval '5 minutes' THEN
    RAISE EXCEPTION 'population R2 compaction registration is invalid';
  END IF;

  IF (SELECT count(*) FROM jsonb_object_keys(p_receipt)) <> 9
     OR NOT (p_receipt ?& ARRAY[
       'version', 'generationId', 'chunkOrdinal', 'objectKey', 'bodySha256',
       'byteLength', 'rowCount', 'firstSourceRaceId', 'lastSourceRaceId'
     ])
     OR p_receipt ->> 'version' <> '1'
     OR p_receipt ->> 'generationId' <> p_generation_id
     OR p_receipt ->> 'bodySha256' !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'population R2 compaction receipt is invalid';
  END IF;

  BEGIN
    v_chunk_ordinal := (p_receipt ->> 'chunkOrdinal')::integer;
    v_byte_length := (p_receipt ->> 'byteLength')::integer;
    v_row_count := (p_receipt ->> 'rowCount')::integer;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'population R2 compaction receipt counters are invalid';
  END;
  v_object_key := p_receipt ->> 'objectKey';
  v_body_sha := p_receipt ->> 'bodySha256';
  v_first := p_receipt ->> 'firstSourceRaceId';
  v_last := p_receipt ->> 'lastSourceRaceId';

  IF v_chunk_ordinal < 1 OR v_byte_length NOT BETWEEN 1 AND 8388608
     OR v_row_count NOT BETWEEN 1 AND 5000
     OR jsonb_array_length(p_identities) <> v_row_count
     OR length(v_object_key) NOT BETWEEN 1 AND 2048 OR v_object_key ~ '[[:cntrl:]]'
     OR length(v_first) NOT BETWEEN 1 AND 512 OR v_first ~ '[[:cntrl:]]'
     OR length(v_last) NOT BETWEEN 1 AND 512 OR v_last ~ '[[:cntrl:]]'
     OR (v_first COLLATE "C") > (v_last COLLATE "C") THEN
    RAISE EXCEPTION 'population R2 compaction receipt bounds are invalid';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    p_owner_id::text || ':population-race-index:' || p_generation_id, 0
  ));
  SELECT stored.* INTO v_generation
  FROM dna.dna_population_race_index_generation stored
  WHERE stored.owner_id = p_owner_id
    AND stored.generation_id = p_generation_id::character(64)
  FOR UPDATE;

  IF NOT FOUND OR v_generation.worker_id <> p_worker_id
     OR v_generation.storage_layout <> 'legacy_neon_v1'
     OR v_generation.legacy_storage_retired_at IS NOT NULL THEN
    RAISE EXCEPTION 'population R2 compaction claim is unavailable';
  END IF;
  v_generation_key := v_generation.generation_key;

  SELECT chunk.* INTO v_existing
  FROM dna.dna_population_race_index_r2_chunk chunk
  WHERE chunk.generation_key = v_generation_key
    AND chunk.chunk_ordinal = v_chunk_ordinal
  FOR UPDATE;
  IF FOUND THEN
    IF v_existing.object_key <> v_object_key
       OR v_existing.body_sha256::text <> v_body_sha
       OR v_existing.byte_length <> v_byte_length
       OR v_existing.row_count <> v_row_count
       OR v_existing.first_source_race_id <> v_first
       OR v_existing.last_source_race_id <> v_last THEN
      RAISE EXCEPTION 'population R2 compaction replay conflicts';
    END IF;
    RETURN NEXT v_generation;
    RETURN;
  END IF;

  IF v_chunk_ordinal <> v_generation.r2_chunk_count + 1 THEN
    RAISE EXCEPTION 'population R2 compaction chunk ordinal is not contiguous';
  END IF;
  SELECT chunk.last_source_race_id INTO v_previous_last
  FROM dna.dna_population_race_index_r2_chunk chunk
  WHERE chunk.generation_key = v_generation_key
  ORDER BY chunk.chunk_ordinal DESC
  LIMIT 1;
  IF v_previous_last IS NOT NULL
     AND (v_first COLLATE "C") <= (v_previous_last COLLATE "C") THEN
    RAISE EXCEPTION 'population R2 compaction race ranges overlap';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_identities) item(value)
    WHERE jsonb_typeof(item.value) <> 'object'
       OR (SELECT count(*) FROM jsonb_object_keys(item.value)) <> 2
       OR NOT (item.value ?& ARRAY['sourceRaceId', 'rawEvidenceSha256'])
       OR item.value ->> 'rawEvidenceSha256' !~ '^[a-f0-9]{64}$'
       OR length(item.value ->> 'sourceRaceId') NOT BETWEEN 1 AND 512
       OR item.value ->> 'sourceRaceId' ~ '[[:cntrl:]]'
  ) THEN
    RAISE EXCEPTION 'population R2 compaction identity is invalid';
  END IF;

  IF (
    SELECT count(DISTINCT item.value ->> 'sourceRaceId')
    FROM jsonb_array_elements(p_identities) item(value)
  ) <> v_row_count THEN
    RAISE EXCEPTION 'population R2 compaction chunk contains duplicate race identities';
  END IF;

  SELECT ordered.race_id INTO v_min
  FROM (
    SELECT item.value ->> 'sourceRaceId' AS race_id
    FROM jsonb_array_elements(p_identities) item(value)
    ORDER BY (item.value ->> 'sourceRaceId') COLLATE "C"
    LIMIT 1
  ) ordered;
  SELECT ordered.race_id INTO v_max
  FROM (
    SELECT item.value ->> 'sourceRaceId' AS race_id
    FROM jsonb_array_elements(p_identities) item(value)
    ORDER BY (item.value ->> 'sourceRaceId') COLLATE "C" DESC
    LIMIT 1
  ) ordered;
  IF v_min <> v_first OR v_max <> v_last THEN
    RAISE EXCEPTION 'population R2 compaction identity range disagrees with receipt';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_identities) item(value)
    LEFT JOIN dna.dna_population_race_index_race race
      ON race.owner_id = p_owner_id
     AND race.generation_id = p_generation_id::character(64)
     AND race.source_race_id = item.value ->> 'sourceRaceId'
     AND decode(race.raw_evidence_sha256::text, 'hex') =
         decode(item.value ->> 'rawEvidenceSha256', 'hex')
    WHERE race.source_race_id IS NULL
  ) THEN
    RAISE EXCEPTION 'population R2 compaction identity disagrees with legacy authority';
  END IF;

  INSERT INTO dna.dna_population_race_index_r2_chunk (
    generation_key, chunk_ordinal, object_key, body_sha256, byte_length,
    row_count, first_source_race_id, last_source_race_id, registered_at
  ) VALUES (
    v_generation_key, v_chunk_ordinal, v_object_key,
    v_body_sha::character(64), v_byte_length, v_row_count,
    v_first, v_last, p_registered_at
  );

  UPDATE dna.dna_population_race_index_generation generation SET
    r2_chunk_count = generation.r2_chunk_count + 1,
    r2_compacted_race_count = generation.r2_compacted_race_count + v_row_count,
    r2_last_source_race_id = v_last,
    updated_at = p_registered_at
  WHERE generation.owner_id = p_owner_id
    AND generation.generation_id = p_generation_id::character(64)
  RETURNING * INTO v_generation;

  RETURN NEXT v_generation;
END
$function$;

CREATE FUNCTION dna.finalize_dna_population_race_index_r2_compaction(
  p_owner_id uuid,
  p_worker_id text,
  p_generation_id text,
  p_compacted_at timestamptz
)
RETURNS SETOF dna.dna_population_race_index_generation
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_generation dna.dna_population_race_index_generation%ROWTYPE;
  v_manifest_count bigint;
  v_manifest_rows bigint;
  v_legacy_count bigint;
  v_manifest_first text;
  v_manifest_last text;
  v_legacy_first text;
  v_legacy_last text;
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id()
     OR p_worker_id IS NULL OR p_worker_id <> btrim(p_worker_id)
     OR p_worker_id !~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$'
     OR p_generation_id IS NULL OR p_generation_id !~ '^[a-f0-9]{64}$'
     OR p_compacted_at IS NULL
     OR p_compacted_at > clock_timestamp() + interval '5 minutes' THEN
    RAISE EXCEPTION 'population R2 compaction finalization is invalid';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    p_owner_id::text || ':population-race-index:' || p_generation_id, 0
  ));
  SELECT stored.* INTO v_generation
  FROM dna.dna_population_race_index_generation stored
  WHERE stored.owner_id = p_owner_id
    AND stored.generation_id = p_generation_id::character(64)
  FOR UPDATE;

  IF NOT FOUND OR v_generation.worker_id <> p_worker_id THEN
    RAISE EXCEPTION 'population R2 compaction claim is unavailable';
  END IF;
  IF v_generation.storage_layout = 'r2_chunked_v1' THEN
    RETURN NEXT v_generation;
    RETURN;
  END IF;
  IF v_generation.storage_layout <> 'legacy_neon_v1'
     OR v_generation.legacy_storage_retired_at IS NOT NULL THEN
    RAISE EXCEPTION 'population R2 compaction source is unavailable';
  END IF;

  SELECT count(*), COALESCE(sum(chunk.row_count), 0),
         min(chunk.first_source_race_id COLLATE "C"),
         max(chunk.last_source_race_id COLLATE "C")
  INTO v_manifest_count, v_manifest_rows, v_manifest_first, v_manifest_last
  FROM dna.dna_population_race_index_r2_chunk chunk
  WHERE chunk.generation_key = v_generation.generation_key;

  SELECT count(*),
         min(race.source_race_id COLLATE "C"),
         max(race.source_race_id COLLATE "C")
  INTO v_legacy_count, v_legacy_first, v_legacy_last
  FROM dna.dna_population_race_index_race race
  WHERE race.owner_id = p_owner_id
    AND race.generation_id = p_generation_id::character(64);

  IF v_generation.unique_race_count = 0
     OR EXISTS (
       SELECT 1
       FROM dna.dna_population_race_index_compact_identity identity
       WHERE identity.generation_key = v_generation.generation_key
     )
     OR v_manifest_rows <> v_generation.unique_race_count
     OR v_legacy_count <> v_generation.unique_race_count
     OR v_manifest_count <> v_generation.r2_chunk_count
     OR v_generation.r2_compacted_race_count <> v_generation.unique_race_count
     OR v_manifest_first IS DISTINCT FROM v_legacy_first
     OR v_manifest_last IS DISTINCT FROM v_legacy_last THEN
    RAISE EXCEPTION 'population R2 compaction equivalence proof failed';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (
      SELECT
        chunk.chunk_ordinal,
        chunk.first_source_race_id,
        lag(chunk.last_source_race_id) OVER (
          ORDER BY chunk.chunk_ordinal
        ) AS previous_last
      FROM dna.dna_population_race_index_r2_chunk chunk
      WHERE chunk.generation_key = v_generation.generation_key
    ) ordered
    WHERE ordered.previous_last IS NOT NULL
      AND (ordered.first_source_race_id COLLATE "C") <=
          (ordered.previous_last COLLATE "C")
  ) THEN
    RAISE EXCEPTION 'population R2 compaction manifest ranges overlap';
  END IF;

  UPDATE dna.dna_population_race_index_generation generation SET
    storage_layout = 'r2_chunked_v1',
    compacted_at = p_compacted_at,
    updated_at = p_compacted_at
  WHERE generation.owner_id = p_owner_id
    AND generation.generation_id = p_generation_id::character(64)
  RETURNING * INTO v_generation;

  RETURN NEXT v_generation;
END
$function$;

CREATE FUNCTION dna.read_dna_population_race_index_r2_chunk_manifests(
  p_owner_id uuid,
  p_generation_id text,
  p_after_chunk_ordinal integer,
  p_limit integer
)
RETURNS TABLE (
  chunk_ordinal integer,
  object_key text,
  body_sha256 text,
  byte_length integer,
  row_count integer,
  first_source_race_id text,
  last_source_race_id text,
  registered_at timestamptz,
  identity_registered_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_generation_key bigint;
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id()
     OR p_generation_id IS NULL OR p_generation_id !~ '^[a-f0-9]{64}$'
     OR p_after_chunk_ordinal IS NULL OR p_after_chunk_ordinal < 0
     OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'owner-scoped population R2 manifest read denied';
  END IF;

  SELECT generation.generation_key INTO v_generation_key
  FROM dna.dna_population_race_index_generation generation
  WHERE generation.owner_id = p_owner_id
    AND generation.generation_id = p_generation_id::character(64)
    AND generation.storage_layout = 'r2_chunked_v1'
    AND generation.legacy_storage_retired_at IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM dna.dna_population_race_index_r2_chunk chunk
      WHERE chunk.generation_key = generation.generation_key
        AND chunk.identity_registered_at IS NULL
    )
    AND (
      SELECT count(*)
      FROM dna.dna_population_race_index_compact_identity identity
      WHERE identity.generation_key = generation.generation_key
    ) = generation.unique_race_count;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'population R2 manifest authority is unavailable';
  END IF;

  RETURN QUERY
  SELECT
    chunk.chunk_ordinal,
    chunk.object_key,
    chunk.body_sha256::text,
    chunk.byte_length,
    chunk.row_count,
    chunk.first_source_race_id,
    chunk.last_source_race_id,
    chunk.registered_at,
    chunk.identity_registered_at
  FROM dna.dna_population_race_index_r2_chunk chunk
  WHERE chunk.generation_key = v_generation_key
    AND chunk.chunk_ordinal > p_after_chunk_ordinal
  ORDER BY chunk.chunk_ordinal
  LIMIT p_limit;
END
$function$;

CREATE FUNCTION dna.register_dna_population_race_index_compact_identity_chunk(
  p_owner_id uuid,
  p_worker_id text,
  p_generation_id text,
  p_chunk_ordinal integer,
  p_identities jsonb,
  p_registered_at timestamptz
)
RETURNS SETOF dna.dna_population_race_index_generation
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_generation dna.dna_population_race_index_generation%ROWTYPE;
  v_chunk dna.dna_population_race_index_r2_chunk%ROWTYPE;
  v_identity jsonb;
  v_race_id text;
  v_raw_sha text;
  v_overlap_count bigint;
  v_min text;
  v_max text;
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id()
     OR p_worker_id IS NULL OR p_worker_id <> btrim(p_worker_id)
     OR p_worker_id !~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$'
     OR p_generation_id IS NULL OR p_generation_id !~ '^[a-f0-9]{64}$'
     OR p_chunk_ordinal IS NULL OR p_chunk_ordinal < 1
     OR p_identities IS NULL OR jsonb_typeof(p_identities) <> 'array'
     OR p_registered_at IS NULL
     OR p_registered_at > clock_timestamp() + interval '5 minutes' THEN
    RAISE EXCEPTION 'population compact identity registration is invalid';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    p_owner_id::text || ':population-race-index:' || p_generation_id, 0
  ));
  SELECT stored.* INTO v_generation
  FROM dna.dna_population_race_index_generation stored
  WHERE stored.owner_id = p_owner_id
    AND stored.generation_id = p_generation_id::character(64)
  FOR UPDATE;
  IF NOT FOUND OR v_generation.worker_id <> p_worker_id
     OR v_generation.storage_layout <> 'r2_chunked_v1'
     OR v_generation.legacy_storage_retired_at IS NULL THEN
    RAISE EXCEPTION 'population compact identity claim is unavailable';
  END IF;

  SELECT chunk.* INTO v_chunk
  FROM dna.dna_population_race_index_r2_chunk chunk
  WHERE chunk.generation_key = v_generation.generation_key
    AND chunk.chunk_ordinal = p_chunk_ordinal
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'population compact identity chunk is unavailable';
  END IF;

  IF jsonb_array_length(p_identities) <> v_chunk.row_count
     OR EXISTS (
       SELECT 1
       FROM jsonb_array_elements(p_identities) item(value)
       WHERE jsonb_typeof(item.value) <> 'object'
          OR (SELECT count(*) FROM jsonb_object_keys(item.value)) <> 2
          OR NOT (item.value ?& ARRAY['sourceRaceId', 'rawEvidenceSha256'])
          OR item.value ->> 'rawEvidenceSha256' !~ '^[a-f0-9]{64}$'
          OR length(item.value ->> 'sourceRaceId') NOT BETWEEN 1 AND 512
          OR item.value ->> 'sourceRaceId' ~ '[[:cntrl:]]'
     )
     OR (
       SELECT count(DISTINCT item.value ->> 'sourceRaceId')
       FROM jsonb_array_elements(p_identities) item(value)
     ) <> v_chunk.row_count THEN
    RAISE EXCEPTION 'population compact identity evidence is invalid';
  END IF;

  SELECT
    min((item.value ->> 'sourceRaceId') COLLATE "C"),
    max((item.value ->> 'sourceRaceId') COLLATE "C")
  INTO v_min, v_max
  FROM jsonb_array_elements(p_identities) item(value);
  IF v_min <> v_chunk.first_source_race_id
     OR v_max <> v_chunk.last_source_race_id THEN
    RAISE EXCEPTION 'population compact identity range disagrees with R2 manifest';
  END IF;

  SELECT count(*) INTO v_overlap_count
  FROM dna.dna_population_race_index_compact_identity identity
  WHERE identity.generation_key = v_generation.generation_key
    AND identity.source_race_id IN (
      SELECT item.value ->> 'sourceRaceId'
      FROM jsonb_array_elements(p_identities) item(value)
    );

  IF v_chunk.identity_registered_at IS NOT NULL THEN
    IF v_overlap_count <> v_chunk.row_count
       OR EXISTS (
         SELECT 1
         FROM jsonb_array_elements(p_identities) item(value)
         LEFT JOIN dna.dna_population_race_index_compact_identity identity
           ON identity.generation_key = v_generation.generation_key
          AND identity.source_race_id = item.value ->> 'sourceRaceId'
          AND identity.raw_evidence_sha256 =
              decode(item.value ->> 'rawEvidenceSha256', 'hex')
         WHERE identity.source_race_id IS NULL
       ) THEN
      RAISE EXCEPTION 'population compact identity replay conflicts';
    END IF;
    RETURN NEXT v_generation;
    RETURN;
  END IF;

  IF v_overlap_count <> 0 THEN
    RAISE EXCEPTION 'population compact identity overlaps a prior R2 chunk';
  END IF;

  FOR v_identity IN SELECT value FROM jsonb_array_elements(p_identities)
  LOOP
    v_race_id := v_identity ->> 'sourceRaceId';
    v_raw_sha := v_identity ->> 'rawEvidenceSha256';
    INSERT INTO dna.dna_population_race_index_compact_identity (
      generation_key, source_race_id, raw_evidence_sha256
    ) VALUES (
      v_generation.generation_key, v_race_id, decode(v_raw_sha, 'hex')
    );
  END LOOP;

  UPDATE dna.dna_population_race_index_r2_chunk chunk
  SET identity_registered_at = p_registered_at
  WHERE chunk.generation_key = v_generation.generation_key
    AND chunk.chunk_ordinal = p_chunk_ordinal;

  UPDATE dna.dna_population_race_index_generation generation
  SET updated_at = GREATEST(generation.updated_at, p_registered_at)
  WHERE generation.owner_id = p_owner_id
    AND generation.generation_id = p_generation_id::character(64)
  RETURNING * INTO v_generation;

  RETURN NEXT v_generation;
END
$function$;

CREATE FUNCTION dna.lookup_dna_population_race_index_compact_identities(
  p_owner_id uuid,
  p_generation_id text,
  p_source_race_ids jsonb
)
RETURNS TABLE (source_race_id text, raw_evidence_sha256 text)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_generation_key bigint;
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id()
     OR p_generation_id IS NULL OR p_generation_id !~ '^[a-f0-9]{64}$'
     OR p_source_race_ids IS NULL
     OR jsonb_typeof(p_source_race_ids) <> 'array'
     OR jsonb_array_length(p_source_race_ids) > 5000
     OR EXISTS (
       SELECT 1 FROM jsonb_array_elements(p_source_race_ids) item(value)
       WHERE jsonb_typeof(item.value) <> 'string'
          OR length(item.value #>> '{}') NOT BETWEEN 1 AND 512
          OR item.value #>> '{}' ~ '[[:cntrl:]]'
     ) THEN
    RAISE EXCEPTION 'owner-scoped compact identity lookup denied';
  END IF;

  SELECT generation.generation_key INTO v_generation_key
  FROM dna.dna_population_race_index_generation generation
  WHERE generation.owner_id = p_owner_id
    AND generation.generation_id = p_generation_id::character(64)
    AND generation.storage_layout = 'r2_chunked_v1'
    AND generation.legacy_storage_retired_at IS NOT NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'compact population race identity authority is unavailable';
  END IF;

  RETURN QUERY
  SELECT identity.source_race_id, encode(identity.raw_evidence_sha256, 'hex')
  FROM dna.dna_population_race_index_compact_identity identity
  JOIN (
    SELECT DISTINCT jsonb_array_elements_text(p_source_race_ids) AS source_race_id
  ) requested USING (source_race_id)
  WHERE identity.generation_key = v_generation_key;
END
$function$;

CREATE FUNCTION dna.append_dna_population_race_index_r2_batch(
  p_owner_id uuid,
  p_worker_id text,
  p_batch jsonb,
  p_new_identities jsonb,
  p_chunk jsonb,
  p_written_at timestamptz
)
RETURNS SETOF dna.dna_population_race_index_generation
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_generation dna.dna_population_race_index_generation%ROWTYPE;
  v_existing_batch dna.dna_population_race_index_batch_receipt%ROWTYPE;
  v_generation_id character(64);
  v_after integer;
  v_next integer;
  v_receipts integer;
  v_bytes bigint;
  v_omissions integer;
  v_finished integer;
  v_documents integer;
  v_complete boolean;
  v_new_count integer;
  v_identity jsonb;
  v_race_id text;
  v_raw_sha text;
  v_chunk_ordinal integer;
  v_chunk_rows integer;
  v_chunk_bytes integer;
  v_chunk_key text;
  v_chunk_sha text;
  v_chunk_first text;
  v_chunk_last text;
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id()
     OR p_worker_id IS NULL OR p_worker_id <> btrim(p_worker_id)
     OR p_worker_id !~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$'
     OR p_batch IS NULL OR jsonb_typeof(p_batch) <> 'object'
     OR p_new_identities IS NULL OR jsonb_typeof(p_new_identities) <> 'array'
     OR p_written_at IS NULL
     OR p_written_at > clock_timestamp() + interval '5 minutes' THEN
    RAISE EXCEPTION 'population R2 batch append request is invalid';
  END IF;
  IF (SELECT count(*) FROM jsonb_object_keys(p_batch)) <> 12
     OR NOT (p_batch ?& ARRAY[
       'version', 'generationId', 'batchSha256', 'afterRequestOrdinal',
       'nextRequestOrdinal', 'processedReceiptCount', 'processedReceiptBytes',
       'processedIdentityOmissionCount', 'finishedRaceReceiptCount',
       'canonicalDocumentObservationCount', 'documents', 'complete'
     ])
     OR p_batch ->> 'version' <> '1'
     OR p_batch ->> 'generationId' !~ '^[a-f0-9]{64}$'
     OR p_batch ->> 'batchSha256' !~ '^[a-f0-9]{64}$'
     OR jsonb_typeof(p_batch -> 'documents') <> 'array'
     OR jsonb_typeof(p_batch -> 'complete') <> 'boolean' THEN
    RAISE EXCEPTION 'population R2 batch envelope is invalid';
  END IF;

  BEGIN
    v_after := (p_batch ->> 'afterRequestOrdinal')::integer;
    v_next := (p_batch ->> 'nextRequestOrdinal')::integer;
    v_receipts := (p_batch ->> 'processedReceiptCount')::integer;
    v_bytes := (p_batch ->> 'processedReceiptBytes')::bigint;
    v_omissions := (p_batch ->> 'processedIdentityOmissionCount')::integer;
    v_finished := (p_batch ->> 'finishedRaceReceiptCount')::integer;
    v_documents := (p_batch ->> 'canonicalDocumentObservationCount')::integer;
    v_complete := (p_batch ->> 'complete')::boolean;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'population R2 batch counters are invalid';
  END;
  v_new_count := jsonb_array_length(p_new_identities);

  IF v_after < 0 OR v_receipts NOT BETWEEN 1 AND 100
     OR v_next <> v_after + v_receipts + 1 OR v_bytes < 1
     OR v_omissions < 0 OR v_finished NOT BETWEEN 0 AND v_receipts
     OR v_documents NOT BETWEEN 0 AND 5000
     OR jsonb_array_length(p_batch -> 'documents') <> v_documents
     OR v_new_count > v_documents THEN
    RAISE EXCEPTION 'population R2 batch bounds are invalid';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_new_identities) item(value)
    WHERE jsonb_typeof(item.value) <> 'object'
       OR (SELECT count(*) FROM jsonb_object_keys(item.value)) <> 2
       OR NOT (item.value ?& ARRAY['sourceRaceId', 'rawEvidenceSha256'])
       OR item.value ->> 'rawEvidenceSha256' !~ '^[a-f0-9]{64}$'
       OR length(item.value ->> 'sourceRaceId') NOT BETWEEN 1 AND 512
       OR item.value ->> 'sourceRaceId' ~ '[[:cntrl:]]'
  ) OR (
    SELECT count(DISTINCT item.value ->> 'sourceRaceId')
    FROM jsonb_array_elements(p_new_identities) item(value)
  ) <> v_new_count THEN
    RAISE EXCEPTION 'population R2 batch identities are invalid';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_batch -> 'documents') document(value)
    WHERE jsonb_typeof(document.value) <> 'object'
       OR NOT (document.value ?& ARRAY[
         'requestOrdinal', 'endpoint', 'observedAt', 'sourceRaceId',
         'rawEvidenceSha256', 'canonical'
       ])
       OR document.value ->> 'rawEvidenceSha256' !~ '^[a-f0-9]{64}$'
       OR length(document.value ->> 'sourceRaceId') NOT BETWEEN 1 AND 512
       OR document.value ->> 'sourceRaceId' ~ '[[:cntrl:]]'
       OR jsonb_typeof(document.value -> 'canonical') <> 'object'
       OR document.value -> 'canonical' ->> 'sourceType' <> 'race_document'
       OR document.value -> 'canonical' ->> 'sourceRaceId'
          IS DISTINCT FROM document.value ->> 'sourceRaceId'
  ) THEN
    RAISE EXCEPTION 'population R2 batch document authority is invalid';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_new_identities) identity(value)
    LEFT JOIN LATERAL (
      SELECT document.value
      FROM jsonb_array_elements(p_batch -> 'documents') document(value)
      WHERE document.value ->> 'sourceRaceId' =
            identity.value ->> 'sourceRaceId'
        AND document.value ->> 'rawEvidenceSha256' =
            identity.value ->> 'rawEvidenceSha256'
      LIMIT 1
    ) matched ON true
    WHERE matched.value IS NULL
  ) THEN
    RAISE EXCEPTION 'population R2 batch identity lacks document authority';
  END IF;

  IF v_new_count = 0 THEN
    IF p_chunk IS NOT NULL THEN
      RAISE EXCEPTION 'population R2 batch has an unexpected chunk';
    END IF;
  ELSE
    IF p_chunk IS NULL OR jsonb_typeof(p_chunk) <> 'object'
       OR (SELECT count(*) FROM jsonb_object_keys(p_chunk)) <> 9
       OR NOT (p_chunk ?& ARRAY[
         'version', 'generationId', 'chunkOrdinal', 'objectKey', 'bodySha256',
         'byteLength', 'rowCount', 'firstSourceRaceId', 'lastSourceRaceId'
       ])
       OR p_chunk ->> 'version' <> '1'
       OR p_chunk ->> 'generationId' <> p_batch ->> 'generationId'
       OR p_chunk ->> 'bodySha256' !~ '^[a-f0-9]{64}$' THEN
      RAISE EXCEPTION 'population R2 batch chunk receipt is invalid';
    END IF;
    BEGIN
      v_chunk_ordinal := (p_chunk ->> 'chunkOrdinal')::integer;
      v_chunk_rows := (p_chunk ->> 'rowCount')::integer;
      v_chunk_bytes := (p_chunk ->> 'byteLength')::integer;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'population R2 batch chunk counters are invalid';
    END;
    v_chunk_key := p_chunk ->> 'objectKey';
    v_chunk_sha := p_chunk ->> 'bodySha256';
    v_chunk_first := p_chunk ->> 'firstSourceRaceId';
    v_chunk_last := p_chunk ->> 'lastSourceRaceId';
    IF v_chunk_rows <> v_new_count
       OR v_chunk_bytes NOT BETWEEN 1 AND 8388608
       OR length(v_chunk_key) NOT BETWEEN 1 AND 2048
       OR v_chunk_key ~ '[[:cntrl:]]'
       OR length(v_chunk_first) NOT BETWEEN 1 AND 512
       OR length(v_chunk_last) NOT BETWEEN 1 AND 512 THEN
      RAISE EXCEPTION 'population R2 batch chunk bounds are invalid';
    END IF;
  END IF;

  v_generation_id := (p_batch ->> 'generationId')::character(64);
  PERFORM pg_advisory_xact_lock(hashtextextended(
    p_owner_id::text || ':population-race-index:' || v_generation_id::text, 0
  ));
  SELECT stored.* INTO v_generation
  FROM dna.dna_population_race_index_generation stored
  WHERE stored.owner_id = p_owner_id
    AND stored.generation_id = v_generation_id
  FOR UPDATE;

  IF NOT FOUND OR v_generation.worker_id <> p_worker_id
     OR v_generation.storage_layout <> 'r2_chunked_v1'
     OR v_generation.legacy_storage_retired_at IS NULL
     OR EXISTS (
       SELECT 1
       FROM dna.dna_population_race_index_r2_chunk chunk
       WHERE chunk.generation_key = v_generation.generation_key
         AND chunk.identity_registered_at IS NULL
     )
     OR (
       SELECT count(*)
       FROM dna.dna_population_race_index_compact_identity identity
       WHERE identity.generation_key = v_generation.generation_key
     ) <> v_generation.unique_race_count THEN
    RAISE EXCEPTION 'population R2 staging claim is unavailable';
  END IF;

  SELECT stored.* INTO v_existing_batch
  FROM dna.dna_population_race_index_batch_receipt stored
  WHERE stored.owner_id = p_owner_id
    AND stored.generation_id = v_generation_id
    AND stored.after_request_ordinal = v_after
  FOR UPDATE;
  IF FOUND THEN
    IF v_existing_batch.batch_sha256::text <> p_batch ->> 'batchSha256'
       OR v_existing_batch.next_request_ordinal <> v_next
       OR v_existing_batch.processed_receipt_count <> v_receipts
       OR v_existing_batch.processed_receipt_bytes <> v_bytes
       OR v_existing_batch.processed_identity_omission_count <> v_omissions
       OR v_existing_batch.finished_race_receipt_count <> v_finished
       OR v_existing_batch.canonical_document_observation_count <> v_documents
       OR v_existing_batch.completes_generation <> v_complete THEN
      RAISE EXCEPTION 'population R2 batch replay conflicts';
    END IF;
    RETURN NEXT v_generation;
    RETURN;
  END IF;

  IF v_generation.state <> 'staging'
     OR v_generation.last_request_ordinal <> v_after
     OR v_generation.processed_receipt_count + v_receipts >
        v_generation.baseline_logical_request_count
     OR v_generation.processed_receipt_bytes + v_bytes >
        v_generation.baseline_retained_r2_bytes
     OR v_generation.processed_identity_omission_count + v_omissions >
        v_generation.baseline_omitted_identity_observation_count
     OR v_complete <> (v_next = v_generation.baseline_logical_request_count + 1) THEN
    RAISE EXCEPTION 'population R2 checkpoint transition is invalid';
  END IF;

  FOR v_identity IN SELECT value FROM jsonb_array_elements(p_new_identities)
  LOOP
    v_race_id := v_identity ->> 'sourceRaceId';
    v_raw_sha := v_identity ->> 'rawEvidenceSha256';
    IF EXISTS (
      SELECT 1
      FROM dna.dna_population_race_index_compact_identity identity
      WHERE identity.generation_key = v_generation.generation_key
        AND identity.source_race_id = v_race_id
    ) THEN
      RAISE EXCEPTION 'population R2 batch attempted to duplicate a race identity';
    END IF;
    INSERT INTO dna.dna_population_race_index_compact_identity (
      generation_key, source_race_id, raw_evidence_sha256
    ) VALUES (
      v_generation.generation_key, v_race_id, decode(v_raw_sha, 'hex')
    );
  END LOOP;

  IF v_new_count > 0 THEN
    IF v_chunk_ordinal <> v_generation.r2_chunk_count + 1 THEN
      RAISE EXCEPTION 'population R2 batch chunk ordinal is not contiguous';
    END IF;
    INSERT INTO dna.dna_population_race_index_r2_chunk (
      generation_key, chunk_ordinal, object_key, body_sha256, byte_length,
      row_count, first_source_race_id, last_source_race_id, registered_at
    ) VALUES (
      v_generation.generation_key, v_chunk_ordinal, v_chunk_key,
      v_chunk_sha::character(64), v_chunk_bytes, v_chunk_rows,
      v_chunk_first, v_chunk_last, p_written_at
    );
  END IF;

  INSERT INTO dna.dna_population_race_index_batch_receipt (
    owner_id, generation_id, after_request_ordinal, next_request_ordinal,
    batch_sha256, processed_receipt_count, processed_receipt_bytes,
    processed_identity_omission_count, finished_race_receipt_count,
    canonical_document_observation_count, completes_generation, written_at
  ) VALUES (
    p_owner_id, v_generation_id, v_after, v_next,
    (p_batch ->> 'batchSha256')::character(64), v_receipts, v_bytes,
    v_omissions, v_finished, v_documents, v_complete, p_written_at
  );

  UPDATE dna.dna_population_race_index_generation generation SET
    last_request_ordinal = v_next - 1,
    processed_receipt_count = generation.processed_receipt_count + v_receipts,
    processed_receipt_bytes = generation.processed_receipt_bytes + v_bytes,
    processed_identity_omission_count =
      generation.processed_identity_omission_count + v_omissions,
    finished_race_receipt_count =
      generation.finished_race_receipt_count + v_finished,
    canonical_document_observation_count =
      generation.canonical_document_observation_count + v_documents,
    unique_race_count = generation.unique_race_count + v_new_count,
    r2_chunk_count = generation.r2_chunk_count +
      CASE WHEN v_new_count > 0 THEN 1 ELSE 0 END,
    r2_compacted_race_count = generation.r2_compacted_race_count + v_new_count,
    state = CASE WHEN v_complete THEN 'complete' ELSE 'staging' END,
    updated_at = p_written_at,
    completed_at = CASE WHEN v_complete THEN p_written_at ELSE NULL END
  WHERE generation.owner_id = p_owner_id
    AND generation.generation_id = v_generation_id
  RETURNING * INTO v_generation;

  IF v_complete AND (
    v_generation.processed_receipt_count <>
      v_generation.baseline_logical_request_count
    OR v_generation.processed_receipt_bytes <>
       v_generation.baseline_retained_r2_bytes
    OR v_generation.processed_identity_omission_count <>
       v_generation.baseline_omitted_identity_observation_count
    OR v_generation.r2_compacted_race_count <> v_generation.unique_race_count
  ) THEN
    RAISE EXCEPTION 'population R2 completion totals disagree';
  END IF;

  RETURN NEXT v_generation;
END
$function$;

CREATE FUNCTION dna.retire_dna_population_race_index_legacy_storage(
  p_owner_id uuid,
  p_generation_id text,
  p_retired_at timestamptz
)
RETURNS TABLE (
  generation_count bigint,
  compact_identity_count bigint,
  r2_manifest_row_count bigint,
  legacy_race_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_generation dna.dna_population_race_index_generation%ROWTYPE;
  v_generation_count bigint;
  v_identity_count bigint;
  v_manifest_rows bigint;
  v_legacy_count bigint;
  v_total_legacy_count bigint;
BEGIN
  IF p_owner_id IS NULL
     OR p_generation_id IS NULL OR p_generation_id !~ '^[a-f0-9]{64}$'
     OR p_retired_at IS NULL
     OR p_retired_at > clock_timestamp() + interval '5 minutes' THEN
    RAISE EXCEPTION 'population legacy retirement request is invalid';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    p_owner_id::text || ':population-race-index:' || p_generation_id, 0
  ));
  SELECT stored.* INTO v_generation
  FROM dna.dna_population_race_index_generation stored
  WHERE stored.owner_id = p_owner_id
    AND stored.generation_id = p_generation_id::character(64)
  FOR UPDATE;

  IF NOT FOUND
     OR v_generation.storage_layout <> 'r2_chunked_v1'
     OR v_generation.compacted_at IS NULL
     OR v_generation.legacy_storage_retired_at IS NOT NULL
     OR v_generation.r2_compacted_race_count <> v_generation.unique_race_count
     OR EXISTS (
       SELECT 1
       FROM dna.dna_population_race_index_compact_identity identity
       WHERE identity.generation_key = v_generation.generation_key
     )
     OR (
       SELECT COALESCE(sum(chunk.row_count), 0)
       FROM dna.dna_population_race_index_r2_chunk chunk
       WHERE chunk.generation_key = v_generation.generation_key
     ) <> v_generation.unique_race_count THEN
    RAISE EXCEPTION 'population legacy retirement equivalence proof failed';
  END IF;

  SELECT count(*) INTO v_generation_count
  FROM dna.dna_population_race_index_generation generation
  WHERE generation.owner_id = p_owner_id
    AND generation.generation_id = p_generation_id::character(64);

  SELECT count(*) INTO v_identity_count
  FROM dna.dna_population_race_index_compact_identity identity
  WHERE identity.generation_key = v_generation.generation_key;

  SELECT COALESCE(sum(row_count), 0) INTO v_manifest_rows
  FROM dna.dna_population_race_index_r2_chunk chunk
  WHERE chunk.generation_key = v_generation.generation_key;

  SELECT count(*) INTO v_legacy_count
  FROM dna.dna_population_race_index_race race
  WHERE race.owner_id = p_owner_id
    AND race.generation_id = p_generation_id::character(64);

  SELECT count(*) INTO v_total_legacy_count
  FROM dna.dna_population_race_index_race;

  IF v_generation_count <> 1
     OR v_identity_count <> 0
     OR v_manifest_rows <> v_legacy_count
     OR v_legacy_count <> v_generation.unique_race_count
     OR v_total_legacy_count <> v_legacy_count
     OR EXISTS (SELECT 1 FROM dna.dna_population_race_index_entrant) THEN
    RAISE EXCEPTION 'population legacy retirement global proof failed';
  END IF;

  TRUNCATE TABLE
    dna.dna_population_race_index_entrant,
    dna.dna_population_race_index_race;

  CREATE UNIQUE INDEX IF NOT EXISTS dna_population_race_index_compact_identity_uidx
    ON dna.dna_population_race_index_compact_identity(
      generation_key, source_race_id
    );

  UPDATE dna.dna_population_race_index_generation generation
  SET legacy_storage_retired_at = p_retired_at,
      updated_at = GREATEST(generation.updated_at, p_retired_at)
  WHERE generation.owner_id = p_owner_id
    AND generation.generation_id = p_generation_id::character(64);

  RETURN QUERY SELECT
    v_generation_count,
    v_identity_count,
    v_manifest_rows,
    v_legacy_count;
END
$function$;

REVOKE ALL ON TABLE
  dna.dna_population_race_index_compact_identity,
  dna.dna_population_race_index_r2_chunk
FROM PUBLIC, dna_app_runtime;
REVOKE ALL ON FUNCTION
  dna.dna_population_race_index_generation_owned(bigint),
  dna.read_dna_population_race_index_legacy_chunk(uuid,text,text,integer),
  dna.register_dna_population_race_index_r2_compaction_chunk(uuid,text,text,jsonb,jsonb,timestamp with time zone),
  dna.finalize_dna_population_race_index_r2_compaction(uuid,text,text,timestamp with time zone),
  dna.read_dna_population_race_index_r2_chunk_manifests(uuid,text,integer,integer),
  dna.register_dna_population_race_index_compact_identity_chunk(uuid,text,text,integer,jsonb,timestamp with time zone),
  dna.lookup_dna_population_race_index_compact_identities(uuid,text,jsonb),
  dna.append_dna_population_race_index_r2_batch(uuid,text,jsonb,jsonb,jsonb,timestamp with time zone),
  dna.retire_dna_population_race_index_legacy_storage(uuid,text,timestamp with time zone)
FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION
  dna.append_dna_population_race_index_batch(uuid,text,jsonb,timestamp with time zone)
FROM dna_app_runtime;

GRANT EXECUTE ON FUNCTION
  dna.dna_population_race_index_generation_owned(bigint),
  dna.read_dna_population_race_index_legacy_chunk(uuid,text,text,integer),
  dna.register_dna_population_race_index_r2_compaction_chunk(uuid,text,text,jsonb,jsonb,timestamp with time zone),
  dna.finalize_dna_population_race_index_r2_compaction(uuid,text,text,timestamp with time zone),
  dna.read_dna_population_race_index_r2_chunk_manifests(uuid,text,integer,integer),
  dna.register_dna_population_race_index_compact_identity_chunk(uuid,text,text,integer,jsonb,timestamp with time zone),
  dna.lookup_dna_population_race_index_compact_identities(uuid,text,jsonb),
  dna.append_dna_population_race_index_r2_batch(uuid,text,jsonb,jsonb,jsonb,timestamp with time zone)
TO dna_app_runtime;

COMMIT;
