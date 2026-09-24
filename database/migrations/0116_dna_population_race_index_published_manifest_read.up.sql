BEGIN;

CREATE FUNCTION dna.read_dna_population_race_index_published_r2_chunk_manifests(
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
  IF dna.current_owner_id() IS NULL
     OR p_owner_id <> dna.current_owner_id()
     OR p_generation_id IS NULL
     OR p_generation_id !~ '^[a-f0-9]{64}$'
     OR p_after_chunk_ordinal IS NULL
     OR p_after_chunk_ordinal < 0
     OR p_limit IS NULL
     OR p_limit NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'owner-scoped published population R2 manifest read denied';
  END IF;

  SELECT generation.generation_key
  INTO v_generation_key
  FROM dna.dna_population_race_index_generation generation
  JOIN dna.dna_population_race_index_active active
    ON active.owner_id = generation.owner_id
   AND active.generation_id = generation.generation_id
  WHERE generation.owner_id = p_owner_id
    AND generation.generation_id = p_generation_id::character(64)
    AND generation.state = 'published'
    AND generation.storage_layout = 'r2_chunked_v1'
    AND generation.completed_at IS NOT NULL
    AND generation.published_at IS NOT NULL
    AND generation.compacted_at IS NOT NULL
    AND generation.legacy_storage_retired_at IS NOT NULL
    AND active.activated_at = generation.published_at
    AND generation.unique_race_count > 0
    AND generation.r2_chunk_count > 0
    AND generation.r2_identity_chunk_count = generation.r2_chunk_count
    AND generation.r2_compacted_race_count = generation.unique_race_count
    AND generation.r2_last_source_race_id IS NOT NULL
    AND p_after_chunk_ordinal <= generation.r2_chunk_count
    AND NOT EXISTS (
      SELECT 1
      FROM dna.dna_population_race_index_r2_chunk chunk
      WHERE chunk.generation_key = generation.generation_key
        AND chunk.identity_registered_at IS NULL
    )
    AND (
      SELECT count(*)
      FROM dna.dna_population_race_index_r2_chunk chunk
      WHERE chunk.generation_key = generation.generation_key
    ) = generation.r2_chunk_count
    AND (
      SELECT COALESCE(sum(chunk.row_count), 0)
      FROM dna.dna_population_race_index_r2_chunk chunk
      WHERE chunk.generation_key = generation.generation_key
    ) = generation.unique_race_count
    AND (
      SELECT count(*)
      FROM dna.dna_population_race_index_compact_identity identity
      WHERE identity.generation_key = generation.generation_key
    ) = generation.unique_race_count;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'published population R2 manifest authority is unavailable';
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

REVOKE ALL ON FUNCTION
  dna.read_dna_population_race_index_published_r2_chunk_manifests(uuid,text,integer,integer)
FROM PUBLIC;

GRANT EXECUTE ON FUNCTION
  dna.read_dna_population_race_index_published_r2_chunk_manifests(uuid,text,integer,integer)
TO dna_app_runtime;

COMMIT;
