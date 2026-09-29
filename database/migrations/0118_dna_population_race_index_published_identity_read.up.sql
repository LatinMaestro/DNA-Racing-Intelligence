BEGIN;

CREATE FUNCTION dna.read_dna_population_race_index_published_compact_identities(
  p_owner_id uuid,
  p_generation_id text,
  p_after_source_race_id text,
  p_limit integer
)
RETURNS TABLE (
  source_race_id text,
  raw_evidence_sha256 text
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
     OR (
       p_after_source_race_id IS NOT NULL
       AND (
         p_after_source_race_id <> btrim(p_after_source_race_id)
         OR length(p_after_source_race_id) NOT BETWEEN 1 AND 512
         OR p_after_source_race_id ~ '[[:cntrl:]]'
       )
     )
     OR p_limit IS NULL
     OR p_limit NOT BETWEEN 1 AND 5000 THEN
    RAISE EXCEPTION 'owner-scoped published population compact identity read denied';
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
    AND generation.r2_last_source_race_id IS NOT NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'published population compact identity authority is unavailable';
  END IF;

  RETURN QUERY
  SELECT
    identity.source_race_id,
    encode(identity.raw_evidence_sha256, 'hex')
  FROM dna.dna_population_race_index_compact_identity identity
  WHERE identity.generation_key = v_generation_key
    AND (
      p_after_source_race_id IS NULL
      OR (identity.source_race_id COLLATE "C") >
         (p_after_source_race_id COLLATE "C")
    )
  ORDER BY identity.source_race_id COLLATE "C"
  LIMIT p_limit;
END
$function$;

REVOKE ALL ON FUNCTION
  dna.read_dna_population_race_index_published_compact_identities(uuid,text,text,integer)
FROM PUBLIC;

GRANT EXECUTE ON FUNCTION
  dna.read_dna_population_race_index_published_compact_identities(uuid,text,text,integer)
TO dna_app_runtime;

COMMIT;
