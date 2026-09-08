BEGIN;

CREATE FUNCTION dna.read_current_pro_league_breeding_publication_authority(
  p_owner_id uuid
)
RETURNS TABLE (
  roster_evidence_cutoff_at timestamptz,
  latest_performance_import_at timestamptz,
  latest_arena_import_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped Pro League breeding publication authority read denied';
  END IF;

  RETURN QUERY
  WITH arena_authority AS (
    SELECT count(*)::integer AS active_count,
      count(*) FILTER (WHERE arena_batch.status = 'accepted'
        AND arena_batch.import_completed_at IS NOT NULL
        AND arena_version.rolled_back_at IS NULL
        AND arena_version.aggregate_refreshed_at IS NOT NULL)::integer AS valid_count,
      max(arena_batch.import_completed_at) AS import_completed_at
    FROM dna.dataset_version arena_version
    LEFT JOIN dna.import_batch arena_batch
      ON arena_batch.owner_id = arena_version.owner_id
     AND arena_batch.id = arena_version.import_batch_id
    WHERE arena_version.owner_id = p_owner_id
      AND arena_version.source_type = 'current_arena'
      AND arena_version.is_active
  )
  SELECT generation.evidence_cutoff_at,
    performance_batch.import_completed_at,
    arena.import_completed_at
  FROM dna.pro_league_evidence_active active
  JOIN dna.pro_league_evidence_generation generation
    ON generation.owner_id = active.owner_id
   AND generation.generation_id = active.generation_id
   AND generation.state = 'published'
  JOIN dna.dataset_version performance_version
    ON performance_version.owner_id = generation.owner_id
   AND performance_version.id = generation.race_dataset_version_id
   AND performance_version.source_type = 'race_merge'
   AND performance_version.is_active
   AND performance_version.rolled_back_at IS NULL
   AND performance_version.aggregate_refreshed_at IS NOT NULL
  JOIN dna.import_batch performance_batch
    ON performance_batch.owner_id = performance_version.owner_id
   AND performance_batch.id = performance_version.import_batch_id
   AND performance_batch.status = 'accepted'
   AND performance_batch.import_completed_at IS NOT NULL
  CROSS JOIN arena_authority arena
  WHERE active.owner_id = p_owner_id
    AND (arena.active_count = 0
      OR (arena.active_count = 1 AND arena.valid_count = 1));
END
$function$;

REVOKE ALL ON FUNCTION dna.read_current_pro_league_breeding_publication_authority(uuid)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION dna.read_current_pro_league_breeding_publication_authority(uuid)
  TO dna_app_runtime;

COMMIT;
