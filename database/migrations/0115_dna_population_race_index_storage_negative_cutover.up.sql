BEGIN;

DO $guard$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM dna.dna_population_race_index_generation generation
    WHERE generation.r2_chunk_count <> 0
       OR generation.r2_compacted_race_count <> 0
  ) OR EXISTS (
    SELECT 1 FROM dna.dna_population_race_index_r2_chunk
  ) THEN
    RAISE EXCEPTION 'population storage-negative cutover requires an unstarted R2 compaction';
  END IF;
END
$guard$;

CREATE FUNCTION dna.retire_dna_population_race_index_chunk_rows()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_generation dna.dna_population_race_index_generation%ROWTYPE;
  v_deleted_count bigint;
BEGIN
  SELECT generation.* INTO STRICT v_generation
  FROM dna.dna_population_race_index_generation generation
  WHERE generation.generation_key = NEW.generation_key
  FOR UPDATE;

  IF v_generation.storage_layout = 'r2_chunked_v1'
     AND v_generation.legacy_storage_retired_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF v_generation.storage_layout <> 'legacy_neon_v1'
     OR v_generation.legacy_storage_retired_at IS NOT NULL THEN
    RAISE EXCEPTION 'population storage-negative chunk source is unavailable';
  END IF;

  DELETE FROM dna.dna_population_race_index_race race
  WHERE race.owner_id = v_generation.owner_id
    AND race.generation_id = v_generation.generation_id
    AND (race.source_race_id COLLATE "C") >=
        (NEW.first_source_race_id COLLATE "C")
    AND (race.source_race_id COLLATE "C") <=
        (NEW.last_source_race_id COLLATE "C");
  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;

  IF v_deleted_count <> NEW.row_count THEN
    RAISE EXCEPTION 'population storage-negative chunk retirement count disagrees';
  END IF;

  RETURN NEW;
END
$function$;

CREATE TRIGGER retire_population_race_index_chunk_rows
AFTER INSERT ON dna.dna_population_race_index_r2_chunk
FOR EACH ROW
EXECUTE FUNCTION dna.retire_dna_population_race_index_chunk_rows();

CREATE FUNCTION dna.finalize_dna_population_race_index_storage_negative_cutover(
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
  v_manifest_last text;
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id()
     OR p_worker_id IS NULL OR p_worker_id <> btrim(p_worker_id)
     OR p_worker_id !~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$'
     OR p_generation_id IS NULL OR p_generation_id !~ '^[a-f0-9]{64}$'
     OR p_compacted_at IS NULL
     OR p_compacted_at > clock_timestamp() + interval '5 minutes' THEN
    RAISE EXCEPTION 'population storage-negative finalization is invalid';
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
    RAISE EXCEPTION 'population storage-negative compaction claim is unavailable';
  END IF;
  IF v_generation.storage_layout = 'r2_chunked_v1' THEN
    RETURN NEXT v_generation;
    RETURN;
  END IF;
  IF v_generation.storage_layout <> 'legacy_neon_v1'
     OR v_generation.legacy_storage_retired_at IS NOT NULL THEN
    RAISE EXCEPTION 'population storage-negative compaction source is unavailable';
  END IF;

  SELECT count(*), COALESCE(sum(chunk.row_count), 0),
         max(chunk.last_source_race_id COLLATE "C")
  INTO v_manifest_count, v_manifest_rows, v_manifest_last
  FROM dna.dna_population_race_index_r2_chunk chunk
  WHERE chunk.generation_key = v_generation.generation_key;

  SELECT count(*) INTO v_legacy_count
  FROM dna.dna_population_race_index_race race
  WHERE race.owner_id = p_owner_id
    AND race.generation_id = p_generation_id::character(64);

  IF v_generation.unique_race_count = 0
     OR v_legacy_count <> 0
     OR EXISTS (
       SELECT 1
       FROM dna.dna_population_race_index_compact_identity identity
       WHERE identity.generation_key = v_generation.generation_key
     )
     OR v_manifest_rows <> v_generation.unique_race_count
     OR v_manifest_count <> v_generation.r2_chunk_count
     OR v_generation.r2_compacted_race_count <> v_generation.unique_race_count
     OR v_generation.r2_last_source_race_id IS DISTINCT FROM v_manifest_last
     OR EXISTS (
       SELECT 1
       FROM (
         SELECT
           chunk.chunk_ordinal,
           row_number() OVER (ORDER BY chunk.chunk_ordinal) AS expected_ordinal,
           chunk.first_source_race_id,
           lag(chunk.last_source_race_id) OVER (
             ORDER BY chunk.chunk_ordinal
           ) AS previous_last
         FROM dna.dna_population_race_index_r2_chunk chunk
         WHERE chunk.generation_key = v_generation.generation_key
       ) ordered
       WHERE ordered.chunk_ordinal <> ordered.expected_ordinal
          OR (
            ordered.previous_last IS NOT NULL
            AND (ordered.first_source_race_id COLLATE "C") <=
                (ordered.previous_last COLLATE "C")
          )
     ) THEN
    RAISE EXCEPTION 'population storage-negative equivalence proof failed';
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

CREATE FUNCTION dna.retire_dna_population_race_index_storage_negative_legacy(
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
BEGIN
  IF p_owner_id IS NULL
     OR p_generation_id IS NULL OR p_generation_id !~ '^[a-f0-9]{64}$'
     OR p_retired_at IS NULL
     OR p_retired_at > clock_timestamp() + interval '5 minutes' THEN
    RAISE EXCEPTION 'population storage-negative retirement request is invalid';
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
     OR v_generation.r2_compacted_race_count <> v_generation.unique_race_count THEN
    RAISE EXCEPTION 'population storage-negative retirement proof failed';
  END IF;

  SELECT count(*) INTO v_generation_count
  FROM dna.dna_population_race_index_generation generation
  WHERE generation.owner_id = p_owner_id
    AND generation.generation_id = p_generation_id::character(64);
  SELECT count(*) INTO v_identity_count
  FROM dna.dna_population_race_index_compact_identity identity
  WHERE identity.generation_key = v_generation.generation_key;
  SELECT COALESCE(sum(chunk.row_count), 0) INTO v_manifest_rows
  FROM dna.dna_population_race_index_r2_chunk chunk
  WHERE chunk.generation_key = v_generation.generation_key;
  SELECT count(*) INTO v_legacy_count
  FROM dna.dna_population_race_index_race;

  IF v_generation_count <> 1
     OR v_identity_count <> 0
     OR v_manifest_rows <> v_generation.unique_race_count
     OR v_legacy_count <> 0
     OR EXISTS (SELECT 1 FROM dna.dna_population_race_index_entrant) THEN
    RAISE EXCEPTION 'population storage-negative retirement proof failed';
  END IF;

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

REVOKE ALL ON FUNCTION
  dna.retire_dna_population_race_index_chunk_rows(),
  dna.finalize_dna_population_race_index_storage_negative_cutover(uuid,text,text,timestamp with time zone),
  dna.retire_dna_population_race_index_storage_negative_legacy(uuid,text,timestamp with time zone)
FROM PUBLIC;

GRANT EXECUTE ON FUNCTION
  dna.finalize_dna_population_race_index_storage_negative_cutover(uuid,text,text,timestamp with time zone)
TO dna_app_runtime;

COMMIT;
