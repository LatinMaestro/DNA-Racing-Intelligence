BEGIN;

CREATE TABLE dna.dna_population_entrant_authority_successor_generation (
  owner_id uuid NOT NULL
    REFERENCES dna.app_owner(id)
    ON DELETE RESTRICT,
  generation_id character(64) NOT NULL
    CHECK (generation_id::text ~ '^[a-f0-9]{64}$'),
  version smallint NOT NULL CHECK (version = 1),
  base_generation_id character(64) NOT NULL
    CHECK (base_generation_id::text ~ '^[a-f0-9]{64}$'),
  base_record_set_sha256 character(64) NOT NULL
    CHECK (base_record_set_sha256::text ~ '^[a-f0-9]{64}$'),
  successor_record_set_sha256 character(64) NOT NULL
    CHECK (successor_record_set_sha256::text ~ '^[a-f0-9]{64}$'),
  unresolved_race_count bigint NOT NULL CHECK (unresolved_race_count > 0),
  unresolved_race_set_sha256 character(64) NOT NULL
    CHECK (unresolved_race_set_sha256::text ~ '^[a-f0-9]{64}$'),
  replacement_race_count bigint NOT NULL CHECK (replacement_race_count > 0),
  replacement_race_set_sha256 character(64) NOT NULL
    CHECK (replacement_race_set_sha256::text ~ '^[a-f0-9]{64}$'),
  replacement_record_set_sha256 character(64) NOT NULL
    CHECK (replacement_record_set_sha256::text ~ '^[a-f0-9]{64}$'),
  quarantined_race_count_before bigint NOT NULL
    CHECK (quarantined_race_count_before > 0),
  quarantined_race_count_after bigint NOT NULL
    CHECK (quarantined_race_count_after >= 0),
  chunk_count integer NOT NULL DEFAULT 0 CHECK (chunk_count >= 0),
  persisted_race_count bigint NOT NULL DEFAULT 0 CHECK (persisted_race_count >= 0),
  last_source_race_id text CHECK (
    last_source_race_id IS NULL
    OR (
      length(last_source_race_id) BETWEEN 1 AND 512
      AND last_source_race_id !~ '[[:cntrl:]]'
    )
  ),
  started_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (owner_id, generation_id),
  FOREIGN KEY (owner_id, base_generation_id)
    REFERENCES dna.dna_population_entrant_authority_generation(owner_id, generation_id)
    ON DELETE RESTRICT,
  CHECK (base_generation_id = unresolved_race_set_sha256),
  CHECK (generation_id <> base_generation_id),
  CHECK (replacement_race_count <= unresolved_race_count),
  CHECK (quarantined_race_count_before <= unresolved_race_count),
  CHECK (quarantined_race_count_after < quarantined_race_count_before),
  CHECK (
    quarantined_race_count_before - quarantined_race_count_after =
    replacement_race_count
  ),
  CHECK (persisted_race_count <= unresolved_race_count),
  CHECK (
    (
      chunk_count = 0
      AND persisted_race_count = 0
      AND last_source_race_id IS NULL
    )
    OR (
      chunk_count > 0
      AND persisted_race_count > 0
      AND last_source_race_id IS NOT NULL
    )
  )
);

CREATE TABLE dna.dna_population_entrant_authority_successor_chunk (
  owner_id uuid NOT NULL,
  generation_id character(64) NOT NULL,
  chunk_ordinal integer NOT NULL CHECK (chunk_ordinal > 0),
  object_key text NOT NULL CHECK (
    length(object_key) BETWEEN 1 AND 2048
    AND object_key !~ '[[:cntrl:]]'
  ),
  body_sha256 character(64) NOT NULL CHECK (body_sha256::text ~ '^[a-f0-9]{64}$'),
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
  race_set_sha256 character(64) NOT NULL
    CHECK (race_set_sha256::text ~ '^[a-f0-9]{64}$'),
  record_set_sha256 character(64) NOT NULL
    CHECK (record_set_sha256::text ~ '^[a-f0-9]{64}$'),
  registered_at timestamptz NOT NULL,
  PRIMARY KEY (owner_id, generation_id, chunk_ordinal),
  UNIQUE (owner_id, object_key),
  FOREIGN KEY (owner_id, generation_id)
    REFERENCES dna.dna_population_entrant_authority_successor_generation(owner_id, generation_id)
    ON DELETE RESTRICT,
  CHECK ((first_source_race_id COLLATE "C") <= (last_source_race_id COLLATE "C"))
);

CREATE FUNCTION dna.reject_dna_population_entrant_authority_successor_chunk_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  RAISE EXCEPTION 'population entrant authority successor chunk manifests are immutable';
END
$function$;

CREATE TRIGGER dna_population_entrant_authority_successor_chunk_immutable
BEFORE UPDATE OR DELETE ON dna.dna_population_entrant_authority_successor_chunk
FOR EACH ROW
EXECUTE FUNCTION dna.reject_dna_population_entrant_authority_successor_chunk_mutation();

ALTER TABLE dna.dna_population_entrant_authority_successor_generation
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE dna.dna_population_entrant_authority_successor_generation
  FORCE ROW LEVEL SECURITY;
ALTER TABLE dna.dna_population_entrant_authority_successor_chunk
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE dna.dna_population_entrant_authority_successor_chunk
  FORCE ROW LEVEL SECURITY;

CREATE POLICY owner_isolation
  ON dna.dna_population_entrant_authority_successor_generation
  USING (owner_id = dna.current_owner_id())
  WITH CHECK (owner_id = dna.current_owner_id());

CREATE POLICY owner_isolation
  ON dna.dna_population_entrant_authority_successor_chunk
  USING (owner_id = dna.current_owner_id())
  WITH CHECK (owner_id = dna.current_owner_id());

CREATE FUNCTION dna.begin_dna_population_entrant_authority_successor_generation(
  p_owner_id uuid,
  p_authority jsonb,
  p_started_at timestamptz
)
RETURNS SETOF dna.dna_population_entrant_authority_successor_generation
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_generation dna.dna_population_entrant_authority_successor_generation%ROWTYPE;
  v_base dna.dna_population_entrant_authority_generation%ROWTYPE;
  v_generation_id text;
  v_base_generation_id text;
  v_base_record_set_sha text;
  v_successor_record_set_sha text;
  v_unresolved_count bigint;
  v_unresolved_sha text;
  v_replacement_count bigint;
  v_replacement_set_sha text;
  v_replacement_record_set_sha text;
  v_quarantined_before bigint;
  v_quarantined_after bigint;
BEGIN
  IF dna.current_owner_id() IS NULL
     OR p_owner_id <> dna.current_owner_id()
     OR p_authority IS NULL
     OR jsonb_typeof(p_authority) <> 'object'
     OR (SELECT count(*) FROM jsonb_object_keys(p_authority)) <> 12
     OR NOT (p_authority ?& ARRAY[
       'version', 'baseGenerationId', 'baseRecordSetSha256',
       'successorGenerationId', 'successorRecordSetSha256',
       'unresolvedRaceCount', 'unresolvedRaceSetSha256',
       'replacementRaceCount', 'replacementRaceSetSha256',
       'replacementRecordSetSha256', 'quarantinedRaceCountBefore',
       'quarantinedRaceCountAfter'
     ])
     OR p_authority ->> 'version' <>
       'dna-population-entrant-authority-successor-checkpoint/v1'
     OR p_started_at IS NULL
     OR p_started_at > clock_timestamp() + interval '5 minutes' THEN
    RAISE EXCEPTION 'population entrant authority successor generation is invalid';
  END IF;

  v_generation_id := p_authority ->> 'successorGenerationId';
  v_base_generation_id := p_authority ->> 'baseGenerationId';
  v_base_record_set_sha := p_authority ->> 'baseRecordSetSha256';
  v_successor_record_set_sha := p_authority ->> 'successorRecordSetSha256';
  v_unresolved_sha := p_authority ->> 'unresolvedRaceSetSha256';
  v_replacement_set_sha := p_authority ->> 'replacementRaceSetSha256';
  v_replacement_record_set_sha := p_authority ->> 'replacementRecordSetSha256';
  BEGIN
    v_unresolved_count := (p_authority ->> 'unresolvedRaceCount')::bigint;
    v_replacement_count := (p_authority ->> 'replacementRaceCount')::bigint;
    v_quarantined_before := (p_authority ->> 'quarantinedRaceCountBefore')::bigint;
    v_quarantined_after := (p_authority ->> 'quarantinedRaceCountAfter')::bigint;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'population entrant authority successor count is invalid';
  END;

  IF v_generation_id !~ '^[a-f0-9]{64}$'
     OR v_base_generation_id !~ '^[a-f0-9]{64}$'
     OR v_base_record_set_sha !~ '^[a-f0-9]{64}$'
     OR v_successor_record_set_sha !~ '^[a-f0-9]{64}$'
     OR v_unresolved_sha !~ '^[a-f0-9]{64}$'
     OR v_replacement_set_sha !~ '^[a-f0-9]{64}$'
     OR v_replacement_record_set_sha !~ '^[a-f0-9]{64}$'
     OR v_base_generation_id <> v_unresolved_sha
     OR v_generation_id = v_base_generation_id
     OR v_unresolved_count <= 0
     OR v_replacement_count <= 0
     OR v_replacement_count > v_unresolved_count
     OR v_quarantined_before <= 0
     OR v_quarantined_before > v_unresolved_count
     OR v_quarantined_after < 0
     OR v_quarantined_after >= v_quarantined_before
     OR v_quarantined_before - v_quarantined_after <> v_replacement_count THEN
    RAISE EXCEPTION 'population entrant authority successor binding is invalid';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    p_owner_id::text || ':population-entrant-authority-successor:' || v_generation_id,
    0
  ));

  BEGIN
    SELECT * INTO STRICT v_base
    FROM dna.read_dna_population_entrant_authority_generation(
      p_owner_id,
      v_base_generation_id
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'population entrant authority successor base is not durably complete';
  END;

  IF v_base.generation_id::text <> v_base.unresolved_race_set_sha256::text
     OR v_base.unresolved_race_count <> v_unresolved_count
     OR v_base.unresolved_race_set_sha256::text <> v_unresolved_sha
     OR v_base.chunk_count <= 0
     OR v_base.persisted_race_count <> v_base.unresolved_race_count
     OR v_base.last_source_race_id IS NULL
     OR p_started_at < v_base.updated_at THEN
    RAISE EXCEPTION 'population entrant authority successor base is not durably complete';
  END IF;

  SELECT stored.* INTO v_generation
  FROM dna.dna_population_entrant_authority_successor_generation stored
  WHERE stored.owner_id = p_owner_id
    AND stored.generation_id = v_generation_id::character(64)
  FOR UPDATE;

  IF FOUND THEN
    IF v_generation.version <> 1
       OR v_generation.base_generation_id::text <> v_base_generation_id
       OR v_generation.base_record_set_sha256::text <> v_base_record_set_sha
       OR v_generation.successor_record_set_sha256::text <> v_successor_record_set_sha
       OR v_generation.unresolved_race_count <> v_unresolved_count
       OR v_generation.unresolved_race_set_sha256::text <> v_unresolved_sha
       OR v_generation.replacement_race_count <> v_replacement_count
       OR v_generation.replacement_race_set_sha256::text <> v_replacement_set_sha
       OR v_generation.replacement_record_set_sha256::text <> v_replacement_record_set_sha
       OR v_generation.quarantined_race_count_before <> v_quarantined_before
       OR v_generation.quarantined_race_count_after <> v_quarantined_after THEN
      RAISE EXCEPTION 'population entrant authority successor generation replay conflicts';
    END IF;
    RETURN NEXT v_generation;
    RETURN;
  END IF;

  INSERT INTO dna.dna_population_entrant_authority_successor_generation (
    owner_id,
    generation_id,
    version,
    base_generation_id,
    base_record_set_sha256,
    successor_record_set_sha256,
    unresolved_race_count,
    unresolved_race_set_sha256,
    replacement_race_count,
    replacement_race_set_sha256,
    replacement_record_set_sha256,
    quarantined_race_count_before,
    quarantined_race_count_after,
    started_at,
    updated_at
  ) VALUES (
    p_owner_id,
    v_generation_id::character(64),
    1,
    v_base_generation_id::character(64),
    v_base_record_set_sha::character(64),
    v_successor_record_set_sha::character(64),
    v_unresolved_count,
    v_unresolved_sha::character(64),
    v_replacement_count,
    v_replacement_set_sha::character(64),
    v_replacement_record_set_sha::character(64),
    v_quarantined_before,
    v_quarantined_after,
    p_started_at,
    p_started_at
  )
  RETURNING * INTO v_generation;

  RETURN NEXT v_generation;
END
$function$;

CREATE FUNCTION dna.register_dna_population_entrant_authority_successor_chunk(
  p_owner_id uuid,
  p_generation_id text,
  p_receipt jsonb,
  p_registered_at timestamptz
)
RETURNS SETOF dna.dna_population_entrant_authority_successor_generation
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_generation dna.dna_population_entrant_authority_successor_generation%ROWTYPE;
  v_existing dna.dna_population_entrant_authority_successor_chunk%ROWTYPE;
  v_chunk_ordinal integer;
  v_object_key text;
  v_body_sha text;
  v_byte_length integer;
  v_row_count integer;
  v_first text;
  v_last text;
  v_race_set_sha text;
  v_record_set_sha text;
  v_manifest_chunk_count bigint;
  v_manifest_row_count bigint;
  v_min_ordinal integer;
  v_max_ordinal integer;
  v_manifest_last text;
BEGIN
  IF dna.current_owner_id() IS NULL
     OR p_owner_id <> dna.current_owner_id()
     OR p_generation_id IS NULL
     OR p_generation_id !~ '^[a-f0-9]{64}$'
     OR p_receipt IS NULL
     OR jsonb_typeof(p_receipt) <> 'object'
     OR (SELECT count(*) FROM jsonb_object_keys(p_receipt)) <> 11
     OR NOT (p_receipt ?& ARRAY[
       'version', 'generationId', 'chunkOrdinal', 'objectKey', 'bodySha256',
       'byteLength', 'rowCount', 'firstSourceRaceId', 'lastSourceRaceId',
       'raceSetSha256', 'recordSetSha256'
     ])
     OR p_receipt ->> 'version' <> '1'
     OR p_receipt ->> 'generationId' <> p_generation_id
     OR p_registered_at IS NULL
     OR p_registered_at > clock_timestamp() + interval '5 minutes' THEN
    RAISE EXCEPTION 'population entrant authority successor chunk registration is invalid';
  END IF;

  BEGIN
    v_chunk_ordinal := (p_receipt ->> 'chunkOrdinal')::integer;
    v_byte_length := (p_receipt ->> 'byteLength')::integer;
    v_row_count := (p_receipt ->> 'rowCount')::integer;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'population entrant authority successor chunk counters are invalid';
  END;

  v_object_key := p_receipt ->> 'objectKey';
  v_body_sha := p_receipt ->> 'bodySha256';
  v_first := p_receipt ->> 'firstSourceRaceId';
  v_last := p_receipt ->> 'lastSourceRaceId';
  v_race_set_sha := p_receipt ->> 'raceSetSha256';
  v_record_set_sha := p_receipt ->> 'recordSetSha256';

  IF v_chunk_ordinal < 1
     OR v_byte_length NOT BETWEEN 1 AND 8388608
     OR v_row_count NOT BETWEEN 1 AND 5000
     OR length(v_object_key) NOT BETWEEN 1 AND 2048
     OR v_object_key ~ '[[:cntrl:]]'
     OR v_body_sha !~ '^[a-f0-9]{64}$'
     OR length(v_first) NOT BETWEEN 1 AND 512
     OR v_first ~ '[[:cntrl:]]'
     OR length(v_last) NOT BETWEEN 1 AND 512
     OR v_last ~ '[[:cntrl:]]'
     OR (v_first COLLATE "C") > (v_last COLLATE "C")
     OR v_race_set_sha !~ '^[a-f0-9]{64}$'
     OR v_record_set_sha !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'population entrant authority successor chunk receipt is invalid';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    p_owner_id::text || ':population-entrant-authority-successor:' || p_generation_id,
    0
  ));

  SELECT stored.* INTO v_generation
  FROM dna.dna_population_entrant_authority_successor_generation stored
  WHERE stored.owner_id = p_owner_id
    AND stored.generation_id = p_generation_id::character(64)
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'population entrant authority successor generation is unavailable';
  END IF;

  SELECT
    count(*),
    COALESCE(sum(chunk.row_count), 0),
    min(chunk.chunk_ordinal),
    max(chunk.chunk_ordinal)
  INTO
    v_manifest_chunk_count,
    v_manifest_row_count,
    v_min_ordinal,
    v_max_ordinal
  FROM dna.dna_population_entrant_authority_successor_chunk chunk
  WHERE chunk.owner_id = p_owner_id
    AND chunk.generation_id = p_generation_id::character(64);

  SELECT chunk.last_source_race_id INTO v_manifest_last
  FROM dna.dna_population_entrant_authority_successor_chunk chunk
  WHERE chunk.owner_id = p_owner_id
    AND chunk.generation_id = p_generation_id::character(64)
  ORDER BY chunk.chunk_ordinal DESC
  LIMIT 1;

  IF v_manifest_chunk_count <> v_generation.chunk_count
     OR v_manifest_row_count <> v_generation.persisted_race_count
     OR (
       v_generation.chunk_count = 0
       AND (
         v_min_ordinal IS NOT NULL
         OR v_max_ordinal IS NOT NULL
         OR v_manifest_last IS NOT NULL
         OR v_generation.last_source_race_id IS NOT NULL
       )
     )
     OR (
       v_generation.chunk_count > 0
       AND (
         v_min_ordinal <> 1
         OR v_max_ordinal <> v_generation.chunk_count
         OR v_manifest_last IS DISTINCT FROM v_generation.last_source_race_id
       )
     )
     OR EXISTS (
       SELECT 1
       FROM (
         SELECT
           chunk.chunk_ordinal,
           chunk.first_source_race_id,
           lag(chunk.last_source_race_id) OVER (
             ORDER BY chunk.chunk_ordinal
           ) AS previous_last
         FROM dna.dna_population_entrant_authority_successor_chunk chunk
         WHERE chunk.owner_id = p_owner_id
           AND chunk.generation_id = p_generation_id::character(64)
       ) ordered
       WHERE ordered.previous_last IS NOT NULL
         AND (ordered.first_source_race_id COLLATE "C") <=
             (ordered.previous_last COLLATE "C")
     ) THEN
    RAISE EXCEPTION 'population entrant authority successor checkpoint is inconsistent';
  END IF;

  SELECT stored.* INTO v_existing
  FROM dna.dna_population_entrant_authority_successor_chunk stored
  WHERE stored.owner_id = p_owner_id
    AND stored.generation_id = p_generation_id::character(64)
    AND stored.chunk_ordinal = v_chunk_ordinal
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing.object_key <> v_object_key
       OR v_existing.body_sha256::text <> v_body_sha
       OR v_existing.byte_length <> v_byte_length
       OR v_existing.row_count <> v_row_count
       OR v_existing.first_source_race_id <> v_first
       OR v_existing.last_source_race_id <> v_last
       OR v_existing.race_set_sha256::text <> v_race_set_sha
       OR v_existing.record_set_sha256::text <> v_record_set_sha THEN
      RAISE EXCEPTION 'population entrant authority successor chunk replay conflicts';
    END IF;
    RETURN NEXT v_generation;
    RETURN;
  END IF;

  IF v_chunk_ordinal <> v_generation.chunk_count + 1 THEN
    RAISE EXCEPTION 'population entrant authority successor chunk ordinal is not contiguous';
  END IF;

  IF v_generation.last_source_race_id IS NOT NULL
     AND (v_first COLLATE "C") <=
         (v_generation.last_source_race_id COLLATE "C") THEN
    RAISE EXCEPTION 'population entrant authority successor chunk ranges overlap';
  END IF;

  IF v_generation.persisted_race_count + v_row_count >
     v_generation.unresolved_race_count THEN
    RAISE EXCEPTION 'population entrant authority successor exceeds audited unresolved count';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM dna.dna_population_entrant_authority_successor_chunk stored
    WHERE stored.owner_id = p_owner_id
      AND stored.object_key = v_object_key
  ) THEN
    RAISE EXCEPTION 'population entrant authority successor object key conflicts';
  END IF;

  INSERT INTO dna.dna_population_entrant_authority_successor_chunk (
    owner_id,
    generation_id,
    chunk_ordinal,
    object_key,
    body_sha256,
    byte_length,
    row_count,
    first_source_race_id,
    last_source_race_id,
    race_set_sha256,
    record_set_sha256,
    registered_at
  ) VALUES (
    p_owner_id,
    p_generation_id::character(64),
    v_chunk_ordinal,
    v_object_key,
    v_body_sha::character(64),
    v_byte_length,
    v_row_count,
    v_first,
    v_last,
    v_race_set_sha::character(64),
    v_record_set_sha::character(64),
    p_registered_at
  );

  UPDATE dna.dna_population_entrant_authority_successor_generation generation
  SET chunk_count = generation.chunk_count + 1,
      persisted_race_count = generation.persisted_race_count + v_row_count,
      last_source_race_id = v_last,
      updated_at = GREATEST(generation.updated_at, p_registered_at)
  WHERE generation.owner_id = p_owner_id
    AND generation.generation_id = p_generation_id::character(64)
  RETURNING * INTO v_generation;

  RETURN NEXT v_generation;
END
$function$;

CREATE FUNCTION dna.read_dna_population_entrant_authority_successor_generation(
  p_owner_id uuid,
  p_generation_id text
)
RETURNS SETOF dna.dna_population_entrant_authority_successor_generation
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_generation dna.dna_population_entrant_authority_successor_generation%ROWTYPE;
  v_chunk_count bigint;
  v_row_count bigint;
  v_min_ordinal integer;
  v_max_ordinal integer;
  v_last text;
BEGIN
  IF dna.current_owner_id() IS NULL
     OR p_owner_id <> dna.current_owner_id()
     OR p_generation_id IS NULL
     OR p_generation_id !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'owner-scoped population entrant authority successor read denied';
  END IF;

  SELECT stored.* INTO v_generation
  FROM dna.dna_population_entrant_authority_successor_generation stored
  WHERE stored.owner_id = p_owner_id
    AND stored.generation_id = p_generation_id::character(64);

  IF NOT FOUND THEN
    RAISE EXCEPTION 'population entrant authority successor generation is unavailable';
  END IF;

  SELECT
    count(*),
    COALESCE(sum(chunk.row_count), 0),
    min(chunk.chunk_ordinal),
    max(chunk.chunk_ordinal)
  INTO v_chunk_count, v_row_count, v_min_ordinal, v_max_ordinal
  FROM dna.dna_population_entrant_authority_successor_chunk chunk
  WHERE chunk.owner_id = p_owner_id
    AND chunk.generation_id = p_generation_id::character(64);

  SELECT chunk.last_source_race_id INTO v_last
  FROM dna.dna_population_entrant_authority_successor_chunk chunk
  WHERE chunk.owner_id = p_owner_id
    AND chunk.generation_id = p_generation_id::character(64)
  ORDER BY chunk.chunk_ordinal DESC
  LIMIT 1;

  IF v_chunk_count <> v_generation.chunk_count
     OR v_row_count <> v_generation.persisted_race_count
     OR (
       v_generation.chunk_count = 0
       AND (
         v_min_ordinal IS NOT NULL
         OR v_max_ordinal IS NOT NULL
         OR v_generation.last_source_race_id IS NOT NULL
       )
     )
     OR (
       v_generation.chunk_count > 0
       AND (
         v_min_ordinal <> 1
         OR v_max_ordinal <> v_generation.chunk_count
         OR v_last IS DISTINCT FROM v_generation.last_source_race_id
       )
     )
     OR EXISTS (
       SELECT 1
       FROM (
         SELECT
           chunk.chunk_ordinal,
           chunk.first_source_race_id,
           lag(chunk.last_source_race_id) OVER (
             ORDER BY chunk.chunk_ordinal
           ) AS previous_last
         FROM dna.dna_population_entrant_authority_successor_chunk chunk
         WHERE chunk.owner_id = p_owner_id
           AND chunk.generation_id = p_generation_id::character(64)
       ) ordered
       WHERE ordered.previous_last IS NOT NULL
         AND (ordered.first_source_race_id COLLATE "C") <=
             (ordered.previous_last COLLATE "C")
     ) THEN
    RAISE EXCEPTION 'population entrant authority successor checkpoint is inconsistent';
  END IF;

  RETURN NEXT v_generation;
END
$function$;

CREATE FUNCTION dna.read_dna_population_entrant_authority_successor_chunk_manifests(
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
  race_set_sha256 text,
  record_set_sha256 text,
  registered_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_generation dna.dna_population_entrant_authority_successor_generation%ROWTYPE;
BEGIN
  IF p_after_chunk_ordinal IS NULL
     OR p_after_chunk_ordinal < 0
     OR p_limit IS NULL
     OR p_limit NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'population entrant authority successor manifest pagination is invalid';
  END IF;

  SELECT * INTO v_generation
  FROM dna.read_dna_population_entrant_authority_successor_generation(
    p_owner_id,
    p_generation_id
  );

  IF p_after_chunk_ordinal > v_generation.chunk_count THEN
    RAISE EXCEPTION 'population entrant authority successor manifest cursor is invalid';
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
    chunk.race_set_sha256::text,
    chunk.record_set_sha256::text,
    chunk.registered_at
  FROM dna.dna_population_entrant_authority_successor_chunk chunk
  WHERE chunk.owner_id = p_owner_id
    AND chunk.generation_id = p_generation_id::character(64)
    AND chunk.chunk_ordinal > p_after_chunk_ordinal
  ORDER BY chunk.chunk_ordinal
  LIMIT p_limit;
END
$function$;

REVOKE ALL ON TABLE
  dna.dna_population_entrant_authority_successor_generation,
  dna.dna_population_entrant_authority_successor_chunk
FROM PUBLIC, dna_app_runtime;

REVOKE ALL ON FUNCTION
  dna.begin_dna_population_entrant_authority_successor_generation(uuid,jsonb,timestamp with time zone),
  dna.register_dna_population_entrant_authority_successor_chunk(uuid,text,jsonb,timestamp with time zone),
  dna.read_dna_population_entrant_authority_successor_generation(uuid,text),
  dna.read_dna_population_entrant_authority_successor_chunk_manifests(uuid,text,integer,integer)
FROM PUBLIC;

REVOKE ALL ON FUNCTION
  dna.reject_dna_population_entrant_authority_successor_chunk_mutation()
FROM PUBLIC, dna_app_runtime;

GRANT EXECUTE ON FUNCTION
  dna.begin_dna_population_entrant_authority_successor_generation(uuid,jsonb,timestamp with time zone),
  dna.register_dna_population_entrant_authority_successor_chunk(uuid,text,jsonb,timestamp with time zone),
  dna.read_dna_population_entrant_authority_successor_generation(uuid,text),
  dna.read_dna_population_entrant_authority_successor_chunk_manifests(uuid,text,integer,integer)
TO dna_app_runtime;

COMMIT;
