BEGIN;

CREATE INDEX dna_population_core_history_authority_latest_idx
  ON dna.dna_population_core_history_authority(
    owner_id,
    evaluated_at DESC,
    registered_at DESC
  );

CREATE FUNCTION dna.read_dna_population_core_identity(
  p_owner_id uuid,
  p_source_core_id bigint
)
RETURNS TABLE (
  source_core_id text,
  generation_id uuid,
  evaluated_at timestamptz,
  core_set_sha256 character(64),
  core_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_owner_id uuid := dna.current_owner_id();
BEGIN
  IF v_owner_id IS NULL
     OR p_owner_id <> v_owner_id
     OR p_source_core_id IS NULL
     OR p_source_core_id NOT BETWEEN 1 AND 9007199254740991 THEN
    RAISE EXCEPTION 'owner-scoped population Core identity read denied';
  END IF;

  RETURN QUERY
  WITH latest AS (
    SELECT authority.generation_id, authority.evaluated_at,
      authority.core_set_sha256, authority.core_count, authority.core_ids
    FROM dna.dna_population_core_history_authority authority
    WHERE authority.owner_id = p_owner_id
    ORDER BY authority.evaluated_at DESC, authority.registered_at DESC
    LIMIT 1
  )
  SELECT p_source_core_id::text, latest.generation_id, latest.evaluated_at,
    latest.core_set_sha256, latest.core_count
  FROM latest
  WHERE latest.core_ids @> to_jsonb(ARRAY[p_source_core_id]);
END
$function$;

REVOKE ALL ON FUNCTION
  dna.read_dna_population_core_identity(uuid,bigint)
FROM PUBLIC;

GRANT EXECUTE ON FUNCTION
  dna.read_dna_population_core_identity(uuid,bigint)
TO dna_app_runtime;

COMMIT;
